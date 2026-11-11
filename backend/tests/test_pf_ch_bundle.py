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
        "import sys; from app.policies.learned import pf_ch_bundle; "
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
            assert "pf_ch_rl" not in registry.selectable_policy_ids({"pf_ch_rl"})
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
    monkeypatch.setattr(registry, "_mk_goal_directed", forbidden)
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


@pytest.mark.integration
def test_lab_loader_preserves_legacy_schema_and_rejects_context_finetuning(tmp_path, monkeypatch):
    from app.policies.learned.ecml_observation import LEGACY_OBSERVATION_SCHEMA
    from app.policies.learned.learned_ppo_policy import DEFAULT_CHECKPOINT
    from lab.marl.common import load_model, save_checkpoint
    from lab.marl.finetune_interventions import finetune_on_lines
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path))
    legacy = load_model(DEFAULT_CHECKPOINT)
    assert legacy.observation_schema == LEGACY_OBSERVATION_SCHEMA
    saved = save_checkpoint("legacy-roundtrip", legacy, {})
    assert load_model(saved).observation_schema == LEGACY_OBSERVATION_SCHEMA
    with pytest.raises(ValueError, match="only 36-feature"):
        finetune_on_lines([{}], name="unsupported", base_path=pf_ch_bundle.CHECKPOINT,
                          scenarios=["pf-ch-corridor-stops"], epochs=1, device="cpu")


@pytest.mark.integration
def test_lab_readonly_choices_and_explicit_training_rejection(tmp_path, monkeypatch):
    from app.main import app
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "checkpoints"))
    monkeypatch.setenv("MARL_LAB_RUNS_DIR", str(tmp_path / "runs"))
    monkeypatch.setenv("MARL_LAB_TRAINING", "1")
    with TestClient(app) as client:
        created = client.post("/session", json={"scenario_preset_id": "pf-ch-wn-wal-conflict"})
        assert created.status_code == 200
        sid = created.json()["id"]
        assert client.post(f"/session/{sid}/policy", json={"policy": "pf_ch_rl"}).status_code == 200
        choices = client.get(f"/session/{sid}/lab/ai-choices")
        assert choices.status_code == 200, choices.text
        assert choices.json() and any(choice["available"] for choice in choices.json().values())
        single = client.get(f"/session/{sid}/lab/ai-choice/0")
        assert single.status_code == 200
        assert client.get(f"/session/{sid}/lab/review?outcomes=false").status_code == 200
        status = client.get(f"/session/{sid}/lab/train").json()
        assert status["basePolicy"] == "pf_ch_rl"
        assert not status["available"] and status["reason"] == "unsupported-observation-schema"
        rejected = client.post(f"/session/{sid}/lab/train", json={"klWeight": 3})
        assert rejected.status_code == 400
        assert rejected.json()["detail"] == "unsupported-observation-schema"
        assert session_manager.get(sid).env._elapsed_steps == 0
        client.delete(f"/session/{sid}")


@pytest.mark.integration
def test_readonly_evaluation_on_an_unsupported_map_is_explicitly_unavailable():
    from app.core import lab_session
    env = create_env(width=30, height=30, number_of_agents=2, seed=7)
    session = SimpleNamespace(env=env, policy="deadlock_avoidance")
    choices = lab_session.ai_choices("incompatible-pf-ch", session, evaluation_policy_id="pf_ch_rl")
    assert choices and all(choice == {"available": False, "reason": "incompatible-scenario"}
                           for choice in choices.values())


def test_counterfactual_values_use_the_context_mask_tail(monkeypatch):
    from app.core import lab_session, scenario_runner
    from app.core.online_learning import reward as reward_module
    original = object()

    class Branch:
        _elapsed_steps = 1

        def step(self, actions):
            assert actions == {0: 2}
            return None, {}, {0: False, "__all__": False}, {}

    class Runner:
        def __init__(self, env, policy):
            pass

        def _fork_env(self):
            return Branch()

    class Reward:
        def __init__(self, env):
            pass

        def step(self, step):
            return {0: 1.0}

    class Policy:
        def value_estimate(self, env, handle):
            return 2.0

    monkeypatch.setattr(scenario_runner, "TrajectoryBranchRunner", Runner)
    monkeypatch.setattr(reward_module, "ShapedReward", Reward)
    observation = [0.0] * 277
    observation[36] = 1.0  # An identity feature, never a valid-action indicator.
    observation[272 + 2] = 1.0
    values = lab_session._counterfactual_action_values(original, Policy(), 0, {}, observation)["values"]
    assert values["2"] == pytest.approx(2.98)
    assert all(values[str(action)] is None for action in (0, 1, 3, 4))
