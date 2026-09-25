"""Strategies for a contention — the Combined Actions packages as real,
simulated alternatives (docs/plans/zug-weg-route-selection.md, "Strategies").

For the most urgent contention the forecast found, three strategies are rolled
forward from the current state to the same horizon and compared:

- ``keep`` — carry on with what drives the session now (its policy, plan or
  Director plan, with the standing overrides): the reference.
- ``policy:<id>`` — switch the whole network to another dispatching policy
  (Shortest Path; Deadlock Avoidance when Shortest Path is already running).
- ``pp`` — re-plan every train with Prioritized Planning
  (AI4REALNET/flatland-blackbox, `app.planners.replan`). With PP the priority
  order *is* the decision, so every order of the contending trains is tried
  and the best is proposed; an operator's own order (``priority``) is solved
  the same way. This is the Tokener (T3.4) unit: negotiate one order, not
  per-train commands.

Each strategy is scored on the same yardstick — summed lateness against the
timetable (the plan's arrival steps, else each train's ``latest_arrival``),
trains that should have arrived within the horizon but did not, and deadlocks
— and the lowest score is the recommendation. Confidence is the margin to the
runner-up, stated as such: close scores mean "these are nearly equal".
"""
from __future__ import annotations

import itertools
from typing import Any, Optional, Sequence

HORIZON_STEPS = 100
MAX_TRAINS = 4
MAX_ORDERS = 12
_NOT_ARRIVED_PENALTY = 60
_DEADLOCK_PENALTY = 200
_ALTERNATIVE_POLICIES = ("shortest_path", "deadlock_avoidance")

_cache: dict[tuple, dict] = {}


def _reference_arrivals(env) -> dict[int, int]:
    """When each train should arrive: the plan where the scenario ships one,
    else its own ``latest_arrival`` (Olten has no plan, but every train has a
    deadline)."""
    from app.policies.plan_policy import planned_arrival_steps

    planned = planned_arrival_steps(env)
    if planned:
        return {int(h): int(s) for h, s in planned.items()}
    out = {}
    for h, a in enumerate(env.agents):
        la = getattr(a, "latest_arrival", None)
        if la is not None:
            out[h] = int(la)
    return out


def _metrics(res, reference: dict[int, int], now: int, horizon: int) -> dict:
    """Lateness against the timetable, comparable across strategies.

    A train still out at the horizon although it was due counts with the delay
    it has at least by then (horizon end − deadline): leaving it out made a
    strategy that deadlocks every train look like it saved all their delay.
    """
    end = now + horizon
    lateness = 0
    late_trains = 0
    not_arrived_due = 0
    for h, outcome in res.agent_outcomes.items():
        ref = reference.get(int(h))
        if ref is None:
            continue
        arrival = outcome.get("arrival_step")
        if arrival is None:
            if ref <= end:
                not_arrived_due += 1
                lateness += end - ref
                late_trains += 1
            continue
        if arrival > ref:
            lateness += int(arrival) - int(ref)
            late_trains += 1
    # Trains still stuck in a deadlock when the horizon ends — not the
    # detector's deadlock-cycle events, which also count short waiting cycles
    # that resolve (on busy Olten "keep course" showed 7 while every train of
    # the real run arrived).
    deadlocks = sum(1 for o in res.agent_outcomes.values() if o.get("deadlocked") and not o.get("arrived"))
    score = lateness + _NOT_ARRIVED_PENALTY * not_arrived_due + _DEADLOCK_PENALTY * deadlocks
    return {
        "lateness": int(lateness),
        "lateTrains": int(late_trains),
        "notArrivedDue": int(not_arrived_due),
        "deadlocks": deadlocks,
        "arrived": int(res.success_count or 0),
        "score": int(score),
    }


def _pass_order(res, handles: Sequence[int], window: set) -> list[int]:
    """The order in which the contending trains pass the bottleneck under this
    strategy — what the package card shows as its sequence.

    The bottleneck is the part of the contended window that every contending
    train actually runs over (for opposing trains on a single-track section:
    the section itself). Ordering by first entry into the whole window instead
    let a train that merely touches the window's far end early read as "first".
    """
    visits: dict[int, dict[tuple, int]] = {h: {} for h in handles}
    for snap in res.snapshots:
        step = int(snap.get("step", 0))
        for h in handles:
            a = (snap.get("agents") or {}).get(h)
            pos = a and a.get("pos")
            if pos is None:
                continue
            cell = (int(pos[0]), int(pos[1]))
            if cell in window and cell not in visits[h]:
                visits[h][cell] = step
    cell_sets = [set(v) for v in visits.values() if v]
    shared = set.intersection(*cell_sets) if len(cell_sets) == len(handles) and cell_sets else set()
    if not shared:
        counts: dict[tuple, int] = {}
        for cells in cell_sets:
            for cell in cells:
                counts[cell] = counts.get(cell, 0) + 1
        shared = {cell for cell, n in counts.items() if n >= 2}
    first = {h: min((t for cell, t in visits[h].items() if cell in shared), default=10**9) for h in handles}
    return sorted(handles, key=lambda h: (first[h], h))


def _confidence(best: int, runner_up: Optional[int]) -> str:
    if runner_up is None:
        return "low"
    gap = runner_up - best
    rel = gap / max(1, abs(runner_up))
    if gap >= 10 and rel >= 0.2:
        return "high"
    if gap >= 3:
        return "medium"
    return "low"


def contention_strategies(session_id: str, session, priority: Optional[Sequence[int]] = None) -> dict:
    """The strategies for the session's most urgent contention (see module doc).

    ``priority``: an operator's order for the PP re-plan; adds a ``pp-human``
    strategy solved for exactly that order.
    """
    from app.api.hmi import _ALL_POLICIES, _rollout_baseline, get_contentions
    from app.core.override_manager import override_manager
    from app.core.scenario_runner import TrajectoryBranchRunner
    from app.planners.replan import replan_from_state
    from app.policies.plan_policy import PlanPolicy
    from app.policies.registry import scenario_policy_factories

    env = session.env
    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    groups = get_contentions(session_id).get("groups") or []
    if not groups:
        return {"step": now, "horizonSteps": HORIZON_STEPS, "handles": [], "strategies": []}
    group = groups[0]
    handles = [int(h) for h in group["handles"]][:MAX_TRAINS]
    window = {(int(r), int(c)) for r, c in (group.get("window") or [])}
    key = (session_id, now, tuple(handles), tuple(int(h) for h in (priority or ())))
    if key in _cache:
        return _cache[key]

    reference = _reference_arrivals(env)
    committed = dict(override_manager.get_all(session_id))

    def run(factory, overrides) -> Any:
        return TrajectoryBranchRunner(env, factory).run_branch(overrides=overrides, max_steps=HORIZON_STEPS)

    def entry(sid: str, kind: str, res, **extra) -> dict:
        return {
            "id": sid,
            "kind": kind,
            "metrics": _metrics(res, reference, now, HORIZON_STEPS),
            "passOrder": _pass_order(res, handles, window),
            **extra,
        }

    strategies: list[dict] = []

    enabled = set(getattr(session, "enabled_scenario_policies", set(_ALL_POLICIES.keys())))
    enabled = {pid for pid in enabled if pid in _ALL_POLICIES} or {"deadlock_avoidance"}
    _, keep_factory = _rollout_baseline(session, enabled)
    current = getattr(session, "policy", None) or "deadlock_avoidance"
    strategies.append(entry("keep", "keep", run(keep_factory, committed), policy=current))

    factories = scenario_policy_factories()
    alt = next((p for p in _ALTERNATIVE_POLICIES if p != current and p in factories), None)
    if alt:
        strategies.append(entry(f"policy:{alt}", "policy", run(factories[alt], committed), policy=alt))

    # PP over the orders of the contending trains; distinct plans only. Orders
    # are ranked by the plan's own arrival times (cheap: PP returns a complete
    # schedule), and only the best is rolled forward — simulating every order
    # took 20 s on a busy Olten, where a contention names up to four trains.
    seen: set = set()
    best_plan = None
    for order in list(itertools.permutations(handles))[:MAX_ORDERS]:
        trainruns = replan_from_state(env, priority=order)
        if trainruns is None:
            continue
        sig = tuple((h, tuple((wp.scheduled_at, tuple(wp.waypoint.position)) for wp in run_))
                    for h, run_ in sorted(trainruns.items()))
        if sig in seen:
            continue
        seen.add(sig)
        planned_late = sum(
            max(0, int(run_[-1].scheduled_at) + 1 - reference[h])
            for h, run_ in trainruns.items() if run_ and h in reference
        )
        if best_plan is None or planned_late < best_plan[0]:
            best_plan = (planned_late, list(order), trainruns)
    if best_plan is not None:
        _, order, trainruns = best_plan
        strategies.append(entry("pp", "pp", run(lambda tr=trainruns: PlanPolicy(None, tr), {}), priority=order))

    if priority:
        order = [int(h) for h in priority]
        trainruns = replan_from_state(env, priority=order)
        if trainruns is not None:
            strategies.append(entry("pp-human", "pp", run(lambda tr=trainruns: PlanPolicy(None, tr), {}), priority=order))

    keep_lateness = strategies[0]["metrics"]["lateness"]
    for s in strategies:
        s["lateSavedSteps"] = keep_lateness - s["metrics"]["lateness"]

    ranked = sorted((s for s in strategies if s["id"] != "pp-human"), key=lambda s: s["metrics"]["score"])
    best = ranked[0]
    runner_up = ranked[1]["metrics"]["score"] if len(ranked) > 1 else None
    payload = {
        "step": now,
        "horizonSteps": HORIZON_STEPS,
        "handles": handles,
        "location": group.get("location"),
        "recommended": best["id"],
        "confidence": _confidence(best["metrics"]["score"], runner_up),
        "strategies": strategies,
    }
    if len(_cache) > 64:
        _cache.clear()
    _cache[key] = payload
    return payload


def apply_strategy(session_id: str, session, strategy: str, priority: Optional[Sequence[int]] = None) -> dict:
    """Make a strategy what drives the session, until the operator changes it.

    ``keep`` changes nothing; ``policy:<id>`` switches the session policy;
    ``pp`` / ``pp-human`` re-solve PP for ``priority`` and install that plan
    (clearing standing overrides, which answered the course it replaces — as
    Plan / KI / Mensch does).
    """
    from app.api.sessions import _invalidate_scenario_forecasts
    from app.core.override_manager import override_manager
    from app.planners.replan import replan_from_state
    from app.policies.plan_policy import install_trainrun_plan
    from app.policies.registry import PLAN_POLICY_ID

    env = session.env
    if strategy == "keep":
        return {"applied": "keep", "policy": getattr(session, "policy", None) or ""}
    if strategy.startswith("policy:"):
        pid = strategy.split(":", 1)[1]
        if pid not in set(getattr(session, "enabled_policy_ids", set())):
            raise ValueError(f"Policy {pid!r} is not enabled for this session")
        session.policy = pid
    elif strategy in ("pp", "pp-human"):
        trainruns = replan_from_state(env, priority=[int(h) for h in (priority or ())])
        if not trainruns:
            raise LookupError("The planner found no collision-free plan from here")
        install_trainrun_plan(env, trainruns)
        session.trainrun_plan = trainruns
        session.policy = PLAN_POLICY_ID
        override_manager.clear_all(session_id)
    else:
        raise ValueError(f"Unknown strategy {strategy!r}")
    _invalidate_scenario_forecasts(session_id)
    _cache.clear()
    return {"applied": strategy, "policy": session.policy}


__all__ = ["HORIZON_STEPS", "apply_strategy", "contention_strategies"]
