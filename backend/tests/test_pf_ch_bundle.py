"""The shipped actor is portable, scoped, and actually drives complete missions."""
import hashlib
import importlib
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

import numpy as np
import pytest
import torch
from fastapi.testclient import TestClient
from flatland.envs.step_utils.states import TrainState

from app.core.env_factory import create_env
from app.core.env_step import step_env
from app.core.scenario_presets import select_disturbances
from app.core.session_manager import SessionManager, session_manager
from app.core.stops import intermediate_stops, served_stops
from app.policies import registry
from app.policies.learned import pf_ch_bundle
from app.policies.learned.learned_ppo_policy import LearnedPpoPolicy


def test_bundle_helpers_import_without_torch_or_training():
    script = (
        "import sys; from app.policies import registry; from app.policies.learned import pf_ch_bundle; "
        "assert 'torch' not in sys.modules; assert 'lab' not in sys.modules; "
        "assert pf_ch_bundle.verify_bundle()['obs_size'] == 272"
    )
    subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).parents[1], check=True, timeout=10)


def test_export_contains_only_portable_inference_state_and_original_tensors():
    meta = pf_ch_bundle.verify_bundle()
    payload = torch.load(pf_ch_bundle.CHECKPOINT, map_location="cpu", weights_only=True)
    assert set(payload) == {"model", "meta"}
    assert payload["meta"]["source_checkpoint_sha256"] == pf_ch_bundle.SOURCE_CHECKPOINT_SHA256
    assert payload["meta"]["observation_schema"] == "pf-ch-context-v1"
    assert "/Users/" not in json.dumps(payload["meta"])
    assert "lab/runs" not in json.dumps(payload["meta"])
    digest = hashlib.sha256()
    for name, tensor in sorted(payload["model"].items()):
        digest.update(name.encode())
        digest.update(str(tensor.dtype).encode())
        digest.update(str(tuple(tensor.shape)).encode())
        digest.update(tensor.contiguous().numpy().tobytes())
    # This digest was computed from the original checkpoint before export.
    assert digest.hexdigest() == meta["model_tensor_sha256"] == (
        "ee64fea78b97bde9abac93c36e89acbd5ee0abeef5f94bef8211dc990f9508bb"
    )
    assert sum(t.numel() for t in payload["model"].values()) == meta["parameter_count"] == 70677
    assert len(payload["model"]) == meta["tensor_count"] == 16


def test_missing_or_corrupted_bundle_fails_clearly(tmp_path, monkeypatch):
    target = tmp_path / "model.pt"
    monkeypatch.setattr(pf_ch_bundle, "CHECKPOINT", target)
    assert not pf_ch_bundle.available()
    with pytest.raises(ValueError, match="unavailable"):
        pf_ch_bundle.verify_bundle()
    target.write_bytes(b"wrong model")
    target.with_suffix(".json").write_text('{}')
    with pytest.raises(ValueError, match="identity/schema"):
        pf_ch_bundle.verify_bundle()


def test_catalog_is_independent_of_lab_directory_and_not_a_global_default(monkeypatch, tmp_path):
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "empty"))
    spec = registry.get_policy_spec("pf_ch_rl")
    assert spec is not None and spec.show_in_ui and spec.family == "learned"
    assert spec.label == "PF-CH RL (trained demos)"
    assert not spec.is_default and not spec.supports_scenarios
    assert "pf_ch_rl" not in registry.scenario_policy_factories()
    assert pf_ch_bundle.CHECKPOINT.is_relative_to(Path(__file__).parents[1] / "app")


def test_catalog_hides_actor_where_torch_is_unavailable(monkeypatch):
    real = importlib.util.find_spec
    try:
        with monkeypatch.context() as patch:
            patch.setattr(importlib.util, "find_spec", lambda name, *args: None if name == "torch" else real(name, *args))
            importlib.reload(registry)
            assert not registry.get_policy_spec("pf_ch_rl").show_in_ui
            assert "pf_ch_rl" not in {spec.id for spec in registry.policy_specs() if spec.show_in_ui}
    finally:
        importlib.reload(registry)


@pytest.mark.parametrize("height,width,handles,scene", [
    (30, 30, [0], None), (9, 191, list(range(17)), None),
    (9, 191, [0, 0], None), (9, 191, [16], None), (9, 191, [], None),
    (9, 191, [0], {"id": "unsupported"}),
])
def test_incompatible_geometry_or_handles_are_rejected(height, width, handles, scene):
    env = SimpleNamespace(height=height, width=width, agents=[SimpleNamespace(handle=h) for h in handles],
                          _infrastructure_scene=scene)
    with pytest.raises(ValueError, match="PF-CH RL"):
        pf_ch_bundle.require_compatible(env)


@pytest.mark.integration
def test_runtime_uses_bundle_and_only_masked_actions(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("The RL driver must not invoke another planner")
    monkeypatch.setattr(registry.GoalDirectedPolicy, "reset", forbidden)
    monkeypatch.setattr(registry.PlanPolicy, "reset", forbidden)
    env = create_env(scenario_preset_id="pf-ch-wn-wal-conflict")
    policy = registry.create_runtime_policy("pf_ch_rl", env)
    assert isinstance(policy, LearnedPpoPolicy)
    assert policy.checkpoint == pf_ch_bundle.CHECKPOINT
    assert policy.model.observation_schema == "pf-ch-context-v1"
    actions = policy.act_many(env.get_agent_handles())
    for handle, action in actions.items():
        assert policy.last_observations[handle].shape == (277,)
        assert policy.last_observations[handle][-5 + action] == 1
        assert np.isfinite(policy.last_action_probs[handle]).all()
    assert not policy.model.experience_estimator_ready


@pytest.mark.integration
def test_invalid_policy_selection_is_rejected_before_state_change():
    from app.main import app
    with TestClient(app) as client:
        response = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 2, "seed": 7})
        assert response.status_code == 200
        sid = response.json()["id"]
        original = session_manager.get(sid).policy
        for endpoint, body in [("policy", {"policy": "pf_ch_rl"}),
                               ("step", {"policy": "pf_ch_rl", "n_steps": 1}),
                               ("play", {"policy": "pf_ch_rl", "speed": 5})]:
            rejected = client.post(f"/session/{sid}/{endpoint}", json=body)
            assert rejected.status_code == 400, rejected.text
            assert "PF-CH RL requires" in rejected.json()["detail"]
            assert session_manager.get(sid).policy == original
            assert session_manager.get(sid).env._elapsed_steps == 0
        client.delete(f"/session/{sid}")


@pytest.mark.integration
@pytest.mark.parametrize("faults,finish", [(False, 181), (True, 197)])
def test_bundled_actor_completes_the_sixteen_train_service_mission(faults, finish):
    preset = "pf-ch-corridor-stops"
    disturbances = select_disturbances(preset, ["corridor-shift-incidents"]) if faults else []
    session = SessionManager().create(scenario_preset_id=preset, max_episode_steps=320, disturbances=disturbances)
    session.policy = "pf_ch_rl"
    policy = registry.create_runtime_policy(session.policy, session.env)
    for _ in range(320):
        actions = policy.act_many(session.env.get_agent_handles())
        _, _, dones, _ = step_env(session.id, session, actions, policy=policy, policy_id=session.policy)
        if dones.get("__all__"):
            break
    assert session.env._elapsed_steps == finish
    assert sum(agent.state == TrainState.DONE for agent in session.env.agents) == 16
    assert sum(len(intermediate_stops(agent)) for agent in session.env.agents) == 48
    assert sum(len(served_stops(session.env, h)) for h in session.env.get_agent_handles()) == 48


def test_model_cache_shares_canonical_paths_and_discards_old_versions(tmp_path):
    import os
    import shutil
    from app.policies.learned import learned_ppo_policy as module

    path = tmp_path / "actor.pt"
    shutil.copyfile(pf_ch_bundle.CHECKPOINT, path)
    first = module.load_actor_critic(path)
    assert module.load_actor_critic(tmp_path / "." / "actor.pt") is first
    previous_time = path.stat().st_mtime_ns
    os.utime(path, ns=(previous_time + 1000000, previous_time + 1000000))
    replacement = module.load_actor_critic(path)
    assert replacement is not first
    assert sum(key[0] == path.resolve() for key in module._MODELS) == 1
    for index in range(module.MAX_CACHED_MODELS + 2):
        other = tmp_path / f"actor-{index}.pt"
        shutil.copyfile(path, other)
        module.load_actor_critic(other)
    assert len(module._MODELS) == module.MAX_CACHED_MODELS
    assert all(not parameter.requires_grad for parameter in replacement.parameters())


@pytest.mark.integration
def test_sessions_share_weights_but_keep_private_observations():
    first_env = create_env(scenario_preset_id="pf-ch-wn-wal-conflict")
    second_env = create_env(scenario_preset_id="pf-ch-wn-wal-conflict")
    first = registry.create_runtime_policy("pf_ch_rl", first_env)
    second = registry.create_runtime_policy("pf_ch_rl", second_env)
    assert first.model is second.model
    assert first.obs_builder is not second.obs_builder
    assert first.obs_builder.env is first_env
    assert second.obs_builder.env is second_env
    first.act_many(first_env.get_agent_handles())
    assert first.last_observations and not second.last_observations


@pytest.mark.integration
def test_reset_keeps_rl_horizon_and_replays_the_selected_scripted_faults():
    from app.main import app

    with TestClient(app) as client:
        created = client.post('/session', json={
            'scenario_preset_id': 'pf-ch-corridor-stops', 'max_episode_steps': 320,
            'disturbance_ids': ['corridor-shift-incidents'],
        })
        assert created.status_code == 200, created.text
        sid = created.json()['id']
        try:
            assert client.post(f'/session/{sid}/policy', json={'policy': 'pf_ch_rl'}).status_code == 200
            session = session_manager.get(sid)
            for iteration in range(2):
                response = client.post(f'/session/{sid}/step', json={'policy': 'pf_ch_rl', 'n_steps': 25})
                assert response.status_code == 200, response.text
                assert session.env._elapsed_steps == 25
                assert session.env.agents[4].malfunction_handler.malfunction_down_counter == 12
                assert session.env.agents[11].malfunction_handler.malfunction_down_counter == 10
                assert len(session.disturbance_scheduler._fired) == 2
                assert session.policy == 'pf_ch_rl'
                assert session.env._max_episode_steps == 320
                if iteration == 0:
                    response = client.post(f'/session/{sid}/reset')
                    assert response.status_code == 200, response.text
                    assert session.env._elapsed_steps == 0
                    assert not session.disturbance_scheduler._fired
        finally:
            client.delete(f'/session/{sid}')


@pytest.mark.integration
def test_pf_ch_owns_a_small_env_builder_after_other_envs_and_switching_back():
    from flatland.core.env_observation_builder import DummyObservationBuilder

    session = SessionManager().create(scenario_preset_id='pf-ch-wn-wal-conflict')
    original = session.env.obs_builder
    policy = registry.create_runtime_policy('pf_ch_rl', session.env)
    own = session.env.obs_builder
    assert isinstance(own, DummyObservationBuilder)
    assert own is not original and own.env is session.env
    # Another env can rebind Flatland's shared default, but cannot touch this
    # session's builder or the actor's independent context builder.
    other = create_env(scenario_preset_id='pf-ch-corridor-stops')
    assert other.obs_builder is not own
    actions = policy.act_many(session.env.get_agent_handles())
    observations, _, _, _ = step_env(session.id, session, actions)
    assert own.env is session.env
    assert all(value is True for value in observations.values())
    dla = registry.create_runtime_policy('deadlock_avoidance', session.env)
    dla.start_step()
    assert set(dla.act_many(session.env.get_agent_handles(), observations)) == set(actions)
    # The scenario's ordinary PP/scripted-plan comparison is still constructible.
    plan = registry.create_runtime_policy('plan', session.env)
    plan.start_step()
    assert set(plan.act_many(session.env.get_agent_handles(), observations)) == set(actions)
    assert session.env.obs_builder is own
