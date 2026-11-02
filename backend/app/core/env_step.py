"""The one helper around `env.step` for a live session
(docs/plans/experiment-logging-frontend-and-replay.md §5.4.2).

Used by the `/step` and `/action` endpoints and the WebSocket play loop, so
whatever has to happen around every step of a live session (scripted
disturbances, the trajectory recorder) is written once.
Sandbox and what-if forks step their own copies and do not use it.
"""

from typing import Any, Optional


def step_env(session_id: str, session, actions: dict, *, disturbances: bool = True, policy: Any = None, policy_id: Optional[str] = None) -> tuple[Any, Any, Any, Any]:
    """Step `session.env` with `actions` and keep the session's last
    observations and info. `disturbances`: fire the scripted disturbances due
    at the new step (the manual `/action` endpoint never has). `policy`: the
    `OverridePolicy` that chose `actions`, and `policy_id` its id (default:
    `session.policy`), for the trajectory's provenance.
    Returns `env.step`'s `(obs, rewards, dones, info)`; exceptions propagate."""
    from app.core.disturbances import apply_due_disturbances
    from app.core.trajectory_recorder import recorder_for

    env = session.env
    recorder = recorder_for(session)
    if recorder is not None and not _is_done(env):
        recorder.before_step(
            env,
            actions,
            proposed=getattr(policy, "last_proposed", None),
            sources=getattr(policy, "last_sources", None) if policy is not None else {h: "manual" for h in actions},
            policy=policy_id or session.policy,
        )
    else:
        recorder = None  # a step on a finished episode raises; nothing to record
    next_obs, rewards, dones, info = env.step(actions)
    session.last_observations = next_obs
    session.last_info = info
    fired = []
    if disturbances:
        # Fired against the state the step just produced, so a delay
        # injected at step N is visible from step N onwards.
        fired = apply_due_disturbances(session_id, session, env)
    if recorder is not None:
        recorder.after_step(env, rewards, dones, info, fired)
    return next_obs, rewards, dones, info


def _is_done(env) -> bool:
    dones = getattr(env, "dones", None) or {}
    return bool(dones.get("__all__", False))
