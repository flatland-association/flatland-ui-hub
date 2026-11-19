"""Production UC2 ROAM parity, worker isolation and environment lifetime."""
import asyncio
import copy
import gc
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from threading import get_ident
from types import SimpleNamespace
import weakref

import numpy as np
import pytest
from flatland.core.env_observation_builder import DummyObservationBuilder

from app.core.env_factory import create_env
from app.core.native_env_cache import clear_native_environment_caches
from app.core.scenario_runner import TrajectoryBranchRunner
from app.policies import registry
from app.policies.learned import uc2_bundle
from app.policies.learned.learned_ppo_policy import LearnedPpoPolicy
from app.policies.learned.roam_check import open_waypoint_groups, stuck_trains
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
from lab.marl.evaluate_uc2_roam import run_case
from lab.marl.pf_ch_episode import PFChCase, PFChEpisode


@pytest.mark.integration
@pytest.mark.parametrize("preset, lateness", [("tutorial", 9), ("uc2-1", 19), ("uc2-2", 24), ("uc2-3", 20), ("uc2-4", 30)])
def test_explicit_baseline_runtime_exactly_replays_evaluated_v3_actions_with_native_faults(preset, lateness, tmp_path, monkeypatch):
    def forbidden(*_args, **_kwargs):
        raise AssertionError("The frozen autonomous UC2 driver must not invoke another planner")

    monkeypatch.setattr(registry.PlanPolicy, "reset", forbidden)
    monkeypatch.setattr(registry.DeadLockAvoidancePolicy, "reset", forbidden)
    checkpoint_before = hashlib.sha256(uc2_bundle.CHECKPOINT.read_bytes()).hexdigest()
    case = PFChCase(preset, case_id=f"runtime-parity-{preset}")
    reference = run_case(case, "v3", uc2_bundle.CHECKPOINT, trace_dir=tmp_path)
    assert "technical_error" not in reference, reference.get("technical_error")
    expected = [json.loads(line) for line in (tmp_path / f"v3-{case.case_id}.jsonl").read_text().splitlines()]
    episode = PFChEpisode(case, observation_schema=uc2_bundle.OBSERVATION_SCHEMA)
    try:
        policy = UC2RoamPolicy(episode.env, checkpoint=uc2_bundle.CHECKPOINT, specialists=False)
        assert isinstance(policy, UC2RoamPolicy)
        assert isinstance(episode.env.obs_builder, DummyObservationBuilder)
        assert policy.model.observation_schema == uc2_bundle.OBSERVATION_SCHEMA
        assert UC2RoamPolicy.infer_prepared is LearnedPpoPolicy.infer_prepared
        index = 0
        while not episode.done:
            actions = policy.act_many(episode.handles)
            assert actions == {int(h): action for h, action in expected[index]["executed_actions"].items()}
            episode.step(actions)
            for actual, recorded in zip(episode.env.agents, expected[index]["trains"]):
                assert actual.state.name == recorded["state"]
                configuration = (None if actual.current_configuration is None else
                                 [list(actual.current_configuration[0]), actual.current_configuration[1]])
                assert configuration == recorded["configuration"]
            groups = open_waypoint_groups(policy.obs_builder.base)
            trains, cached = policy.roam_check.snapshot(groups)
            assert cached == stuck_trains(policy.roam_check.tables, trains, partial_moves=True) == set()
            index += 1
        measured = episode.metrics()
        assert index == reference["steps"] == measured["steps"]
        assert measured["horizon"] == reference["horizon"]
        assert measured["complete_mission"] and measured["arrived"] == measured["total"]
        assert measured["lateness"] == reference["lateness"] == lateness
        assert measured["observed_malfunction_counter_increases"]
    finally:
        episode.close()
    assert hashlib.sha256(uc2_bundle.CHECKPOINT.read_bytes()).hexdigest() == checkpoint_before == uc2_bundle.CHECKPOINT_SHA256


@pytest.mark.integration
def test_async_worker_only_reads_owned_batch_and_finalization_stays_on_session_thread(monkeypatch):
    from app.core import pf_ch_control

    async def exercise():
        async def silent_broadcast(*_args):
            pass

        monkeypatch.setattr(pf_ch_control.ws_manager, "broadcast", silent_broadcast)
        env = create_env(scenario_preset_id="uc2-3")
        policy = registry.create_runtime_policy("uc2_rl", env)
        main_thread = get_ident()
        prepared = policy.prepare_inference(env.get_agent_handles())
        captured = prepared[1].copy()
        builder, check = policy.obs_builder, policy.roam_check
        calls = []
        withdraw = check.withdraw

        def checked_withdraw(*args):
            calls.append(get_ident())
            return withdraw(*args)

        monkeypatch.setattr(check, "withdraw", checked_withdraw)
        session = SimpleNamespace(id="uc2-pure-worker")
        policy.obs_builder = None
        policy.roam_check = None

        def pure_worker():
            assert get_ident() != main_thread
            return policy.infer_prepared(prepared)

        try:
            proposals = await pf_ch_control.run_inference(session, pure_worker)
        finally:
            policy.obs_builder, policy.roam_check = builder, check
        assert env._elapsed_steps == 0
        np.testing.assert_array_equal(prepared[1], captured)
        assert calls == []
        finalized = policy.finalize_actions(proposals)
        assert calls == [main_thread]
        assert finalized == policy.act_many(env.get_agent_handles())
        assert not session._pf_ch_busy
        clear_native_environment_caches()

    asyncio.run(exercise())


@pytest.mark.integration
def test_finalization_rejects_stale_or_incomplete_batches_and_reset_drops_previous_guard():
    env = create_env(scenario_preset_id="uc2-1")
    policy = registry.create_runtime_policy("uc2_rl", env)
    prepared = policy.prepare_inference(env.get_agent_handles())
    proposals = policy.infer_prepared(prepared)
    env.step({h: 0 for h in env.get_agent_handles()})
    with pytest.raises(RuntimeError, match="stale"):
        policy.finalize_actions(proposals)
    policy.prepare_inference(env.get_agent_handles())
    with pytest.raises(ValueError, match="complete joint"):
        policy.prepare_inference([0])
    with pytest.raises(RuntimeError, match="stale"):
        policy.finalize_actions(proposals)
    old_env, old_guard, old_builder = weakref.ref(env), weakref.ref(policy.roam_check), weakref.ref(policy.obs_builder)
    new_env = create_env(scenario_preset_id="tutorial")
    policy.reset(new_env)
    assert policy.roam_check.env is new_env and isinstance(new_env.obs_builder, DummyObservationBuilder)
    assert policy.act_many([]) == {}
    assert set(policy.act_many(new_env.get_agent_handles())) == {0, 1}
    del env, prepared
    clear_native_environment_caches()
    gc.collect()
    assert old_env() is old_guard() is old_builder() is None


@pytest.mark.integration
def test_native_and_deep_branches_share_only_frozen_model_and_topology():
    env = create_env(scenario_preset_id="uc2-3")
    live = registry.create_runtime_policy("uc2_rl", env)
    for _ in range(8):
        env.step(live.act_many(env.get_agent_handles()))
    expected = live.act_many(env.get_agent_handles())
    factory = registry.get_policy_spec("uc2_rl").branch_factory
    for fork in (copy.deepcopy(env), TrajectoryBranchRunner(env, factory)._fork_env()):
        branch = factory()
        branch.reset(fork)
        assert isinstance(branch, UC2RoamPolicy) and branch.model is live.model
        assert branch.roam_check is not live.roam_check and branch.roam_check.env is fork
        assert branch.roam_check.tables is live.roam_check.tables
        assert branch.obs_builder is not live.obs_builder
        assert fork.obs_builder is not env.obs_builder and isinstance(fork.obs_builder, DummyObservationBuilder)
        assert branch.act_many(fork.get_agent_handles()) == expected
    clear_native_environment_caches()


@pytest.mark.integration
def test_websocket_finalizes_before_human_override_and_keeps_all_physics_on_asgi(monkeypatch):
    from app.api import websockets
    from app.core.override_manager import override_manager
    from app.core.play_manager import play_manager
    from tests.test_pf_ch_playback_control import _session

    async def exercise():
        main_thread = get_ident()
        order = []

        def infer(*_args):
            assert get_ident() != main_thread
            order.append("infer")
            return {0: 2}

        session, state, _ = _session(monkeypatch, "uc2_rl", infer)
        actor = websockets.create_runtime_policy("uc2_rl", session.env)

        def finalize(proposals):
            assert get_ident() == main_thread and proposals == {0: 2}
            order.append("guard")
            return {0: 4}

        actor.finalize_actions = finalize
        override_manager.set(session.id, 0, 3)
        monkeypatch.setattr("app.policies.override_policy.classify_cell_at", lambda *_args: "SWITCH")

        def physics(*args, **_kwargs):
            assert get_ident() == main_thread
            assert {h: getattr(action, "value", action) for h, action in args[2].items()} == {0: 3}
            order.append("human-override-and-physics")
            session.env._elapsed_steps += 1
            state.running = False
            return {}, {}, {}, {}

        monkeypatch.setattr(websockets, "step_env", physics)
        try:
            await websockets._play_loop(session.id)
            assert order == ["infer", "guard", "human-override-and-physics"]
        finally:
            play_manager._states.pop(session.id, None)
            override_manager.clear_all(session.id)

    asyncio.run(exercise())


def test_production_policy_imports_and_constructs_without_the_lab_package():
    script = """
import importlib.abc, sys
class NoLab(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname == 'lab' or fullname.startswith('lab.'):
            raise ImportError('lab is absent from the production image')
sys.meta_path.insert(0, NoLab())
from app.core.env_factory import create_env
from app.policies.registry import create_runtime_policy
policy = create_runtime_policy('uc2_rl', create_env(scenario_preset_id='tutorial'))
assert type(policy).__name__ == 'UC2RoamPolicy'
assert set(policy.act_many([0, 1])) == {0, 1}
assert not any(name == 'lab' or name.startswith('lab.') for name in sys.modules)
"""
    subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).parents[1], check=True, timeout=10)
