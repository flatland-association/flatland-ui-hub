"""Training provenance stays separate from the CPU-only inference exports."""
import hashlib
import json

import pytest
import torch

from app.policies.learned import uc2_bundle
from lab.marl.export_uc2_roam_specialists import export


@pytest.mark.parametrize('development_cases,retained', [
    (125, ('tutorial', 'uc2-3')), (209, ('tutorial', 'uc2-3')),
    (309, ('uc2-3',)), (309, ()),
])
def test_specialist_export_preserves_every_tensor_and_drops_private_training_state(tmp_path, development_cases, retained):
    payload = torch.load(uc2_bundle.CHECKPOINT, map_location='cpu', weights_only=True)
    payload['meta'].update(epochs_completed=100, samples=32, datasets=[{'sha256': 'a' * 64,
        'path': '/private/training/corpus.jsonl'}], source_sha256={'lab/train.py': 'b' * 64},
        hyperparameters={'lr': 0.0001}, teacher_sources=['native_strict_pp'],
        teacher_source_counts={'native_strict_pp': 32}, private_training_path='/private/do-not-export')
    payload['optimizer'] = {'private': '/Users/secret/optimizer'}
    payload['rng'] = {'private': '/private/secret/random-state'}
    source = tmp_path / 'source.pt'
    torch.save(payload, source)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    version = {125: 1, 209: 2, 309: 3}[development_cases]
    selection = {'schema': f'uc2-immutable-map-expert-selection-v{version}',
        'summary': {'cases': development_cases, 'complete_missions': development_cases, 'worse_cases': 0}, 'maps': {
            k: {'checkpoint': source.name, 'checkpoint_sha256': (
                uc2_bundle.CHECKPOINT_SHA256 if k in retained else source_hash)}
            for k in uc2_bundle.SCENARIOS}}
    selection_file = tmp_path / 'selection.json'
    selection_file.write_text(json.dumps(selection))
    output = tmp_path / 'exports'
    manifest_file = export(selection_file, tmp_path, output)
    manifest = json.loads(manifest_file.read_text())
    assert manifest['selector'] == 'immutable_native_fixture_identity_only'
    assert manifest['development_cases'] == development_cases
    assert manifest['guard']['planner_fallback'] is False
    for scenario in retained:
        assert manifest['models'][scenario]['sha256'] == uc2_bundle.CHECKPOINT_SHA256
    for scenario in set(uc2_bundle.SCENARIOS) - set(retained):
        entry = manifest['models'][scenario]
        path = output / entry['file']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == entry['sha256']
        result = torch.load(path, map_location='cpu', weights_only=True)
        assert set(result) == {'model', 'meta'}
        assert set(result['model']) == set(payload['model'])
        assert all(torch.equal(result['model'][key], value) and result['model'][key].device.type == 'cpu'
                   for key, value in payload['model'].items())
        assert '/private/' not in json.dumps(result['meta'])
        assert '/Users/' not in json.dumps(result['meta'])
        assert result['meta']['infrastructure'] == scenario
    with pytest.raises(FileExistsError):
        export(selection_file, tmp_path, output)


def test_export_rejects_an_unsuccessful_selection_before_creating_assets(tmp_path):
    source = tmp_path / 'selection.json'
    source.write_text(json.dumps({'schema': 'uc2-immutable-map-expert-selection-v1',
        'summary': {'cases': 125, 'complete_missions': 124, 'worse_cases': 1},
        'maps': {k: {} for k in uc2_bundle.SCENARIOS}}))
    output = tmp_path / 'exports'
    with pytest.raises(ValueError, match='successful known-case'):
        export(source, tmp_path, output)
    assert not output.exists()
