"""Intervention log for the MARL lab — docs/plans/marl-lab-plan.md, step 2.

When a session runs under a learned policy and a human override takes effect,
one JSON line records the state the policy saw, what the policy wanted and what
the human chose. That (state, AI action, human action) triple is exactly what
learning-from-interventions needs (HG-DAgger, IWR); step 3 reads these files.

Two moments, because an override is *requested* in the HMI and *applied* later,
at the train's next decision point (`OverridePolicy`):

- `note_request` (POST /agent/{handle}/override) remembers the mode, the owner
  and the step of the request;
- `record_applied` (OverridePolicy, at the decision point) writes the line,
  with the observation and the policy's action probabilities of *that* step.

Only policies that expose `intervention_features(handle)` — today the learned
PPO — produce lines, so nothing changes for any other session. Branch sessions
(what-if rollouts, id `branch-…`) are never logged. Writing is best-effort: a
read-only disk (the Space image) must never break stepping.

Files: `<runs dir>/<session_id>/interventions.jsonl`, the runs dir being
`MARL_LAB_RUNS_DIR` or `backend/lab/runs` (gitignored).
"""
from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

_DEFAULT_RUNS_DIR = Path(__file__).resolve().parents[2] / "lab" / "runs"

# (session_id, handle) -> what the HMI said when the override was requested.
_requests: dict[tuple[str, int], dict[str, Any]] = {}
_warned = False


def _as_int(action: Any) -> int:
    # RailEnvActions is a plain Enum in flatland 4.2, so int() needs its value.
    return int(getattr(action, "value", action))


def runs_dir() -> Path:
    return Path(os.environ.get("MARL_LAB_RUNS_DIR") or _DEFAULT_RUNS_DIR)


def log_path(session_id: str) -> Path:
    return runs_dir() / session_id / "interventions.jsonl"


def _loggable(session_id: str) -> bool:
    return bool(session_id) and not session_id.startswith("branch-")


def note_request(session_id: str, handle: int, action: int, *, step: int,
                 mode: Optional[str] = None, owner: Optional[str] = None) -> None:
    if not _loggable(session_id):
        return
    _requests[(session_id, int(handle))] = {
        "action": int(action),
        "requested_step": int(step),
        "mode": mode,
        "owner": owner,
    }


def record_applied(session_id: str, env: Any, handle: int, policy: Any,
                   ai_action: Any, human_action: Any) -> None:
    """Write one line if `policy` can describe what it saw for `handle`."""
    global _warned
    if not _loggable(session_id):
        return
    features = getattr(policy, "intervention_features", None)
    if features is None:
        return
    try:
        seen = features(int(handle))
        if seen is None:
            return
        request = _requests.setdefault((session_id, int(handle)), {})
        # STOP is sticky (re-applied every step until cleared): one line per
        # request, not one per step it holds.
        if request.get("logged"):
            return
        line = {
            "t": time.time(),
            "session_id": session_id,
            "step": int(getattr(env, "_elapsed_steps", 0) or 0),
            "handle": int(handle),
            "mode": request.get("mode"),
            "owner": request.get("owner"),
            "requested_step": request.get("requested_step"),
            "ai_action": _as_int(ai_action),
            "human_action": _as_int(human_action),
            "agreed": _as_int(ai_action) == _as_int(human_action),
            **seen,
        }
        path = log_path(session_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(line) + "\n")
        request["logged"] = True
    except Exception as exc:  # never let logging break a step
        if not _warned:
            log.warning("intervention log disabled for this process: %s", exc)
            _warned = True


def forget_session(session_id: str) -> None:
    for key in [k for k in _requests if k[0] == session_id]:
        del _requests[key]
