"""The one helper around `env.step` for a live session
(docs/plans/experiment-logging-frontend-and-replay.md §5.4.2).

Used by the `/step` and `/action` endpoints and the WebSocket play loop, so
whatever has to happen around every step of a live session (scripted
disturbances now, the trajectory recorder in a later step) is written once.
Sandbox and what-if forks step their own copies and do not use it.
"""

from typing import Any


def step_env(session_id: str, session, actions: dict, *, disturbances: bool = True) -> tuple[Any, Any, Any, Any]:
    """Step `session.env` with `actions` and keep the session's last
    observations and info. `disturbances`: fire the scripted disturbances due
    at the new step (the manual `/action` endpoint never has). Returns
    `env.step`'s `(obs, rewards, dones, info)`; exceptions propagate."""
    from app.core.disturbances import apply_due_disturbances

    env = session.env
    next_obs, rewards, dones, info = env.step(actions)
    session.last_observations = next_obs
    session.last_info = info
    if disturbances:
        # Fired against the state the step just produced, so a delay
        # injected at step N is visible from step N onwards.
        apply_due_disturbances(session_id, session, env)
    return next_obs, rewards, dones, info
