"""One model per infrastructure: the UC2 track model never reads the scenario identity."""
import numpy as np
import pytest
import torch

from app.core.env_factory import create_env
from app.policies import registry
from app.policies.learned import learned_ppo_policy, uc2_roam_bundle
from app.policies.learned.uc2_observation import SCENARIO_IDS, SCENARIO_OFFSET
from lab.marl import uc2_user_commands as U
from lab.marl.pf_ch_episode import PFChCase


def test_one_model_file_per_infrastructure():
    manifest = uc2_roam_bundle.verify_bundle()
    assert manifest["infrastructures"] == {
        "tutorial": {"file": "uc2_roam_tutorial.pt", "scenarios": ["tutorial"]},
        "uc2-track": {"file": "uc2_roam_uc2_track.pt", "scenarios": ["uc2-1", "uc2-2", "uc2-3", "uc2-4"]},
    }
    assert set(uc2_roam_bundle.MODEL_FILES.values()) == {"uc2_roam_tutorial.pt", "uc2_roam_uc2_track.pt"}
    assert uc2_roam_bundle.infrastructure_for_scenario("uc2-3") == "uc2-track"
    with pytest.raises(ValueError, match="no infrastructure specialist"):
        uc2_roam_bundle.infrastructure_for_scenario("uc2-5")


def test_track_model_declares_the_scenario_one_hot_blind():
    model = learned_ppo_policy.load_actor_critic(uc2_roam_bundle.checkpoint_for_scenario("uc2-1"))
    assert model.blind_inputs == ((SCENARIO_OFFSET, SCENARIO_OFFSET + len(SCENARIO_IDS)),)
    assert learned_ppo_policy.load_actor_critic(uc2_roam_bundle.checkpoint_for_scenario("tutorial")).blind_inputs == ()


def test_blind_inputs_outside_the_observation_are_rejected():
    path = uc2_roam_bundle.checkpoint_for_scenario("uc2-1")
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    checkpoint["meta"]["blind_inputs"] = [[300, 400]]
    model = learned_ppo_policy.ActorCritic(obs_size=313, hidden_size=checkpoint["meta"]["hidden_size"])
    with pytest.raises(ValueError, match="blind_inputs"):
        learned_ppo_policy.load_actor_critic_checkpoint(model, checkpoint)


@pytest.mark.integration
def test_actions_and_values_do_not_depend_on_the_scenario_one_hot():
    env = create_env(scenario_preset_id="uc2-2")
    policy = registry.create_runtime_policy("uc2_rl", env)
    handles = list(env.get_agent_handles())
    prepared = policy.prepare_inference(handles)
    selected, obs, width = prepared
    reference = policy.infer_prepared(prepared)
    reference_probs = dict(policy.last_action_probs)
    for scenario in range(len(SCENARIO_IDS)):
        forged = obs.copy()
        forged[:, SCENARIO_OFFSET:SCENARIO_OFFSET + len(SCENARIO_IDS)] = 0
        forged[:, SCENARIO_OFFSET + scenario] = 1
        assert policy.infer_prepared((selected, forged, width)) == reference
        for h in selected:
            assert np.allclose(policy.last_action_probs[h], reference_probs[h])
    value = policy.value_estimate(env, handles[0])
    assert np.isfinite(value)


@pytest.mark.integration
@pytest.mark.parametrize("preset, lateness", [("uc2-1", 19), ("uc2-2", 24), ("uc2-3", 20), ("uc2-4", 30), ("tutorial", 9)])
def test_study_scenarios_keep_their_lateness(preset, lateness):
    result, _ = U.run_episode(PFChCase(preset), U.runtime_driver)
    assert result["complete_mission"] and result["lateness"] == lateness


def test_pinned_teachers_are_the_ones_the_track_model_was_distilled_from():
    import hashlib
    track = torch.load(uc2_roam_bundle.checkpoint_for_scenario("uc2-1"), map_location="cpu", weights_only=True)
    for scenario in uc2_roam_bundle.INFRASTRUCTURES["uc2-track"]:
        path = uc2_roam_bundle.teacher_checkpoint(scenario)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == track["meta"]["teacher_sha256"][scenario]
        assert path.name not in uc2_roam_bundle.MODEL_FILES.values()  # never selected at runtime
    with pytest.raises(ValueError, match="no teacher"):
        uc2_roam_bundle.teacher_checkpoint("tutorial")
