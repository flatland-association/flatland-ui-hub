"""MARL lab, step 4: make the collaboration with a learned policy visible.

docs/plans/marl-lab-plan.md (step 4) and docs/plans/widget-a3-ai-track-record.md.
A *lab session* is any session whose policy is learned (`learned_ppo` or
`lab:<name>`); nothing here does anything for other sessions.

- `ai_choice` — what the learned policy will do at a train's *next* decision
  point. The HMI's per-train options belong to that switch, often several cells
  ahead, while the policy decides per step; so a fork lets the session's policy
  drive (with the committed overrides) until the train stands on it.
- `note_origin` — the env, forked at the first human override of the session:
  the point "AI alone" is rolled forward from.
- `record_choice` — a strategy picked in a lab session, with what was offered.
- `review` — the AI Track Record: interventions, agreement, rate, choices, and
  the outcome with you against AI alone and against the previous checkpoint.
"""
from __future__ import annotations

import json
import logging
import math
import time
from pathlib import Path
from typing import Any, Optional

from app.core import intervention_log

log = logging.getLogger(__name__)

# Forecast far enough to reach the next decision for trains that are already
# moving through a long approach. The episode limit below keeps this bounded.
AI_CHOICE_MAX_STEPS = 200
ACTION_VALUE_GAMMA = 0.99

_ai_choice_cache: dict[tuple, dict] = {}
_review_cache: dict[tuple, dict] = {}


# ── which sessions are lab sessions ─────────────────────────────────────

def is_learned(policy_id: Optional[str]) -> bool:
    from app.policies.registry import get_policy_spec

    spec = get_policy_spec(policy_id or "")
    return bool(spec and spec.family == "learned")


def _policy_id(session) -> str:
    return getattr(session, "policy", None) or ""


def _branch_factory(policy_id: str):
    from app.policies.registry import get_policy_spec

    spec = get_policy_spec(policy_id)
    if spec is None:
        raise LookupError(policy_id)
    return spec.branch_factory


# ── the AI's choice at the next switch ──────────────────────────────────

def ai_choice(session_id: str, session, handle: int, evaluation_policy_id: Optional[str] = None) -> dict:
    """Return one train's result from the shared multi-train forecast."""
    policy_id = evaluation_policy_id or _policy_id(session)
    if not is_learned(policy_id):
        return {"available": False, "reason": "not-learned"}
    return ai_choices(session_id, session, evaluation_policy_id=evaluation_policy_id).get(
        int(handle), {"available": False, "reason": "no-decision"}
    )


def ai_choices(session_id: str, session, evaluation_policy_id: Optional[str] = None) -> dict[int, dict]:
    """Evaluate all agents on one shared forecast driven by the running policy.

    The running policy advances one fork for every agent. At each simulated
    step, PPO2 evaluates the agents that reach their next decision point in
    that same fork. Completed agents are returned as ``done`` and are never
    treated as missing PPO observations.
    """
    from app.core.cell_classifier import lookahead_to_decision
    from app.core.override_manager import override_manager
    from app.core.scenario_runner import TrajectoryBranchRunner
    from app.policies.override_policy import OverridePolicy

    session_policy_id = _policy_id(session)
    policy_id = evaluation_policy_id or session_policy_id
    if not is_learned(policy_id):
        return {
            int(agent.handle): {"available": False, "reason": "not-learned"}
            for agent in session.env.agents
        }
    env = session.env
    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    committed = dict(override_manager.get_all(session_id))
    key = (session_id, now, session_policy_id, policy_id, tuple(sorted(committed.items())))
    cached = _ai_choice_cache.get(key)
    if cached is not None:
        return cached

    results: dict[int, dict] = {}
    for agent in env.agents:
        handle = int(agent.handle)
        if _agent_is_done(agent):
            results[handle] = {
                "available": False,
                "done": True,
                "reason": "done",
                "handle": handle,
                "step": now,
                "policy": policy_id,
                "simulationPolicy": session_policy_id,
            }
            continue

    running_factory = _branch_factory(session_policy_id)
    evaluator_factory = _branch_factory(policy_id)
    fork = TrajectoryBranchRunner(env, running_factory)._fork_env()
    running_inner = running_factory()
    running_inner.reset(fork)
    evaluator_inner = evaluator_factory()
    evaluator_inner.reset(fork)
    fork_id = f"branch-lab-{session_id}-{now}"
    for h, a in committed.items():
        override_manager.set(fork_id, int(h), int(a))
    running_policy = OverridePolicy(running_inner, fork_id)
    running_policy.reset(fork)
    handles = [int(agent.handle) for agent in fork.agents]
    episode_limit = getattr(fork, "_max_episode_steps", None)
    remaining_steps = int(episode_limit) - now if episode_limit is not None else AI_CHOICE_MAX_STEPS
    forecast_steps = max(1, min(AI_CHOICE_MAX_STEPS, remaining_steps))
    try:
        for ahead in range(forecast_steps + 1):
            active_handles = [h for h in handles if not _agent_is_done(fork.agents[h])]
            if not active_handles:
                break
            running_policy.start_step()
            running_actions = running_policy.act_many(active_handles, {})
            running_policy.end_step()
            reached = []
            decisions: dict[int, dict] = {}
            for handle in active_handles:
                if handle in results:
                    continue
                agent = fork.agents[handle]
                here = (tuple(agent.position) if agent.position is not None else None,
                        int(agent.direction) if agent.direction is not None else None)
                decision = lookahead_to_decision(fork, agent, max_depth=AI_CHOICE_MAX_STEPS)
                if decision is None:
                    continue
                target = (tuple(decision["decision_position"]), int(decision["decision_direction"]))
                if here == target:
                    reached.append(handle)
                    decisions[handle] = decision
            if reached:
                evaluator_actions = evaluator_inner.act_many(reached, {})
                for handle in reached:
                    decision = decisions[handle]
                    target_position = tuple(decision["decision_position"])
                    target_direction = int(decision["decision_direction"])
                    target = (target_position, target_direction)
                    probs = evaluator_inner.last_action_probs.get(handle) or []
                    folded_probabilities = _fold_onto_options(fork, target, decision["options"], probs)
                    valid_options = {int(option["action"]) for option in decision["options"]}
                    per_option = {
                        option: folded_probabilities.get(option, 0.0)
                        for option in valid_options
                    } or folded_probabilities
                    if not per_option:
                        continue
                    action = max(per_option, key=per_option.__getitem__)
                    raw_policy_action = _action_int(evaluator_actions.get(handle, action))
                    action_values = _counterfactual_action_values(
                        fork,
                        evaluator_inner,
                        handle,
                        running_actions,
                        evaluator_inner.last_observations.get(handle),
                    )
                    values = action_values["values"]
                    visible_values = _fold_values_onto_options(
                        fork, target, decision["options"], values
                    )
                    raw_seen_counts = getattr(evaluator_inner, "last_action_seen_counts", {}).get(handle)
                    raw_count_spread = getattr(evaluator_inner, "last_action_seen_count_spread", {}).get(handle)
                    raw_count_predictions = getattr(
                        evaluator_inner, "last_action_seen_count_predictions", {}
                    ).get(handle, [])
                    seen_counts = (
                        _fold_onto_options(fork, target, decision["options"], raw_seen_counts)
                        if raw_seen_counts is not None else {}
                    )
                    count_spread = _fold_ensemble_count_spread(
                        fork, target, decision["options"], raw_count_predictions, per_option
                    ) if raw_count_predictions else (
                        _fold_onto_options(fork, target, decision["options"], raw_count_spread)
                        if raw_count_spread is not None else {}
                    )
                    raw_count_sources = getattr(evaluator_inner, "last_action_seen_count_sources", {}).get(handle, {})
                    seen_count_sources = {
                        source: {
                            str(option): round(value, 4)
                            for option, value in _fold_onto_options(
                                fork, target, decision["options"], counts
                            ).items()
                        }
                        for source, counts in raw_count_sources.items()
                    }
                    option_seen_counts = (
                        {
                            str(action): round(seen_counts.get(action, 0.0), 4)
                            for action in per_option
                        }
                        if raw_seen_counts is not None else {}
                    )
                    from app.policies.learned.learned_ppo_policy import count_uncertainty_percent

                    option_seen_uncertainty = {
                        str(action): round(
                            count_uncertainty_percent(
                                seen_counts.get(action, 0.0), count_spread.get(action, 0.0)
                            ),
                            1,
                        )
                        for action in per_option
                    }
                    best_action = max(visible_values, key=visible_values.__getitem__) if visible_values else None
                    simulation_action = _action_int(running_actions.get(handle))
                    results[handle] = {
                        "available": True,
                        "done": False,
                        "handle": int(handle),
                        "step": now,
                        "stepsAhead": ahead,
                        "decisionPosition": list(target_position),
                        "action": action,
                        "probability": round(per_option[action], 4),
                        "policyAction": action,
                        "rawPolicyAction": raw_policy_action,
                        "policyProbability": round(per_option[action], 4),
                        "optionProbabilities": {str(a): round(p, 4) for a, p in per_option.items()},
                        "probabilities": [round(float(p), 4) for p in probs],
                        "stateValue": action_values["state_value"],
                        "observationAvailable": evaluator_inner.last_observations.get(handle) is not None,
                        "forecastSteps": ahead,
                        "actionValues": values,
                        "advantages": action_values["advantages"],
                        "actionSeenCounts": option_seen_counts,
                        "actionSeenCountsExact": bool(
                            getattr(evaluator_inner, "last_action_seen_count_exact", {}).get(handle, False)
                        ),
                        "actionSeenCountsBySource": seen_count_sources,
                        "actionSeenCountSpread": {
                            str(a): round(value, 4) for a, value in count_spread.items()
                        },
                        "actionSeenCountUncertainty": option_seen_uncertainty,
                        "bestAction": best_action,
                        "bestValue": round(visible_values[best_action], 4) if best_action is not None else None,
                        "overrideAction": committed.get(int(handle)),
                        "overrideValue": values.get(str(committed[int(handle)])) if int(handle) in committed else None,
                        "executedActionSource": "override" if int(handle) in committed else "policy",
                        "overridden": int(handle) in committed,
                        "policy": policy_id,
                        "simulationPolicy": session_policy_id,
                        "simulationAction": simulation_action,
                    }
            if len(results) == len(handles):
                break
            if fork.dones.get("__all__"):
                break
            fork.step(running_actions)
    finally:
        override_manager.clear_all(fork_id)
    for handle in handles:
        if handle in results:
            continue
        agent = fork.agents[handle]
        results[handle] = {
            "available": False,
            "done": _agent_is_done(agent),
            "reason": "done" if _agent_is_done(agent) else "not-reached",
            "handle": handle,
            "step": now,
            "policy": policy_id,
            "simulationPolicy": session_policy_id,
        }
    return _remember(_ai_choice_cache, key, results)


def _agent_is_done(agent) -> bool:
    state = getattr(agent, "state", None)
    return getattr(state, "name", str(state)) == "DONE"


def _action_int(action) -> int | None:
    if action is None:
        return None
    return int(action.value) if hasattr(action, "value") else int(action)


def _action_for_policy_at_target(env, policy_id: str, handle: int, target, committed) -> int | None:
    """Read the running policy's action at the same decision point.

    The evaluation policy may be Online PPO v2 while the live session runs a
    rule-based policy. This private fork keeps that comparison side-effect free.
    """
    from app.core.override_manager import override_manager
    from app.core.scenario_runner import TrajectoryBranchRunner
    from app.policies.override_policy import OverridePolicy

    factory = _branch_factory(policy_id)
    fork = TrajectoryBranchRunner(env, factory)._fork_env()
    inner = factory()
    inner.reset(fork)
    fork_id = f"branch-simulation-{id(fork)}"
    for agent_handle, action in committed.items():
        override_manager.set(fork_id, int(agent_handle), int(action))
    policy = OverridePolicy(inner, fork_id)
    policy.reset(fork)
    try:
        for _ in range(AI_CHOICE_MAX_STEPS + 1):
            agent = fork.agents[handle]
            here = (tuple(agent.position) if agent.position is not None else None,
                    int(agent.direction) if agent.direction is not None else None)
            policy.start_step()
            actions = policy.act_many(fork.get_agent_handles(), {})
            policy.end_step()
            if here == target:
                if handle not in actions:
                    return None
                action = actions[handle]
                return int(action.value) if hasattr(action, "value") else int(action)
            if fork.dones.get("__all__"):
                break
            fork.step(actions)
    finally:
        override_manager.clear_all(fork_id)
    return None


def _counterfactual_action_values(env, policy, handle: int, base_actions: dict,
                                  observation, gamma: float = ACTION_VALUE_GAMMA) -> dict:
    """Evaluate valid raw actions from one state with a one-step PPO critic."""
    from app.core.scenario_runner import TrajectoryBranchRunner

    if observation is None:
        return {"state_value": None, "values": {}, "advantages": {}}

    mask = observation[36:41]
    state_value = round(policy.value_estimate(env, handle), 4)
    values: dict[str, float | None] = {str(action): None for action in range(5)}
    advantages: dict[str, float | None] = {str(action): None for action in range(5)}
    for action, allowed in enumerate(mask):
        if float(allowed) < 0.5:
            continue
        branch = TrajectoryBranchRunner(env, None)._fork_env()
        action_map = dict(base_actions)
        action_map[int(handle)] = action
        try:
            _, rewards, dones, _ = branch.step(action_map)
        except Exception:
            continue
        reward = float(rewards.get(int(handle), 0.0))
        next_value = 0.0 if dones.get(int(handle)) or dones.get("__all__") else policy.value_estimate(branch, handle)
        value = reward + gamma * next_value
        values[str(action)] = round(value, 4)
        advantages[str(action)] = round(value - state_value, 4)
    return {"state_value": state_value, "values": values, "advantages": advantages}


STOP = 4


def _fold_ensemble_count_spread(env, configuration, options, head_predictions, visible_actions):
    folded_heads = [
        _fold_onto_options(env, configuration, options, predictions)
        for predictions in head_predictions
    ]
    if not folded_heads:
        return {}
    spreads = {}
    for action in visible_actions:
        values = [head.get(action, 0.0) for head in folded_heads]
        mean = sum(values) / len(values)
        spreads[action] = math.sqrt(sum((value - mean) ** 2 for value in values) / len(values))
    return spreads


def _fold_onto_options(env, configuration, options: list[dict], probs: list[float]) -> dict[int, float]:
    """Probability per HMI option action (plus STOP), from the raw action
    probabilities at the decision cell. Each raw action is resolved with the
    rail's own transition (`apply_action_independent`) to the cell it enters,
    and matched to the option leading there."""
    from flatland.envs.rail_env_action import RailEnvActions

    by_target = {tuple(o["target_position"]): int(o["action"]) for o in options}
    out: dict[int, float] = {}
    for raw, p in enumerate(probs):
        if p <= 0:
            continue
        if raw == STOP:
            key = STOP
        else:
            moved = env.rail.apply_action_independent(RailEnvActions.from_value(raw), configuration)
            if moved is None:
                continue
            (new_position, _), _ = moved
            key = by_target.get(tuple(int(v) for v in new_position), raw)
        out[key] = out.get(key, 0.0) + float(p)
    return out


def _fold_values_onto_options(
    env, configuration, options: list[dict], values: dict[str, float | None]
) -> dict[int, float]:
    """Map raw PPO action values onto the visible HMI options.

    Raw actions 0 (do nothing) and 2 (forward) can represent the same visible
    movement. The table needs the best value per visible option, not a hidden
    raw action that cannot be highlighted.
    """
    from flatland.envs.rail_env_action import RailEnvActions

    by_target = {tuple(o["target_position"]): int(o["action"]) for o in options}
    out: dict[int, float] = {}
    for raw_text, value in values.items():
        if value is None:
            continue
        raw = int(raw_text)
        if raw == STOP:
            key = STOP
        else:
            moved = env.rail.apply_action_independent(
                RailEnvActions.from_value(raw), configuration
            )
            if moved is None:
                continue
            (new_position, _), _ = moved
            key = by_target.get(tuple(int(v) for v in new_position))
            if key is None:
                continue
        out[key] = max(out.get(key, float("-inf")), float(value))
    return out


def _remember(cache: dict, key: tuple, value: dict) -> dict:
    if len(cache) > 256:
        cache.clear()
    cache[key] = value
    return value


# ── origin snapshot and strategy choices ───────────────────────────────

def note_origin(session, owner: Optional[str]) -> None:
    """Fork the env at the first human override of a lab session (before the
    override takes effect). "AI alone" starts from here."""
    if owner not in (None, "human") or getattr(session, "lab_origin", None) is not None:
        return
    if not is_learned(_policy_id(session)):
        return
    try:
        from app.core.scenario_runner import TrajectoryBranchRunner

        env = session.env
        session.lab_origin = {
            "step": int(getattr(env, "_elapsed_steps", 0) or 0),
            "env": TrajectoryBranchRunner(env, None)._fork_env(),
            "policy": _policy_id(session),
        }
    except Exception as exc:  # the review loses a row; the override must not fail
        log.warning("lab origin snapshot failed: %s", exc)


def clear_origin(session) -> None:
    session.lab_origin = None


def choices_path(session_id: str) -> Path:
    return intervention_log.runs_dir() / session_id / "choices.jsonl"


def record_choice(session_id: str, session, strategy: str, offered: Optional[dict],
                  mode: Optional[str] = None) -> None:
    """One line per strategy applied in a lab session: the chosen id, what was
    offered (ids, metrics, the AI's pick) and whether it kept the AI's course."""
    if not is_learned(_policy_id(session)) or session_id.startswith("branch-"):
        return
    try:
        env = session.env
        line = {
            "t": time.time(),
            "session_id": session_id,
            "step": int(getattr(env, "_elapsed_steps", 0) or 0),
            "mode": mode,
            "policy": _policy_id(session),
            "chosen": strategy,
            "kept_ai": strategy == "keep",
            "recommended": (offered or {}).get("recommended"),
            "offered": [
                {"id": s["id"], "kind": s["kind"], "metrics": s.get("metrics")}
                for s in (offered or {}).get("strategies", [])
            ],
        }
        path = choices_path(session_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(line) + "\n")
    except Exception as exc:
        log.warning("lab choice log failed: %s", exc)


# ── the review ─────────────────────────────────────────────────────────

def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    out = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(raw))
        except ValueError:
            continue
    return out


def _outcome(env, policy_factory, overrides: dict, until: int) -> dict:
    """Roll a fork of `env` to step `until` (the episode end) and measure it."""
    from flatland.envs.step_utils.states import TrainState

    from app.core.scenario_runner import TrajectoryBranchRunner

    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    runner = TrajectoryBranchRunner(env, policy_factory, timed_routes=False)
    # run_branch measures on its own fork; keep that fork to read arrivals.
    forks: list = []
    original = runner._fork_env

    def keep_fork():
        forked = original()
        forks.append(forked)
        return forked

    runner._fork_env = keep_fork
    res = runner.run_branch(overrides=overrides, max_steps=max(0, until - now), detect_deadlocks=False)
    end_env = forks[0]
    end = int(getattr(end_env, "_elapsed_steps", until) or until)
    lateness = 0
    arrived = 0
    for a in end_env.agents:
        latest = getattr(a, "latest_arrival", None)
        if a.state == TrainState.DONE:
            arrived += 1
            reached = getattr(a, "arrival_time", None)
            reached = int(reached) if reached is not None else end
        else:
            reached = end
        if latest is not None:
            lateness += max(0, reached - int(latest))
    return {
        "arrived": arrived,
        "trains": len(end_env.agents),
        "lateness": int(lateness),
        "deadlocks": int(res.kpis.get("deadlocks", 0) or 0),
        "endStep": end,
    }


def review(session_id: str, session, *, outcomes: bool = True) -> dict:
    """The AI Track Record of a lab session (widget A3, first cut)."""
    from app.core.override_manager import override_manager
    from app.policies.learned.lab_checkpoints import path_for_policy_id, read_meta

    policy_id = _policy_id(session)
    env = session.env
    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    lines = [ln for ln in _read_jsonl(intervention_log.log_path(session_id)) if ln.get("owner") == "human"]
    choices = _read_jsonl(choices_path(session_id))
    origin = getattr(session, "lab_origin", None)

    by_mode: dict[str, dict] = {}
    for ln in lines:
        m = by_mode.setdefault(ln.get("mode") or "unknown", {"interventions": 0, "agreed": 0})
        m["interventions"] += 1
        m["agreed"] += int(bool(ln.get("agreed")))
    agreed = sum(int(bool(ln.get("agreed"))) for ln in lines)
    since = origin["step"] if origin else (min((ln.get("step", now) for ln in lines), default=now))
    span = max(1, now - since)

    payload: dict[str, Any] = {
        "available": is_learned(policy_id) or bool(lines),
        "learned": is_learned(policy_id),
        "policy": policy_id,
        "step": now,
        "interventions": len(lines),
        "agreed": agreed,
        "agreementRate": round(agreed / len(lines), 4) if lines else None,
        "ratePer100Steps": round(100 * len(lines) / span, 2) if lines else 0.0,
        "sinceStep": since if lines else None,
        "byMode": by_mode,
        "choices": {
            "total": len(choices),
            "keptAi": sum(int(bool(c.get("kept_ai"))) for c in choices),
            "followedRecommendation": sum(int(c.get("chosen") == c.get("recommended")) for c in choices),
        },
        "outcomes": [],
        "originStep": origin["step"] if origin else None,
    }
    if not outcomes or not is_learned(policy_id):
        return payload

    committed = dict(override_manager.get_all(session_id))
    key = (session_id, now, policy_id, origin["step"] if origin else None, len(lines), tuple(sorted(committed.items())))
    if key in _review_cache:
        payload["outcomes"] = _review_cache[key]
        return payload

    until = int(getattr(env, "_max_episode_steps", 0) or now + 500)
    rows: list[dict] = []
    try:
        rows.append({"id": "with-you", "policy": policy_id,
                     **_outcome(env, _branch_factory(policy_id), committed, until)})
        if origin is not None:
            rows.append({"id": "ai-alone", "policy": origin["policy"], "fromStep": origin["step"],
                         **_outcome(origin["env"], _branch_factory(origin["policy"]), {}, until)})
            base = _previous_checkpoint(origin["policy"], path_for_policy_id, read_meta)
            if base is not None:
                base_id, base_path = base
                rows.append({"id": "previous-checkpoint", "policy": base_id, "fromStep": origin["step"],
                             **_outcome(origin["env"], _checkpoint_factory(base_path), {}, until)})
    except Exception as exc:  # a broken fork costs the rows, not the review
        log.warning("lab review outcome failed: %s", exc)
        payload["outcomeError"] = f"{type(exc).__name__}: {exc}"
    _remember(_review_cache, key, rows)  # type: ignore[arg-type]
    payload["outcomes"] = rows
    return payload


def _previous_checkpoint(policy_id: str, path_for_policy_id, read_meta) -> Optional[tuple[str, Path]]:
    """The checkpoint a lab checkpoint was trained from (its sidecar `base`)."""
    path = path_for_policy_id(policy_id)
    if path is None:
        return None
    base = read_meta(path).get("base")
    if not base:
        return None
    base_path = Path(base)
    if not base_path.is_absolute():
        base_path = Path(__file__).resolve().parents[2] / base_path
    if not base_path.is_file():
        return None
    from app.policies.learned.lab_checkpoints import LAB_POLICY_PREFIX, checkpoints_dir

    if base_path.parent.resolve() == checkpoints_dir().resolve():
        return LAB_POLICY_PREFIX + base_path.stem, base_path
    if base_path.stem == "ecml2026_ppo":
        return "learned_ppo", base_path
    return base_path.stem, base_path


def _checkpoint_factory(path: Path):
    def make():
        from app.policies.learned.learned_ppo_policy import LearnedPpoPolicy
        return LearnedPpoPolicy(checkpoint=path)
    return make
