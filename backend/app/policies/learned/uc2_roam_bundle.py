"""Verified neural models, one per infrastructure; importing this loads no Torch.

The four UC2 scenarios run on one track and share one scenario-blind model
(it declares ``blind_inputs`` for the scenario one-hot); the tutorial has its
own track and model. See docs/plans/uc2-rl-per-infrastructure.md.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.policies.learned import uc2_bundle

POLICY_ID = uc2_bundle.POLICY_ID
SCENARIOS = uc2_bundle.SCENARIOS
MANIFEST = Path(__file__).parent / 'checkpoints' / 'uc2_roam_specialists.json'
MANIFEST_SHA256 = 'b125e9cfef9e8669b4bd733299d418b4e247810eb961e810a6d00d96ac22f689'
INFRASTRUCTURES = {
    'tutorial': ('tutorial',),
    'uc2-track': ('uc2-1', 'uc2-2', 'uc2-3', 'uc2-4'),
}
INFRASTRUCTURE_FILES = {'tutorial': 'uc2_roam_tutorial.pt', 'uc2-track': 'uc2_roam_uc2_track.pt'}
MODEL_FILES = {scenario: INFRASTRUCTURE_FILES[infrastructure]
               for infrastructure, scenarios in INFRASTRUCTURES.items() for scenario in scenarios}


def available() -> bool:
    return (uc2_bundle.available() and MANIFEST.is_file()
            and all((MANIFEST.parent / name).is_file() for name in INFRASTRUCTURE_FILES.values()))


def verify_bundle() -> dict:
    """Fail closed on altered/missing models; retain the baseline identity."""
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
                or set(manifest.get('models', {})) != set(SCENARIOS)
                or manifest.get('infrastructures') != {
                    name: {'file': INFRASTRUCTURE_FILES[name], 'scenarios': list(scenarios)}
                    for name, scenarios in INFRASTRUCTURES.items()}):
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


def infrastructure_for_scenario(scenario: str) -> str:
    for infrastructure, scenarios in INFRASTRUCTURES.items():
        if scenario in scenarios:
            return infrastructure
    raise ValueError(f'UC2 ROAM has no infrastructure specialist: {scenario}')


def checkpoint_for_scenario(scenario: str) -> Path:
    """Select only from immutable fixture identity (via its infrastructure), never rollout data."""
    return MANIFEST.parent / INFRASTRUCTURE_FILES[infrastructure_for_scenario(scenario)]


def teacher_checkpoint(scenario: str) -> Path:
    """The pinned per-scenario teacher of the UC2-track model (training input, never loaded at runtime)."""
    entry = verify_bundle().get('teachers', {}).get('models', {}).get(scenario)
    if entry is None:
        raise ValueError(f'UC2 ROAM has no teacher for scenario: {scenario}')
    path = MANIFEST.parent / entry['file']
    if hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
        raise ValueError(f'UC2 ROAM teacher model changed: {scenario}')
    return path


def compatibility_error(env):
    return uc2_bundle.compatibility_error(env)


def require_compatible(env):
    return uc2_bundle.require_compatible(env)
