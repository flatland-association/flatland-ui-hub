"""Start-of-run plans, computed once and kept — so a Director tour is ready at once.

At step 0 of a given scenario the Director's work is the same every time: the
first plan, and the three strategy options planned from it. On the 16-train
corridor that is about two minutes (first plan ~30 s, options ~75-140 s) of
waiting for an answer that cannot differ from the last run's. So both are kept
on disk, keyed by a fingerprint of everything they depend on, and a script
precomputes them for the tour scenarios
(`scripts/precompute_director_step0.py`).

"Step 0" is the start of a run, not only its first step: a fresh session
advances by itself until the first train moves (a few steps), and the strategy
tiles plan from there. So an answer is kept for any state within the first
`START_WINDOW` steps, keyed by that state.

The fingerprint covers the network, every train's start, target, time windows
and stops, its current state, position and breakdown counter, the step, the
objective weights, the plan an answer is compared against, a live run's seed (random breakdowns can
change what a plan's rollouts meet), the checkpoints and encoder caps, and
`CACHE_VERSION`. Any change there is a different key and plans afresh — an
unmatched key is never "close enough". Bump `CACHE_VERSION` when the planner's
code changes what it would return.

Files live in `app/fixtures/director_step0/`: `<key>.plan.pkl` (the first plan's
schedules and info, what `GoalDirectedPolicy` would set) and
`<key>.strategies.json` (the `/director/strategies` answer at step 0). Writing
at runtime is best effort — a read-only deployment still reads what shipped.
"""
from __future__ import annotations

import hashlib
import json
import os
import pickle
from pathlib import Path
from typing import Any, Optional

CACHE_VERSION = 2
# Steps from the start within which an answer is worth keeping: the start of a
# run is the same every time, mid-run states are not.
START_WINDOW = 20
CACHE_DIR = Path(__file__).resolve().parents[2] / "fixtures" / "director_step0"

_file_digests: dict[str, str] = {}


def _file_digest(path: str) -> str:
    if path not in _file_digests:
        try:
            _file_digests[path] = hashlib.sha256(Path(path).read_bytes()).hexdigest()
        except OSError:
            _file_digests[path] = "missing"
    return _file_digests[path]


def _agent_fields(agent) -> tuple:
    """Start, target, time windows and stops — flatland 4.2 and 4.3 alike."""
    init = getattr(agent, "initial_configuration", None)
    if init is None:
        init = (getattr(agent, "initial_position", None), getattr(agent, "initial_direction", None))
    targets = getattr(agent, "targets", None)
    if targets is None:
        targets = getattr(agent, "target", None)
    waypoints = [
        [(tuple(wp.position) if wp.position is not None else None, wp.direction) for wp in alternatives]
        for alternatives in (getattr(agent, "waypoints", None) or [])
    ]
    return (
        repr(init),
        repr(sorted(targets) if isinstance(targets, (set, frozenset)) else targets),
        agent.earliest_departure,
        agent.latest_arrival,
        repr(waypoints),
        repr(getattr(agent, "waypoints_earliest_departure", None)),
        repr(getattr(agent, "waypoints_latest_arrival", None)),
        repr(getattr(getattr(agent, "speed_counter", None), "max_speed", None)),
    )


def _agent_now(agent) -> tuple:
    """Where the train is and in what state — what a start-window answer depends on."""
    config = getattr(agent, "current_configuration", None)
    if config is None:
        config = (getattr(agent, "position", None), getattr(agent, "direction", None))
    handler = getattr(agent, "malfunction_handler", None)
    speed = getattr(agent, "speed_counter", None)
    return (
        repr(config),
        str(getattr(agent, "state", None)),
        getattr(handler, "malfunction_down_counter", None),
        repr(getattr(speed, "distance", getattr(speed, "counter", None))),
    )


def fingerprint(env, weights, purpose: str, against: str = "") -> str:
    """The key of a start-window answer for this env, these weights and — for
    the options — the plan they are compared `against`."""
    from app.config import settings
    from app.policies.goal_directed_policy import DEFAULT_CONNECTION_MODEL, DEFAULT_EVALUATOR

    h = hashlib.sha256()
    for part in (
        f"v{CACHE_VERSION}",
        purpose,
        against,
        int(getattr(env, "_elapsed_steps", 0) or 0),
        repr([_agent_now(a) for a in env.agents]),
        f"{env.width}x{env.height}",
        env.rail.grid.tobytes(),
        repr([_agent_fields(a) for a in env.agents]),
        repr(tuple(float(w) for w in weights)),
        repr(getattr(env, "_live_seed", None)),
        repr((settings.encoder_max_nodes, settings.encoder_max_edges, settings.encoder_max_trains,
              settings.encoder_max_schedule_nodes, settings.encoder_max_connections)),
        _file_digest(DEFAULT_EVALUATOR),
        _file_digest(DEFAULT_CONNECTION_MODEL),
    ):
        h.update(part if isinstance(part, bytes) else str(part).encode())
        h.update(b"\x00")
    return h.hexdigest()[:32]


def in_start_window(env) -> bool:
    return int(getattr(env, "_elapsed_steps", 0) or 0) <= START_WINDOW


def _enabled() -> bool:
    return os.environ.get("DIRECTOR_STEP0_CACHE", "1") != "0"


def load_plan(key: str) -> Optional[tuple[list, dict]]:
    path = CACHE_DIR / f"{key}.plan.pkl"
    if not _enabled() or not path.exists():
        return None
    try:
        with path.open("rb") as f:
            schedules, info = pickle.load(f)
        return list(schedules), dict(info)
    except Exception:
        return None


def save_plan(key: str, schedules, info: dict) -> None:
    if not _enabled():
        return
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with (CACHE_DIR / f"{key}.plan.pkl").open("wb") as f:
            pickle.dump((list(schedules), dict(info)), f)
    except Exception:
        pass


def load_strategies(key: str) -> Optional[dict[str, Any]]:
    path = CACHE_DIR / f"{key}.strategies.json"
    if not _enabled() or not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def save_strategies(key: str, payload: dict[str, Any]) -> None:
    if not _enabled():
        return
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        body = {k: v for k, v in payload.items() if k != "session_id"}
        (CACHE_DIR / f"{key}.strategies.json").write_text(json.dumps(body))
    except Exception:
        pass
