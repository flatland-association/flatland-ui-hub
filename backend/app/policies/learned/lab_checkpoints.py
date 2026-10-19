"""Where the MARL lab keeps its checkpoints, and what the registry may read.

docs/plans/marl-lab-plan.md, step 3. The trainers in `backend/lab/marl/` write
`<name>.pt` (torch) plus a `<name>.json` sidecar with what the run was. The
registry offers every `<name>.pt` as the policy `lab:<name>`.

Torch-free on purpose: the registry is imported at app startup and must not
touch torch, so it only lists files and reads the JSON sidecar here.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Optional

_DEFAULT_DIR = Path(__file__).resolve().parents[3] / "lab" / "checkpoints"

LAB_POLICY_PREFIX = "lab:"

# Names end up in policy ids, URLs and file names: keep them plain.
_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")


def checkpoints_dir() -> Path:
    return Path(os.environ.get("MARL_LAB_CHECKPOINTS_DIR") or _DEFAULT_DIR)


def valid_name(name: str) -> bool:
    return bool(_NAME.match(name))


def checkpoint_path(name: str) -> Path:
    if not valid_name(name):
        raise ValueError(f"checkpoint name {name!r}: use letters, digits, '_', '.' or '-'")
    return checkpoints_dir() / f"{name}.pt"


def list_checkpoints() -> list[Path]:
    root = checkpoints_dir()
    if not root.is_dir():
        return []
    return sorted(p for p in root.glob("*.pt") if p.is_file() and valid_name(p.stem))


def read_meta(path: Path) -> dict:
    """The JSON sidecar next to a checkpoint, or {} if there is none."""
    sidecar = Path(path).with_suffix(".json")
    try:
        return json.loads(sidecar.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_meta(path: Path, meta: dict) -> None:
    Path(path).with_suffix(".json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def policy_id(path: Path) -> str:
    return LAB_POLICY_PREFIX + Path(path).stem


def path_for_policy_id(pid: str) -> Optional[Path]:
    if not pid.startswith(LAB_POLICY_PREFIX):
        return None
    name = pid[len(LAB_POLICY_PREFIX):]
    if not valid_name(name):
        return None
    path = checkpoints_dir() / f"{name}.pt"
    return path if path.is_file() else None
