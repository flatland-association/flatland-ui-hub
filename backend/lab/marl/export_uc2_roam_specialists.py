"""Export fixed infrastructure specialists as small, path-free CPU bundles."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import torch

from app.policies.learned import uc2_bundle
from app.policies.learned.learned_ppo_policy import checkpoint_hidden_size, checkpoint_observation_size


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def export(selection_path, sources_dir, output_dir):
    selection = json.loads(selection_path.read_text())
    count = selection.get('summary', {}).get('cases', 0)
    if (selection.get('schema') not in ('uc2-immutable-map-expert-selection-v1',
                                      'uc2-immutable-map-expert-selection-v2')
            or set(selection['maps']) != set(uc2_bundle.SCENARIOS)
            or not isinstance(count, int) or count < 125
            or selection['summary']['complete_missions'] != count
            or selection['summary']['worse_cases'] != 0):
        raise ValueError('An explicit successful known-case specialist selection is required')
    uc2_bundle.verify_bundle()
    output_dir.mkdir(parents=True, exist_ok=True)
    specs = {}
    for scenario in uc2_bundle.SCENARIOS:
        entry = selection['maps'][scenario]
        if scenario in ('tutorial', 'uc2-3'):
            if entry['checkpoint_sha256'] != uc2_bundle.CHECKPOINT_SHA256:
                raise ValueError('Retained baseline specialists must match the original bundle')
            specs[scenario] = {'file': uc2_bundle.CHECKPOINT.name,
                               'sha256': uc2_bundle.CHECKPOINT_SHA256,
                               'kind': 'retained_original_actor'}
            continue
        source = sources_dir / entry['checkpoint']
        if digest(source) != entry['checkpoint_sha256']:
            raise ValueError(f'Specialist source hash mismatch: {scenario}')
        payload = torch.load(source, map_location='cpu', weights_only=True)
        meta = payload['meta']
        if (meta.get('observation_schema') != uc2_bundle.OBSERVATION_SCHEMA
                or checkpoint_observation_size(payload) != 313):
            raise ValueError('Specialists must retain the reviewed current-state schema')
        tensors = {key: value.detach().cpu().clone() for key, value in payload['model'].items()}
        tensor_hash = hashlib.sha256()
        for key, tensor in sorted(tensors.items()):
            tensor_hash.update(key.encode())
            tensor_hash.update(str(tensor.dtype).encode())
            tensor_hash.update(str(tuple(tensor.shape)).encode())
            tensor_hash.update(tensor.contiguous().numpy().tobytes())
        exported_meta = {
            'kind': 'verified-teacher-bc-infrastructure-specialist',
            'observation_schema': uc2_bundle.OBSERVATION_SCHEMA,
            'obs_size': 313, 'hidden_size': checkpoint_hidden_size(payload),
            'num_hidden_layers': 3, 'infrastructure': scenario,
            'source_checkpoint_sha256': entry['checkpoint_sha256'],
            'base_checkpoint_sha256': meta.get('base_sha256'),
            'model_tensor_sha256': tensor_hash.hexdigest(),
            'epochs_completed': meta['epochs_completed'],
            'training_samples': meta['samples'],
            'training_dataset_sha256': [row['sha256'] for row in meta['datasets']],
            'training_source_sha256': meta['source_sha256'],
            'training_hyperparameters': meta['hyperparameters'],
            'training_software': meta.get('software', {}),
            'teacher_sources': meta['teacher_sources'],
            'teacher_source_counts': meta['teacher_source_counts'],
            'experience_estimator_ready': False,
        }
        # Only this allowlist crosses the training/runtime boundary. Optimizer,
        # RNG, local paths and teacher trajectories are deliberately absent.
        serialized = json.dumps(exported_meta)
        if '/Users/' in serialized or '/private/' in serialized:
            raise ValueError('Export metadata contains a private path')
        target = output_dir / ('uc2_roam_' + scenario.replace('-', '_') + '.pt')
        if target.exists():
            raise FileExistsError(target)
        torch.save({'model': tensors, 'meta': exported_meta}, target)
        specs[scenario] = {'file': target.name, 'sha256': digest(target),
                           'source_checkpoint_sha256': entry['checkpoint_sha256'],
                           'model_tensor_sha256': tensor_hash.hexdigest(),
                           'kind': exported_meta['kind']}
    manifest = {
        'schema': 'uc2-roam-infrastructure-specialists-v1',
        'observation_schema': uc2_bundle.OBSERVATION_SCHEMA,
        'selection_sha256': digest(selection_path),
        'selector': 'immutable_native_fixture_identity_only',
        'guard': {'kind': 'joint_roam', 'partial_moves': True, 'max_candidates': 60,
                  'motion_logit_bias': 0, 'planner_fallback': False},
        'training': 'Supervised PP/DLA behavior cloning in the existing PPO actor architecture',
        'selection_scope': selection.get('selection_scope', f'Known{count} development cases'),
        'development_cases': count,
        'models': specs,
    }
    manifest_path = output_dir / 'uc2_roam_specialists.json'
    if manifest_path.exists():
        raise FileExistsError(manifest_path)
    manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest_path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection', type=Path, required=True)
    parser.add_argument('--sources-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    path = export(args.selection, args.sources_dir, args.output_dir)
    print(json.dumps({'manifest': path.name, 'sha256': digest(path)}))
