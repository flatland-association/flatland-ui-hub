"""Portable specialist for the native Tutorial/UC2 fixtures; no eager Torch."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

POLICY_ID = "uc2_rl"
CHECKPOINT = Path(__file__).parent / "checkpoints" / "uc2_demo_ppo.pt"
SOURCE_CHECKPOINT_SHA256 = "c7d07cecb2bb8572247dd9a5fed8de829d933c48d9e557b0dbe6222c304e223e"
CHECKPOINT_SHA256 = "01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668"
MANIFEST_SHA256 = "3eb4255e58f3f8faa492feca7527087cf53f8c195aff6f46acb5bdd81804f944"
OBSERVATION_SCHEMA = "uc2-context-v1"
OBS_SIZE = 313
SCENARIOS = ("tutorial", "uc2-1", "uc2-2", "uc2-3", "uc2-4")
_FIXTURES = Path(__file__).resolve().parents[2] / "fixtures" / "plan-b"


def available() -> bool:
    return CHECKPOINT.is_file() and CHECKPOINT.with_suffix(".json").is_file()


def verify_bundle() -> dict:
    """Bind the reviewed model, portable manifest and original native fixtures."""
    try:
        sidecar = CHECKPOINT.with_suffix(".json").read_bytes()
        meta = json.loads(sidecar)
        model_hash = hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest()
    except (OSError, ValueError) as exc:
        raise ValueError("UC2 RL model bundle is unavailable or unreadable") from exc
    if (hashlib.sha256(sidecar).hexdigest() != MANIFEST_SHA256
            or model_hash != CHECKPOINT_SHA256
            or not isinstance(meta, dict) or meta.get("checkpoint_sha256") != model_hash
            or meta.get("source_checkpoint_sha256") != SOURCE_CHECKPOINT_SHA256
            or meta.get("observation_schema") != OBSERVATION_SCHEMA
            or meta.get("obs_size") != OBS_SIZE
            or meta.get("scope", {}).get("scenarios") != list(SCENARIOS)):
        raise ValueError("UC2 RL model bundle failed its identity/schema check")
    fixtures = meta.get("native_fixture_sha256", {})
    if set(fixtures) != set(SCENARIOS):
        raise ValueError("UC2 RL model bundle has incomplete native fixture provenance")
    try:
        for scenario in SCENARIOS:
            if hashlib.sha256((_FIXTURES / scenario / "scenario.pkl").read_bytes()).hexdigest() != fixtures[scenario]:
                raise ValueError(f"UC2 RL native fixture changed: {scenario}")
    except OSError as exc:
        raise ValueError("UC2 RL native fixtures are unavailable") from exc
    return meta


def compatibility_error(env: Any) -> str | None:
    """Use the runtime builder's rail, stock, handle and native horizon checks."""
    if (getattr(env, "height", None), getattr(env, "width", None)) not in {(6, 25), (8, 78)}:
        return "UC2 RL requires one of the five native Tutorial/UC2 infrastructures"
    from app.policies.learned.uc2_observation import UC2ObservationBuilder

    try:
        UC2ObservationBuilder().reset(env)
    except (ValueError, TypeError, AttributeError, IndexError) as exc:
        return f"UC2 RL requires the native Tutorial/UC2 rail, stock and horizon: {exc}"
    return None


def require_compatible(env: Any) -> None:
    error = compatibility_error(env)
    if error is not None:
        raise ValueError(error)
