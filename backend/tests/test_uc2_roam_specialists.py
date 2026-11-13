"""Immutable infrastructure selection, portable experts and fail-closed control."""
import asyncio
import copy
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys

import pytest
import torch
from fastapi.testclient import TestClient

from app.core.env_factory import create_env
from app.core.native_env_cache import clear_native_environment_caches
from app.core.session_manager import session_manager
from app.policies import registry
from app.policies.learned import learned_ppo_policy, uc2_bundle, uc2_roam_bundle
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy


def test_selector_is_only_the_five_immutable_fixture_ids_and_all_files_are_pinned():
    manifest = uc2_roam_bundle.verify_bundle()
    assert set(uc2_roam_bundle.MODEL_FILES) == set(uc2_bundle.SCENARIOS)
    assert manifest["selector"] == "immutable_native_fixture_identity_only"
    for scenario in uc2_bundle.SCENARIOS:
        path = uc2_roam_bundle.checkpoint_for_scenario(scenario)
        assert path.name == manifest["models"][scenario]["file"]
        assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest["models"][scenario]["sha256"]
        payload = torch.load(path, map_location="cpu", weights_only=True)
        assert set(payload) == {"model", "meta"}
        assert learned_ppo_policy.checkpoint_hidden_size(payload) == 128
        assert learned_ppo_policy.checkpoint_observation_size(payload) == 313
    assert uc2_roam_bundle.checkpoint_for_scenario("tutorial") == uc2_bundle.CHECKPOINT
    assert uc2_roam_bundle.checkpoint_for_scenario("uc2-3") == uc2_bundle.CHECKPOINT
    for unsupported in ("unknown", "uc2-5", "uc2-1-best-score", None):
        with pytest.raises(ValueError, match="no infrastructure specialist"):
            uc2_roam_bundle.checkpoint_for_scenario(unsupported)


@pytest.mark.integration
def test_each_reset_reselects_expert_and_shares_only_bounded_frozen_weights():
    policy = UC2RoamPolicy(specialists=True)
    try:
        for scenario in ("uc2-1", "uc2-2", "uc2-3", "uc2-4", "tutorial", "uc2-1"):
            env = create_env(scenario_preset_id=scenario)
            policy.reset(env)
            expected = uc2_roam_bundle.checkpoint_for_scenario(scenario)
            assert policy.checkpoint == expected
            assert policy.model is learned_ppo_policy.load_actor_critic(expected)
            assert not policy.model.training and all(not parameter.requires_grad for parameter in policy.model.parameters())
            assert policy.roam_check.env is env
            second = registry.create_runtime_policy("uc2_rl", env)
            assert second.checkpoint == expected and second.model is policy.model
            assert second.roam_check is not policy.roam_check
            # Clock, current incident and departure offset are runtime inputs,
            # not infrastructure/model selection criteria.
            env.agents[0].earliest_departure += 1
            env.agents[0].malfunction_handler._set_malfunction_down_counter(2)
            policy.reset(env)
            assert policy.checkpoint == expected
            assert len(learned_ppo_policy._MODELS) <= learned_ppo_policy.MAX_CACHED_MODELS == 4
    finally:
        clear_native_environment_caches()


@pytest.mark.integration
def test_specialist_branch_and_pure_worker_keep_the_selected_model():
    async def exercise():
        env = create_env(scenario_preset_id="uc2-2")
        live = registry.create_runtime_policy("uc2_rl", env)
        expected = live.act_many(env.get_agent_handles())
        fork = copy.deepcopy(env)
        branch = registry.get_policy_spec("uc2_rl").branch_factory()
        branch.reset(fork)
        assert branch.checkpoint == live.checkpoint == uc2_roam_bundle.checkpoint_for_scenario("uc2-2")
        assert branch.model is live.model and branch.roam_check.env is fork
        prepared = branch.prepare_inference(fork.get_agent_handles())
        builder, guard = branch.obs_builder, branch.roam_check
        branch.obs_builder = branch.roam_check = None
        try:
            proposals = await asyncio.to_thread(branch.infer_prepared, prepared)
        finally:
            branch.obs_builder, branch.roam_check = builder, guard
        assert branch.finalize_actions(proposals) == expected
        assert fork._elapsed_steps == env._elapsed_steps == 0
        clear_native_environment_caches()

    asyncio.run(exercise())


@pytest.mark.integration
def test_changed_specialist_fails_api_preflight_before_policy_builder_or_physics_mutates(tmp_path, monkeypatch):
    from app.main import app

    manifest = tmp_path / uc2_roam_bundle.MANIFEST.name
    shutil.copyfile(uc2_roam_bundle.MANIFEST, manifest)
    for filename in set(uc2_roam_bundle.MODEL_FILES.values()):
        shutil.copyfile(uc2_roam_bundle.MANIFEST.parent / filename, tmp_path / filename)
    broken = tmp_path / uc2_roam_bundle.MODEL_FILES["uc2-2"]
    broken.write_bytes(broken.read_bytes() + b"changed expert")
    monkeypatch.setattr(uc2_roam_bundle, "MANIFEST", manifest)
    with TestClient(app) as client:
        response = client.post("/session", json={"scenario_preset_id": "uc2-2"})
        assert response.status_code == 200, response.text
        sid = response.json()["id"]
        session = session_manager.get(sid)
        original = session.policy, session.env.obs_builder, session.env._elapsed_steps
        try:
            for endpoint, payload in (("policy", {"policy": "uc2_rl"}),
                                      ("step", {"policy": "uc2_rl", "n_steps": 1}),
                                      ("play", {"policy": "uc2_rl", "speed": 10})):
                result = client.post(f"/session/{sid}/{endpoint}", json=payload)
                assert result.status_code == 400, result.text
                assert "specialist model changed" in result.text
                assert (session.policy, session.env.obs_builder, session.env._elapsed_steps) == original
        finally:
            client.delete(f"/session/{sid}")


def test_specialist_catalog_and_manifest_do_not_eagerly_import_torch_or_lab():
    script = """
import sys
from app.policies import registry
from app.policies.learned import uc2_roam_bundle
assert uc2_roam_bundle.verify_bundle()['selector'] == 'immutable_native_fixture_identity_only'
assert registry.get_policy_spec('uc2_rl').show_in_ui
assert 'torch' not in sys.modules and 'lab' not in sys.modules
"""
    subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).parents[1], check=True, timeout=10)
