"""Fixed, portable PF-CH inference asset; importing this module needs no Torch.

The bundle is independent of the writable MARL lab directory. The model was
trained on the fifteen published PF-CH fixtures; it is not a general dispatcher.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

POLICY_ID = "pf_ch_rl"
CHECKPOINT = Path(__file__).parent / "checkpoints" / "pf_ch_demo_ppo.pt"
SOURCE_CHECKPOINT_SHA256 = "73afbad39106ac972884d0ef88cf99e44cf50861593a4146179cd5a83aa9d5d5"
OBSERVATION_SCHEMA = "pf-ch-context-v1"
OBS_SIZE = 272
_SCENES = frozenset({
    "scene_pf_ch_corridor", "scene_pf_ch_corridor_stops", "scene_pf_ch_wn_wal_conflict",
    "scene_pf_ch_wn_wal_long_approach", "scene_pf_ch_wn_wal_connections",
})


def available() -> bool:
    return CHECKPOINT.is_file() and CHECKPOINT.with_suffix(".json").is_file()


def verify_bundle() -> dict:
    """Fail clearly on a missing or mixed model/manifest pair, without Torch."""
    try:
        meta = json.loads(CHECKPOINT.with_suffix(".json").read_text(encoding="utf-8"))
        digest = hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest()
    except (OSError, ValueError) as exc:
        raise ValueError("PF-CH RL model bundle is unavailable or unreadable") from exc
    if (not isinstance(meta, dict) or meta.get("checkpoint_sha256") != digest
            or meta.get("source_checkpoint_sha256") != SOURCE_CHECKPOINT_SHA256
            or meta.get("observation_schema") != OBSERVATION_SCHEMA
            or meta.get("obs_size") != OBS_SIZE):
        raise ValueError("PF-CH RL model bundle failed its identity/schema check")
    return meta


def compatibility_error(env: Any) -> str | None:
    """Match the verified context builder's geometry/handle contract."""
    if (env.height, env.width) != (9, 191):
        return "PF-CH RL requires a PF-CH infrastructure (9 × 191 cells)"
    scene = getattr(env, "_infrastructure_scene", None)
    if scene is not None and (not isinstance(scene, dict) or scene.get("id") not in _SCENES):
        return "PF-CH RL supports only the five published PF-CH infrastructures"
    handles = [int(agent.handle) for agent in env.agents]
    if (not 1 <= len(handles) <= 16 or len(set(handles)) != len(handles)
            or any(handle < 0 or handle >= 16 for handle in handles)):
        return "PF-CH RL requires one to sixteen trains with unique handles in 0..15"
    return None


def require_compatible(env: Any) -> None:
    error = compatibility_error(env)
    if error is not None:
        raise ValueError(error)
