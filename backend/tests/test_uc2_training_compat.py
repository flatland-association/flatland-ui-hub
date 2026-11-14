"""UC2 schemas and inference exports preserve the public safe model loader."""
from collections import OrderedDict
import json

import numpy as np
import pytest
import torch

from app.policies.learned import learned_ppo_policy as runtime
from app.policies.learned.ecml_observation import OBSERVATION_SCHEMA
from lab.marl import train_bc, train_ppo
from lab.marl.collect_pp_demonstrations import SCHEMA, load_demonstrations
from lab.marl.common import ActorCritic, load_model, observation_size


@pytest.fixture(autouse=True)
def single_thread():
    torch.set_num_threads(1)


def _write(path, model):
    torch.save({'model': model.state_dict(), 'meta': {'observation_schema': model.observation_schema,
                                                    'obs_size': model.trunk[0].in_features}}, path)
    return path


def _dataset(path):
    row = {'schema': SCHEMA, 'observation_schema': 'uc2-context-v1', 'owner': 'pp_teacher',
           'source': 'native_strict_pp', 'case_id': 'uc2-train', 'split': 'train',
           'obs': [0.0] * 313, 'mask': [1, 0, 1, 0, 1], 'teacher_action': 2,
           'applied_action': 2, 'weight': 1.0, 'step': 1, 'handle': 0}
    path.write_text(json.dumps(row) + '\n')
    return path


@pytest.mark.parametrize('prefix', [36, 272])
@pytest.mark.parametrize('width', [128, 256, 384])
def test_uc2_zero_input_and_width_extension_preserve_all_network_outputs(tmp_path, prefix, width):
    torch.manual_seed(47)
    original = ActorCritic(obs_size=prefix)
    original.observation_schema = OBSERVATION_SCHEMA if prefix == 36 else 'pf-ch-context-v1'
    model = load_model(_write(tmp_path / 'base.pt', original), obs_size=313,
                       observation_schema='uc2-context-v1', hidden_size=width)
    assert observation_size('uc2-context-v1') == 313
    old = torch.randn(7, prefix)
    extended = torch.cat((old, torch.randn(7, 313 - prefix)), dim=1)
    with torch.no_grad():
        before, after = original.forward_with_experience(old), model.forward_with_experience(extended)
    assert all(torch.allclose(a, b, atol=1e-5, rtol=1e-5) for a, b in zip(before, after, strict=True))
    assert not torch.count_nonzero(model.trunk[0].weight[:128, prefix:])


def test_uc2_bc_final_and_snapshot_load_with_weights_only_and_frozen_runtime(tmp_path, monkeypatch):
    monkeypatch.setenv('MARL_LAB_CHECKPOINTS_DIR', str(tmp_path / 'checkpoints'))
    monkeypatch.setattr(runtime, '_MODELS', OrderedDict())
    dataset = _dataset(tmp_path / 'teacher.jsonl')
    assert load_demonstrations([dataset])[0]['observation_schema'] == 'uc2-context-v1'
    result = train_bc.train(['--dataset', str(dataset), '--name', 'uc2-bc', '--epochs', '1',
                             '--device', 'cpu', '--save-every', '1', '--snapshot-dir', str(tmp_path / 'snapshots')])
    helper = 'app/policies/learned/uc2_observation.py'
    assert helper in result['meta']['source_sha256']
    assert isinstance(result['meta']['software']['torch'], str)
    for path in (result['checkpoint'], tmp_path / 'snapshots/uc2-bc-epoch-00001.pt'):
        payload = torch.load(path, map_location='cpu', weights_only=True)
        assert payload['meta']['obs_size'] == 313
        model = runtime.load_actor_critic(path)
        assert model.observation_schema == 'uc2-context-v1'
        assert all(not parameter.requires_grad for parameter in model.parameters())
        assert runtime.load_actor_critic(path) is model


def test_uc2_ppo_inference_snapshot_excludes_numpy_rng_but_final_remains_resumable(tmp_path, monkeypatch):
    monkeypatch.setenv('MARL_LAB_CHECKPOINTS_DIR', str(tmp_path / 'checkpoints'))
    monkeypatch.setattr(runtime, '_MODELS', OrderedDict())
    manifest = tmp_path / 'cases.json'
    manifest.write_text(json.dumps({'split': 'train', 'cases': [{'preset': 'tutorial', 'case_id': 'uc2-train'}]}))
    captured = {}

    def fake_episode(actor, _case, *_args):
        captured['schema'] = actor.observation_schema
        features = np.zeros(313, dtype=np.float32)
        with torch.no_grad():
            logits, value = actor(torch.from_numpy(features[None]))
        batch = train_ppo.Batch(obs=[features], mask=[np.ones(5, dtype=np.float32)], action=[2],
                                logp=logits.log_softmax(-1)[:, 2].tolist(), value=value.tolist(),
                                advantage=[0.0], ret=value.tolist())
        return batch, train_ppo.EpisodeStats(trains=1, arrived=1, returns=[0.0], steps=1, missions=1)

    monkeypatch.setattr(train_ppo, 'run_pf_ch_episode', fake_episode)
    result = train_ppo.train(['--name', 'uc2-ppo', '--cases', str(manifest), '--observation-schema', 'uc2-context-v1',
                              '--iterations', '1', '--samples-per-iter', '1', '--epochs', '1', '--device', 'cpu',
                              '--snapshot-dir', str(tmp_path / 'snapshots')])
    assert captured == {'schema': 'uc2-context-v1'}
    final = torch.load(result['checkpoint'], map_location='cpu', weights_only=False)
    assert 'optimizer' in final and isinstance(final['training_state']['numpy_rng'][1], np.ndarray)
    snapshot = tmp_path / 'snapshots/uc2-ppo-iteration-00001.pt'
    exported = torch.load(snapshot, map_location='cpu', weights_only=True)
    assert set(exported) == {'model', 'meta'}
    assert exported['meta']['iterations'] == 1 and exported['meta']['obs_size'] == 313
    assert json.loads(snapshot.with_suffix('.json').read_text()) == exported['meta']
    assert runtime.load_actor_critic(snapshot).observation_schema == 'uc2-context-v1'
    assert not list((tmp_path / 'snapshots').glob('*.tmp'))
    assert all(torch.equal(value, exported['model'][key]) for key, value in final['model'].items())
