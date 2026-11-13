"""The separately scoped UC2 actor drives the locked native fixtures."""
import copy
import gc
import hashlib
import importlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import weakref

import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient
from flatland.core.env_observation_builder import DummyObservationBuilder
from flatland.envs.step_utils.states import TrainState

from app.core.env_factory import create_env
from app.core.native_env_cache import clear_native_environment_caches
from app.core.scenario_runner import TrajectoryBranchRunner
from app.core.session_manager import SessionManager, session_manager
from app.policies import registry
from app.policies.learned import uc2_bundle
from lab.marl.pf_ch_episode import PFChCase, PFChEpisode


def test_uc2_catalog_and_bundle_import_without_torch_or_lab():
    script = (
        "import sys; from app.policies import registry; from app.policies.learned import uc2_bundle; "
        "assert 'torch' not in sys.modules; assert 'lab' not in sys.modules; "
        "assert uc2_bundle.verify_bundle()['obs_size'] == 313"
    )
    subprocess.run([sys.executable, '-c', script], cwd=Path(__file__).parents[1], check=True, timeout=10)


def test_uc2_export_contains_only_reviewed_portable_inference_tensors():
    meta = uc2_bundle.verify_bundle()
    payload = torch.load(uc2_bundle.CHECKPOINT, map_location='cpu', weights_only=True)
    assert set(payload) == {'model', 'meta'}
    assert payload['meta']['source_checkpoint_sha256'] == uc2_bundle.SOURCE_CHECKPOINT_SHA256
    assert payload['meta']['observation_schema'] == 'uc2-context-v1'
    assert payload['meta']['validation']['complete_missions'] == 5
    assert payload['meta']['validation']['arrived'] == payload['meta']['validation']['trains'] == 14
    assert payload['meta']['validation']['development']['complete_missions'] == 20
    assert '/Users/' not in json.dumps(payload['meta']) and '/private/' not in json.dumps(payload['meta'])
    assert 'lab/runs' not in json.dumps(payload['meta'])
    tensor_hash = hashlib.sha256()
    for name, tensor in sorted(payload['model'].items()):
        tensor_hash.update(name.encode())
        tensor_hash.update(str(tensor.dtype).encode())
        tensor_hash.update(str(tuple(tensor.shape)).encode())
        tensor_hash.update(tensor.contiguous().numpy().tobytes())
    assert tensor_hash.hexdigest() == meta['model_tensor_sha256']
    assert sum(tensor.numel() for tensor in payload['model'].values()) == meta['parameter_count']


def test_uc2_bundle_rejects_changed_model_manifest_and_native_fixture(tmp_path, monkeypatch):
    checkpoint = tmp_path / 'model.pt'
    shutil.copyfile(uc2_bundle.CHECKPOINT, checkpoint)
    shutil.copyfile(uc2_bundle.CHECKPOINT.with_suffix('.json'), checkpoint.with_suffix('.json'))
    monkeypatch.setattr(uc2_bundle, 'CHECKPOINT', checkpoint)
    assert uc2_bundle.verify_bundle()['obs_size'] == 313
    sidecar = checkpoint.with_suffix('.json')
    original = sidecar.read_bytes()
    sidecar.write_bytes(original + b' ')
    with pytest.raises(ValueError, match='identity/schema'):
        uc2_bundle.verify_bundle()
    sidecar.write_bytes(original)
    checkpoint.write_bytes(checkpoint.read_bytes() + b'wrong')
    with pytest.raises(ValueError, match='identity/schema'):
        uc2_bundle.verify_bundle()
    shutil.copyfile(Path(__file__).parents[1] / 'app/policies/learned/checkpoints/uc2_demo_ppo.pt', checkpoint)
    fixture_dir = tmp_path / 'fixtures'
    for scenario in uc2_bundle.SCENARIOS:
        folder = fixture_dir / scenario
        folder.mkdir(parents=True)
        shutil.copyfile(uc2_bundle._FIXTURES / scenario / 'scenario.pkl', folder / 'scenario.pkl')
    monkeypatch.setattr(uc2_bundle, '_FIXTURES', fixture_dir)
    (fixture_dir / 'tutorial/scenario.pkl').write_bytes(b'changed native scenario')
    with pytest.raises(ValueError, match='native fixture changed'):
        uc2_bundle.verify_bundle()


def test_uc2_is_separate_from_existing_pf_ch_and_dla_defaults(monkeypatch, tmp_path):
    monkeypatch.setenv('MARL_LAB_CHECKPOINTS_DIR', str(tmp_path / 'empty'))
    spec = registry.get_policy_spec('uc2_rl')
    assert spec.label == 'UC2 RL (trained demos)' and spec.family == 'learned'
    assert spec.show_in_ui and not spec.is_default and not spec.supports_scenarios
    assert registry.get_policy_spec('deadlock_avoidance').is_default
    assert registry.get_policy_spec('pf_ch_rl').label == 'PF-CH RL (trained demos)'
    assert 'uc2_rl' not in registry.scenario_policy_factories()


def test_uc2_catalog_hides_actor_when_torch_is_missing(monkeypatch):
    original = importlib.util.find_spec
    try:
        with monkeypatch.context() as patch:
            patch.setattr(importlib.util, 'find_spec', lambda name, *args: None if name == 'torch' else original(name, *args))
            importlib.reload(registry)
            assert not registry.get_policy_spec('uc2_rl').show_in_ui
    finally:
        importlib.reload(registry)


@pytest.mark.integration
@pytest.mark.parametrize('scenario', uc2_bundle.SCENARIOS)
def test_uc2_runtime_completes_native_mission_without_other_planners(scenario, monkeypatch):
    def planner_forbidden(*_args, **_kwargs):
        raise AssertionError('The learned driver cannot invoke PP or DLA')

    monkeypatch.setattr(registry.PlanPolicy, 'reset', planner_forbidden)
    monkeypatch.setattr(registry.DeadLockAvoidancePolicy, 'reset', planner_forbidden)
    episode = PFChEpisode(PFChCase(preset=scenario, case_id=f'bundle-{scenario}'))
    try:
        policy = registry.create_runtime_policy('uc2_rl', episode.env)
        assert isinstance(episode.env.obs_builder, DummyObservationBuilder)
        assert policy.model.observation_schema == 'uc2-context-v1'
        while not episode.done:
            actions = policy.act_many(episode.handles)
            assert all(policy.last_observations[h].shape == (318,) and
                       policy.last_observations[h][-5 + action] == 1 for h, action in actions.items())
            episode.step(actions)
        metrics = episode.metrics()
        assert metrics['complete_mission']
        assert metrics['arrived'] == (2 if scenario == 'tutorial' else 3)
        assert metrics['observed_malfunction_counter_increases']
        assert metrics['native_on_map_positive_counter_steps'] > 0
    finally:
        episode.close()


@pytest.mark.integration
def test_uc2_wrong_rail_is_rejected_before_replacing_the_native_builder():
    env = create_env(scenario_preset_id='uc2-1')
    original = env.obs_builder
    row, col = np.argwhere(env.rail.grid != 0)[0]
    env.rail.grid[row, col] ^= 1
    with pytest.raises(ValueError, match='UC2 RL requires'):
        registry.create_runtime_policy('uc2_rl', env)
    assert env.obs_builder is original and env._elapsed_steps == 0
    clear_native_environment_caches()


@pytest.mark.integration
def test_uc2_native_and_deep_forks_share_weights_and_keep_private_compact_builders():
    env = create_env(scenario_preset_id='uc2-3')
    live = registry.create_runtime_policy('uc2_rl', env)
    for _ in range(5):
        env.step(live.act_many(env.get_agent_handles()))
    expected = live.act_many(env.get_agent_handles())
    factory = registry.get_policy_spec('uc2_rl').branch_factory
    for fork in (copy.deepcopy(env), TrajectoryBranchRunner(env, factory)._fork_env()):
        branch = factory()
        branch.reset(fork)
        assert branch.model is live.model
        assert branch.obs_builder is not live.obs_builder
        assert isinstance(fork.obs_builder, DummyObservationBuilder)
        assert fork.obs_builder is not env.obs_builder and fork.obs_builder.env is fork
        assert fork._max_episode_steps == env._max_episode_steps == 240
        assert branch.act_many(fork.get_agent_handles()) == expected
    clear_native_environment_caches()


@pytest.mark.integration
def test_uc2_switching_back_and_repeated_session_deletion_release_environments():
    from app.policies.learned import learned_ppo_policy as runtime

    manager = SessionManager()
    refs = []
    for _ in range(6):
        session = manager.create(scenario_preset_id='tutorial')
        refs.append(weakref.ref(session.env))
        actor = registry.create_runtime_policy('uc2_rl', session.env)
        compact = session.env.obs_builder
        actions = actor.act_many(session.env.get_agent_handles())
        observations, *_ = session.env.step(actions)
        assert all(value is True for value in observations.values())
        dla = registry.create_runtime_policy('deadlock_avoidance', session.env)
        dla.start_step()
        assert set(dla.act_many(session.env.get_agent_handles(), observations)) == set(actions)
        assert session.env.obs_builder is compact
        assert manager.delete(session.id)
        del session, actor, compact, dla
    gc.collect()
    assert all(reference() is None for reference in refs)
    assert len(runtime._MODELS) <= runtime.MAX_CACHED_MODELS


@pytest.mark.integration
def test_uc2_wrong_map_api_requests_fail_before_policy_or_physics_changes():
    from app.main import app

    with TestClient(app) as client:
        response = client.post('/session', json={'scenario_preset_id': 'pf-ch-wn-wal-conflict'})
        assert response.status_code == 200
        sid = response.json()['id']
        session = session_manager.get(sid)
        original_policy, original_builder = session.policy, session.env.obs_builder
        try:
            for endpoint, body in [('policy', {'policy': 'uc2_rl'}),
                                   ('step', {'policy': 'uc2_rl', 'n_steps': 1}),
                                   ('play', {'policy': 'uc2_rl', 'speed': 10})]:
                rejected = client.post(f'/session/{sid}/{endpoint}', json=body)
                assert rejected.status_code == 400, rejected.text
                assert 'UC2 RL requires' in rejected.json()['detail']
                assert session.policy == original_policy and session.env._elapsed_steps == 0
                assert session.env.obs_builder is original_builder
        finally:
            client.delete(f'/session/{sid}')


@pytest.mark.integration
@pytest.mark.parametrize('scenario', uc2_bundle.SCENARIOS)
def test_uc2_api_websocket_and_reset_replay_the_same_native_mission(scenario):
    from app.main import app

    with TestClient(app) as client:
        response = client.post('/session', json={'scenario_preset_id': scenario})
        assert response.status_code == 200, response.text
        sid = response.json()['id']
        session = session_manager.get(sid)
        horizon = session.env._max_episode_steps
        assert session.policy == 'deadlock_avoidance'
        try:
            chosen = client.post(f'/session/{sid}/policy', json={'policy': 'uc2_rl'})
            assert chosen.status_code == 200, chosen.text
            assert session.policy == 'uc2_rl'
            with client.websocket_connect(f'/ws/session/{sid}') as socket:
                assert socket.receive_json()['state']['elapsed_steps'] == 0
                assert client.post(f'/session/{sid}/step', json={'policy': 'uc2_rl', 'n_steps': 1}).status_code == 200
                assert socket.receive_json()['state']['elapsed_steps'] == 1
            finishes = []
            for repetition in range(2):
                for _ in range(1 + horizon // 100):
                    completed = client.post(f'/session/{sid}/step', json={'policy': 'uc2_rl', 'n_steps': min(horizon, 100)})
                    assert completed.status_code == 200, completed.text
                    if completed.json()['episode_done']:
                        break
                assert completed.json()['episode_done']
                assert sum(agent.state == TrainState.DONE for agent in session.env.agents) == len(session.env.agents)
                finishes.append(session.env._elapsed_steps)
                assert session.env._max_episode_steps == horizon
                if repetition == 0:
                    reset = client.post(f'/session/{sid}/reset')
                    assert reset.status_code == 200, reset.text
                    assert session.env._elapsed_steps == 0 and session.policy == 'uc2_rl'
            assert finishes[0] == finishes[1]
        finally:
            client.delete(f'/session/{sid}')
