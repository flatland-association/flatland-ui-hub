"""Walk-through of setting a route in the Plan B tutorial, step by step and per train.

Drives the app's own endpoints (session, proposals, apply, step) with FastAPI's
TestClient and records what each part does for each train in each step:

- the driver's action (`OverridePolicy.last_proposed`), and for `PlanPolicy`
  whether it followed the course or handed the train to its fallback (DLA);
- what the wrapper (`OverridePolicy.apply_overrides`) did with it
  (`last_sources`: policy, reroute, override) and the action the env got;
- what `set_committed_overrides` received and answered;
- the stored state: course, overrides, routes, drawn marker, off-plan set.

Cases (§4.2 of docs/plans/set-route-on-map.md):

- 0: no KI course, no route: DLA alone (BA waits at B until AB is through).
- A: no KI course, DLA drives; BA's route using the side track drawn at step 3.
- B: the KI course `ai-2` taken at step 2 (AB on the side track, BA on the main
  line), then BA's route using the side track drawn at step 3; run three times: before S-6,
  with the pass-on only, with S-6 as built.
- C: BA's route using the side track drawn at step 2, then the KI course for AB taken at step 3:
  the course is simulated with BA's route (#208 keeps it), so BA stays on plan.
- D: the tutorial's DLA run as the accepted course (BA departs at step 25, as in
  `test_route_drawn.py`), then BA's route using the side track drawn at step 3; with the pass-on
  only and with S-6. Not reachable in the app: no KI course is that run.

Run from the repo root:

    PYTHONPATH=backend python docs/plans/set-route-on-map/walkthrough.py

Writes `tmp/walkthrough/walkthrough-<case>.json` (not committed) and prints the
step tables as Markdown.
"""
from __future__ import annotations

import json
import logging
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
logging.disable(logging.CRITICAL)

from fastapi.testclient import TestClient  # noqa: E402

from app.core.override_manager import override_manager  # noqa: E402
from app.core.session_manager import session_manager  # noqa: E402
from app.main import app  # noqa: E402
from app.policies.base import Policy  # noqa: E402
from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy  # noqa: E402
from app.policies.override_policy import OverridePolicy  # noqa: E402
from app.policies.plan_policy import PlanPolicy  # noqa: E402
from app.utils.agent_compat import agent_direction, agent_position  # noqa: E402

OUT = Path(__file__).resolve().parents[3] / "tmp" / "walkthrough"  # not committed
AB, BA = 0, 1
NAMES = {AB: "AB", BA: "BA"}
SIDE_TRACK = [[1, 12]]
ACTIONS = {0: "DO_NOTHING", 1: "LEFT", 2: "FORWARD", 3: "RIGHT", 4: "STOP", 5: "REROUTE"}

# ── instrumentation ──────────────────────────────────────────────────
_trace: dict = {}


def _name(action) -> str | None:
    if action is None:
        return None
    return ACTIONS.get(int(getattr(action, "value", action)), str(action))


_orig_apply = OverridePolicy.apply_overrides
_orig_plan_action = PlanPolicy._plan_action
_orig_set = PlanPolicy.set_committed_overrides
_orig_pass = OverridePolicy._pass_committed_overrides


def _apply(self, handles, proposals):
    actions = _orig_apply(self, handles, proposals)
    _trace["proposed"] = {int(h): _name(a) for h, a in self.last_proposed.items()}
    _trace["sources"] = {int(h): s for h, s in self.last_sources.items()}
    _trace["actions"] = {int(h): _name(a) for h, a in actions.items()}
    _trace["driver"] = type(self.default_policy).__name__
    return actions


def _plan_action(self, handle):
    action = _orig_plan_action(self, handle)
    _trace.setdefault("plan", {})[int(handle)] = "course" if action is not None else "fallback DLA"
    return action


def _pass(self):
    knows = _orig_pass(self)
    committed = override_manager.get_all(self.session_id)
    routes = getattr(self.env, "_route_overrides", None) or {}
    _trace["hook"] = {
        "holds": sorted(int(h) for h, a in committed.items() if int(a) == 4),
        "routes": {int(h): len(r) for h, r in routes.items() if int(committed.get(h, -1)) == 5},
        "answer": knows,
    }
    return knows


_orig_can_move = DeadLockAvoidancePolicy._can_agent_move


def _can_move(self, handle, my_path, same_agents, opp_agents, full_map):
    """What DLA decided go or stop on: the cells it walks, the oncoming trains, the free cells."""
    ok = _orig_can_move(self, handle, my_path, same_agents, opp_agents, full_map)
    occupied = (self._agent_positions > -1).astype(int) if self._agent_positions is not None else 0
    free = {int(o): int((((my_path - full_map[o] - occupied) > 0).astype(int)).sum()) for o in opp_agents}
    # The walker's maps are -1 except the walked cells (1): the full path, and
    # `my_path` the stretch up to the first switch.
    cells = [(int(r), int(c)) for r, c in zip(*(full_map[handle] == 1).nonzero())]
    _trace.setdefault("dla", {})[int(handle)] = {
        "walks": "side track" if any(r == 1 for r, _ in cells) else "main line",
        "path_cells": len(cells),
        "routed": int(handle) in (self._routes or {}),
        "oncoming": sorted(int(o) for o in opp_agents),
        "free": free,
        "needed": int(self.min_free_cell + len(opp_agents)),
        "go": bool(ok),
    }
    return ok


DeadLockAvoidancePolicy._can_agent_move = _can_move
OverridePolicy.apply_overrides = _apply
OverridePolicy._pass_committed_overrides = _pass
PlanPolicy._plan_action = _plan_action

S6_VARIANTS = {
    "before S-6": Policy.set_committed_overrides,
    "pass-on only": lambda self, holds, routes: bool(self.fallback.set_committed_overrides(holds, routes)),
    "S-6": _orig_set,
}


# ── state payloads ───────────────────────────────────────────────────
def _course(env) -> dict | None:
    runs = getattr(env, "_trainrun_plan", None)
    if not runs:
        return None
    out = {}
    for h, run in runs.items():
        out[str(h)] = [
            {"scheduled_at": int(w.scheduled_at), "position": list(w.waypoint.position),
             "direction": int(w.waypoint.direction)}
            for w in run
        ]
    return out


def _state(session) -> dict:
    env = session.env
    sid = session.id
    routes = getattr(env, "_route_overrides", None) or {}
    return {
        "step": int(env._elapsed_steps),
        "session.policy": session.policy,
        "env._accepted_trainrun_plan": bool(getattr(env, "_accepted_trainrun_plan", False)),
        "env._trainrun_plan": _course(env),
        "override_manager": {str(h): int(a) for h, a in override_manager.get_all(sid).items()},
        "env._route_overrides": {str(h): [list(map(int, n)) for n in r] for h, r in routes.items()},
        "env._route_drawn": sorted(int(h) for h in (getattr(env, "_route_drawn", None) or ())),
        "env._plan_off_plan": sorted(int(h) for h in (getattr(env, "_plan_off_plan", None) or ())),
        "env._plan_course_routes": {str(h): len(r) for h, r in (getattr(env, "_plan_course_routes", None) or {}).items()},
    }


# ── one run ──────────────────────────────────────────────────────────
def _take_course(client, sid, handle: int, course: str) -> None:
    proposals = client.get(f"/session/{sid}/proposals", params={"handle": handle}).json()
    chosen = next(v for v in [*proposals["variants"], *proposals.get("ai_alternatives", [])] if v["id"] == course)
    client.post(f"/session/{sid}/proposals/apply", json={
        "variant": "ai", "handle": handle, "candidate_id": chosen["candidate_id"],
        "preview_token": chosen["preview_token"], "source_step": proposals["source_step"],
        "priority": chosen.get("priority") or []}).raise_for_status()


def _draw(client, sid) -> None:
    client.post(f"/session/{sid}/proposals/apply", json={
        "variant": "human", "handle": BA, "option": "reroute", "via": SIDE_TRACK}).raise_for_status()


def run(case: str, course: str | None, variant: str = "S-6", steps: int = 45, route: bool = True) -> dict:
    PlanPolicy.set_committed_overrides = S6_VARIANTS[variant]
    client = TestClient(app)
    sid = client.post("/session", json={"scenario_preset_id": "tutorial", "proposal_agent": "uc2_rl"}).json()["id"]
    session = session_manager.get(sid)
    rows, snapshots, arrived = [], {}, {}
    try:
        for _ in range(2):
            client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance"})
        if course == "dla-run":
            from tests.test_route_drawn import _record_plan

            from app.policies.plan_policy import accept_trainrun_plan
            runs = _record_plan()
            accept_trainrun_plan(session.env, runs)
            session.env._plan_off_plan = set()
            session.trainrun_plan = runs
            session.policy = "plan"
            snapshots["course taken"] = _state(session)
        elif course == "route, then ai for AB":
            _draw(client, sid)
            snapshots["route drawn"] = _state(session)
            client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance"})
            _take_course(client, sid, AB, "ai")
            snapshots["course taken"] = _state(session)
            route = False
        elif course is not None:
            _take_course(client, sid, BA, course)
            snapshots["course taken"] = _state(session)
        if course != "route, then ai for AB":
            client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance"})
        if route:
            _draw(client, sid)
            snapshots["route drawn"] = _state(session)

        for _ in range(steps):
            if all(a.state.name == "DONE" for a in session.env.agents):
                break
            _trace.clear()
            now = int(session.env._elapsed_steps)
            before = {h: agent_position(session.env.agents[h]) for h in (AB, BA)}
            heading = {h: agent_direction(session.env.agents[h]) for h in (AB, BA)}
            result = client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance"}).json()
            row = {"step": now, "driver": _trace.get("driver"), "hook": _trace.get("hook"), "trains": {}}
            for h in (AB, BA):
                agent = session.env.agents[h]
                row["trains"][NAMES[h]] = {
                    "at": list(before[h]) if before[h] is not None else None,
                    "heading": int(heading[h]) if heading[h] is not None else None,
                    "plan": _trace.get("plan", {}).get(h),
                    "driver": _trace.get("proposed", {}).get(h),
                    "wrapper": _trace.get("sources", {}).get(h),
                    "env": _trace.get("actions", {}).get(h),
                    "state": agent.state.name,
                    "dla": _trace.get("dla", {}).get(h),
                }
                if agent.state.name == "DONE":
                    arrived.setdefault(NAMES[h], int(session.env._elapsed_steps))
            rows.append(row)
            if now == 8:
                snapshots["step 8"] = _state(session)
            if result.get("all_done"):
                break
        snapshots["end"] = _state(session)
    finally:
        override_manager.clear_all(sid)
        session_manager.delete(sid)
        PlanPolicy.set_committed_overrides = _orig_set
    return {"case": case, "course": course, "variant": variant, "arrived": arrived,
            "side_track": any(r["trains"]["BA"]["at"] == [1, 12] for r in rows),
            "rows": rows, "state": snapshots}


# ── output ───────────────────────────────────────────────────────────
def _why(t: dict) -> str:
    """Who proposed the train's action, and on what."""
    if t["plan"] == "course":
        return "course"
    d = t["dla"]
    if d is None:
        return "-"
    who = "DLA (fallback)" if t["plan"] else "DLA"
    if not d["oncoming"]:
        return f"{who}, {d['walks']}, nobody oncoming"
    other = ", ".join(NAMES[o] for o in d["oncoming"])
    free = ", ".join(str(v) for v in d["free"].values())
    return f"{who}, {d['walks']}, {other} oncoming: {free} free of {d['needed']} → {'go' if d['go'] else 'stop'}"


def _cells(t: dict) -> list[str]:
    if t["at"] is None:
        at = "done" if t["state"] == "DONE" else "off map"
    else:
        at = f"{t['at'][0]},{t['at'][1]}"
    if t["wrapper"] == "reroute":
        did = f"route move {t['env']}"
    elif t["wrapper"] == "override":
        did = f"override {t['env']}"
    else:
        did = f"kept {t['env']}"
    return [at, f"{t['driver']} ({_why(t)})", did]


def markdown(result: dict, steps=None) -> str:
    lines = [
        f"**{result['case']}**, {result['variant']}: arrived {result['arrived']}, BA used the side track: {result['side_track']}.",
        "",
        "| Step | AB at | AB: driver (why) | AB: wrapper | BA at | BA: driver (why) | BA: wrapper | `set_committed_overrides` |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for r in result["rows"]:
        if steps and r["step"] not in steps:
            continue
        hook = r["hook"] or {}
        h = f"routes of {[NAMES[int(k)] for k in hook.get('routes', {})]} → {hook.get('answer')}" if hook else ""
        lines.append("| " + " | ".join([str(r["step"]), *_cells(r["trains"]["AB"]), *_cells(r["trains"]["BA"]), h]) + " |")
    return "\n".join(lines)


def main() -> None:
    plan = [("0", None, ["S-6"]), ("A", None, ["S-6"]), ("B", "ai-2", ["before S-6", "pass-on only", "S-6"]), ("C", "route, then ai for AB", ["S-6"]),
            ("D", "dla-run", ["pass-on only", "S-6"])]
    only = set(sys.argv[1:])
    OUT.mkdir(parents=True, exist_ok=True)
    for case, course, variants in plan:
        if only and case not in only:
            continue
        results = [run(case, course, v, route=case != "0") for v in variants]
        (OUT / f"walkthrough-{case}.json").write_text(json.dumps(results, indent=1) + "\n")
        for r in results:
            print(markdown(r))
            print()


if __name__ == "__main__":
    main()
