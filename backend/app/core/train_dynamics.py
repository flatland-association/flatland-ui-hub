"""Optional vehicle dynamics for a session — docs/plans/train-dynamics-probe.md.

The physics are a local port of Adrian Egli's FlatlandDynamics
(`backend/vendor_local/flatland_dynamics_port/`, excluded from git: parts of it
carry a non-commercial clause that does not fit this repository's Apache-2.0
licence). This module only finds that port and wires it in; without it the
option does not exist, the same way the learned policy disappears without
torch.

Three hooks, all no-ops for an env without dynamics:

- `attach(env)`        when a session is created with `dynamics=True`;
- `carry_to_fork()`    for what-if forks rebuilt from a file (the persister
                       fork drops anything that is not Flatland state);
- `agent_view()`       speed, braking and occupied cells for the HMI.
"""
from __future__ import annotations

import importlib
import logging
import sys
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

_VENDOR_DIR = Path(__file__).resolve().parents[2] / "vendor_local"
_MODULE = "flatland_dynamics_port"
_port: Any = None
_checked = False


def _load():
    global _port, _checked
    if not _checked:
        _checked = True
        if _VENDOR_DIR.is_dir() and str(_VENDOR_DIR) not in sys.path:
            sys.path.insert(0, str(_VENDOR_DIR))
        try:
            _port = importlib.import_module(_MODULE)
        except ImportError:
            _port = None
    return _port


def available() -> bool:
    return _load() is not None


def is_active(env) -> bool:
    return getattr(env, "_dynamics", None) is not None


def attach(env, profile: Optional[dict] = None) -> bool:
    """Give `env` vehicle dynamics. False (and no change) where the port is
    not installed."""
    port = _load()
    if port is None:
        log.warning("dynamics requested but %s is not installed (see train-dynamics-probe.md)", _MODULE)
        return False
    port.attach(env, port.DynamicsProfile(**(profile or {})))
    return True


def carry_to_fork(base_env, fork) -> None:
    """The same physical state on a fork that was rebuilt from a file."""
    ctrl = getattr(base_env, "_dynamics", None)
    if ctrl is None:
        return
    _load().attach(fork, controller=ctrl.clone_for(fork))


def agent_view(env, handle: int) -> Optional[dict]:
    ctrl = getattr(env, "_dynamics", None)
    if ctrl is None:
        return None
    try:
        return ctrl.agent_view(int(handle))
    except Exception:  # a broken view must never break serialising the state
        return None


def session_info(env) -> Optional[dict]:
    ctrl = getattr(env, "_dynamics", None)
    if ctrl is None:
        return None
    p = ctrl.profile
    return {
        "timeStepS": round(p.time_step_s, 2),
        "cellLengthM": p.cell_length_m,
        "lineSpeedKmh": p.line_speed_kmh,
        "trainLengthM": p.train_length_m,
        "brakingMs2": p.braking_ms2,
    }
