"""Verified neural infrastructure specialists; importing this loads no Torch."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.policies.learned import uc2_bundle

POLICY_ID = uc2_bundle.POLICY_ID
SCENARIOS = uc2_bundle.SCENARIOS
MANIFEST = Path(__file__).parent / 'checkpoints' / 'uc2_roam_specialists.json'
MANIFEST_SHA256 = 'ff5ff8a28a87f86dbc3b5ca2cb35749fdfd0a7a819967cbafd8d38279bf5b889'
MODEL_FILES = {
    'tutorial': 'uc2_demo_ppo.pt', 'uc2-1': 'uc2_roam_uc2_1.pt',
    'uc2-2': 'uc2_roam_uc2_2.pt', 'uc2-3': 'uc2_demo_ppo.pt',
    'uc2-4': 'uc2_roam_uc2_4.pt',
}


def available() -> bool:
    return (uc2_bundle.available() and MANIFEST.is_file()
            and all((MANIFEST.parent / name).is_file() for name in MODEL_FILES.values()))


def verify_bundle() -> dict:
    """Fail closed on altered/missing specialists; retain the baseline identity."""
    uc2_bundle.verify_bundle()
    try:
        raw = MANIFEST.read_bytes()
        manifest = json.loads(raw)
        if (hashlib.sha256(raw).hexdigest() != MANIFEST_SHA256
                or manifest.get('schema') != 'uc2-roam-infrastructure-specialists-v1'
                or manifest.get('observation_schema') != uc2_bundle.OBSERVATION_SCHEMA
                or manifest.get('selector') != 'immutable_native_fixture_identity_only'
                or manifest.get('guard') != {'kind': 'joint_roam', 'partial_moves': True,
                                           'max_candidates': 60, 'motion_logit_bias': 0,
                                           'planner_fallback': False}
                or set(manifest.get('models', {})) != set(SCENARIOS)):
            raise ValueError('UC2 ROAM specialist manifest failed its identity check')
        checked = {}
        for scenario, filename in MODEL_FILES.items():
            entry = manifest['models'][scenario]
            if entry.get('file') != filename:
                raise ValueError(f'UC2 ROAM specialist filename changed: {scenario}')
            if filename not in checked:
                checked[filename] = hashlib.sha256((MANIFEST.parent / filename).read_bytes()).hexdigest()
            if checked[filename] != entry.get('sha256'):
                raise ValueError(f'UC2 ROAM specialist model changed: {scenario}')
        return manifest
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError('UC2 ROAM specialist bundle is unavailable or invalid') from exc


def checkpoint_for_scenario(scenario: str) -> Path:
    """Select only from immutable fixture identity, never current rollout data."""
    if scenario not in MODEL_FILES:
        raise ValueError(f'UC2 ROAM has no infrastructure specialist: {scenario}')
    return MANIFEST.parent / MODEL_FILES[scenario]


def compatibility_error(env):
    return uc2_bundle.compatibility_error(env)


def require_compatible(env):
    return uc2_bundle.require_compatible(env)
