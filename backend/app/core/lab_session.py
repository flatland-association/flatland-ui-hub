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
import time
from pathlib import Path
from typing import Any, Optional

from app.core import intervention_log
from app.utils.agent_compat import agent_direction, agent_position

log = logging.getLogger(__name__)

AI_CHOICE_MAX_STEPS = 30

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

def ai_choice(session_id: str, session, handle: int) -> dict:
    """The learned policy's action and probabilities where `handle` next decides.

    `{"available": False, "reason": …}` when the session does not run a learned
    policy, the train has no decision ahead, or does not reach it within
    `AI_CHOICE_MAX_STEPS` under the AI.
    """
    from app.core.cell_classifier import lookahead_to_decision
    from app.core.override_manager import override_manager
    from app.core.scenario_runner import TrajectoryBranchRunner
    from app.policies.override_policy import OverridePolicy

    policy_id = _policy_id(session)
    if not is_learned(policy_id):
        return {"available": False, "reason": "not-learned"}
    env = session.env
    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    committed = dict(override_manager.get_all(session_id))
    key = (session_id, now, int(handle), policy_id, tuple(sorted(committed.items())))
    if key in _ai_choice_cache:
        return _ai_choice_cache[key]

    agent = env.agents[handle]
    decision = lookahead_to_decision(env, agent)
    if decision is None:
        return _remember(_ai_choice_cache, key, {"available": False, "reason": "no-decision"})
    target = (tuple(decision["decision_position"]), int(decision["decision_direction"]))

    factory = _branch_factory(policy_id)
    fork = TrajectoryBranchRunner(env, factory)._fork_env()
    inner = factory()
    inner.reset(fork)
    # A private override store id, so the committed overrides apply on the fork
    # exactly as they will on the live env, and nothing leaks into the session.
    fork_id = f"branch-lab-{session_id}-{now}-{handle}"
    for h, a in committed.items():
        override_manager.set(fork_id, int(h), int(a))
    policy = OverridePolicy(inner, fork_id)
    policy.reset(fork)
    handles = fork.get_agent_handles()
    try:
        for ahead in range(AI_CHOICE_MAX_STEPS + 1):
            a = fork.agents[handle]
            pos, direction = agent_position(a), agent_direction(a)
            here = (tuple(pos) if pos is not None else None,
                    int(direction) if direction is not None else None)
            policy.start_step()
            actions = policy.act_many(handles, {})
            policy.end_step()
            if here == target:
                # The policy's own distribution (not what an override made of
                # it), folded onto the HMI's options: several raw actions can
                # lead onto the same track (DO_NOTHING on a moving train goes
                # where FORWARD goes), so their probabilities add up.
                probs = inner.last_action_probs.get(handle) or []
                per_option = _fold_onto_options(fork, target, decision["options"], probs)
                if not per_option:
                    break
                action = max(per_option, key=per_option.__getitem__)
                result = {
                    "available": True,
                    "handle": int(handle),
                    "step": now,
                    "stepsAhead": ahead,
                    "decisionPosition": list(target[0]),
                    "action": action,
                    "probability": round(per_option[action], 4),
                    "optionProbabilities": {str(a): round(p, 4) for a, p in per_option.items()},
                    "probabilities": [round(float(p), 4) for p in probs],
                    "overridden": int(handle) in committed,
                    "policy": policy_id,
                }
                return _remember(_ai_choice_cache, key, result)
            if fork.dones.get("__all__"):
                break
            fork.step(actions)
    finally:
        override_manager.clear_all(fork_id)
    return _remember(_ai_choice_cache, key, {"available": False, "reason": "not-reached"})


STOP = 4


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
