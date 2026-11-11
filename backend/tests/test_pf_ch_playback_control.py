"""PF-CH inference yields to controls without moving live physics to a worker."""
import asyncio
from threading import Event, get_ident
from types import SimpleNamespace

import pytest
import numpy as np

from app.api import websockets
from app.core import dispatcher_driver
from app.core.play_manager import PlayState, play_manager
from app.core.override_manager import override_manager

pytestmark = pytest.mark.integration


def _session(monkeypatch, policy_id, act_many):
    events = []
    env = SimpleNamespace(_elapsed_steps=0, _max_episode_steps=10,
                          agents=[SimpleNamespace(state=SimpleNamespace(name="MOVING"),
                                                  current_configuration=((0, 0), 1))],
                          get_agent_handles=lambda: [0])
    session = SimpleNamespace(id=f"inference-control-{policy_id}", env=env, dispatcher=None,
                              policy=policy_id, control_revision=0, last_observations={},
                              command_lock=asyncio.Lock())
    policy = SimpleNamespace(reset=lambda _: None, start_step=lambda: events.append("start"),
                             end_step=lambda: events.append("end"), act_many=act_many,
                             prepare_inference=lambda handles: tuple(handles),
                             infer_prepared=lambda handles: act_many(handles, {}))
    state = PlayState(session.id, 20, policy_id)
    state.running = True
    play_manager.register(state)

    async def broadcast(*_):
        pass

    monkeypatch.setattr(websockets.session_manager, "get", lambda _: session)
    monkeypatch.setattr(websockets, "create_runtime_policy", lambda *_: policy)
    monkeypatch.setattr(websockets, "dispatcher_before_step", lambda _: True)
    monkeypatch.setattr(websockets.ws_manager, "broadcast", broadcast)
    monkeypatch.setattr(websockets, "_build_state_payload", lambda *_: {"type": "state"})
    monkeypatch.setattr(websockets, "capture_marey_history_snapshot", lambda _: None)
    monkeypatch.setattr("app.core.trajectory_recorder.persist_trajectory", lambda _: None)
    return session, state, events


def test_pause_is_processed_during_pf_ch_inference_and_ack_waits_for_drain(monkeypatch):
    async def exercise():
        entered, release = Event(), Event()
        writes = []

        def infer(*_):
            entered.set()
            assert release.wait(3), "test did not release inference"
            return {0: 2}

        session, state, lifecycle = _session(monkeypatch, "pf_ch_rl", infer)
        applied = []
        override_manager.set(session.id, 0, 3)
        monkeypatch.setattr("app.policies.override_policy.classify_cell_at", lambda *_: "SWITCH")
        monkeypatch.setattr("app.policies.override_policy.intervention_log.record_applied",
                            lambda *_: applied.append("applied"))
        monkeypatch.setattr(websockets, "step_env", lambda *_args, **_kwargs: writes.append("physics"))
        task = asyncio.create_task(websockets._human_play_loop(session.id))
        state.task = task
        pause = None
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            assert state.running, "ASGI must remain available while inference is blocked"
            assert session.command_lock.locked()
            pause = asyncio.create_task(websockets.pause(session.id))
            await asyncio.sleep(0)
            assert not state.running, "Pause must reach the control handler during inference"
            assert not pause.done(), "Pause cannot acknowledge before its worker drains"
            assert session.command_lock.locked()
            assert dispatcher_driver.playback(session)["busy"]
            assert writes == []
            release.set()
            ack = await asyncio.wait_for(pause, 3)
            assert ack["playing"] is False
            assert not session.command_lock.locked()
            assert not dispatcher_driver.playback(session)["busy"]
            assert writes == [], "A cancelled inference proposal must never step the environment"
            assert override_manager.get(session.id, 0) == 3
            assert applied == [], "No intervention was applied without a physical step"
            assert lifecycle == ["start", "end"]
        finally:
            release.set()
            await asyncio.gather(task, *([pause] if pause else []), return_exceptions=True)
            play_manager._states.pop(session.id, None)
            override_manager.clear_all(session.id)

    asyncio.run(exercise())


def test_pf_ch_inference_does_not_start_after_pause_while_waiting_for_snapshot_lock(monkeypatch):
    async def exercise():
        calls = []
        session, state, lifecycle = _session(monkeypatch, "pf_ch_rl", lambda *_: calls.append("inference"))
        task = None
        try:
            async with session.command_lock:
                task = asyncio.create_task(websockets._human_play_loop(session.id))
                await asyncio.sleep(0)
                assert not task.done()
                dispatcher_driver.request_stop(session)
            await asyncio.wait_for(task, 3)
            assert calls == []
            assert lifecycle == []
            assert not state.running
        finally:
            if task and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize("policy_id", ["pf_ch_rl", "shortest_path"])
def test_physics_stays_on_asgi_thread_and_legacy_inference_keeps_its_execution(monkeypatch, policy_id):
    async def exercise():
        asgi_thread = get_ident()
        inference_threads, physics_threads, actions = [], [], []

        def infer(*_):
            inference_threads.append(get_ident())
            return {0: 2}

        session, state, lifecycle = _session(monkeypatch, policy_id, infer)

        def step(*_args, **kwargs):
            physics_threads.append(get_ident())
            actions.append(_args[2])
            session.env._elapsed_steps += 1
            state.running = False
            return {}, {}, {}, {}

        monkeypatch.setattr(websockets, "step_env", step)
        try:
            await websockets._human_play_loop(session.id)
            assert physics_threads == [asgi_thread]
            assert actions == [{0: 2}]
            assert (inference_threads == [asgi_thread]) == (policy_id != "pf_ch_rl")
            assert lifecycle == ["start", "end"]
        finally:
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


def test_pf_ch_worker_uses_the_replacement_wrappers_model(monkeypatch):
    async def exercise():
        used, committed = [], []
        session, state, _ = _session(monkeypatch, "shortest_path", lambda *_: {0: 2})
        original = websockets.create_runtime_policy("shortest_path", session.env)
        replacement = SimpleNamespace(
            reset=lambda _: None, start_step=lambda: None, end_step=lambda: None,
            prepare_inference=lambda handles: tuple(handles),
            infer_prepared=lambda _: used.append("replacement") or {0: 3})
        session.dispatcher = SimpleNamespace(run_status="running")
        session.policy = "pf_ch_rl"
        monkeypatch.setattr(websockets, "create_runtime_policy",
                            lambda policy_id, _: replacement if policy_id == "pf_ch_rl" else original)

        def step(*args, **_kwargs):
            committed.append(args[2])
            state.running = False
            return {}, {}, {}, {}

        monkeypatch.setattr(websockets, "step_env", step)
        try:
            await websockets._human_play_loop(session.id)
            assert used == ["replacement"]
            assert committed == [{0: 3}]
        finally:
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize("policy_id", ["pf_ch_rl", "learned_ppo"])
def test_prepared_inference_owns_its_inputs_and_preserves_actor_outputs(monkeypatch, policy_id):
    import torch

    from app.core.env_factory import create_env
    from app.policies.registry import create_runtime_policy

    env = create_env(scenario_preset_id="pf-ch-wn-wal-conflict")
    policy = create_runtime_policy(policy_id, env)
    handles = env.get_agent_handles()
    expected = policy.act_many(handles)
    expected_probabilities = dict(policy.last_action_probs)
    source = policy.obs_builder.get_many(handles)
    monkeypatch.setattr(policy.obs_builder, "get_many", lambda _: source)
    prepared = policy.prepare_inference(handles)
    captured = prepared[1].copy()
    # Independent actor/mask oracle, separate from both runtime entry points.
    width = prepared[2]
    with torch.no_grad():
        logits, _ = policy.model(torch.from_numpy(captured[:, :width]))
        mask = torch.from_numpy(captured[:, width:width + 5])
        reference = logits.masked_fill(mask < 0.5, float("-inf")).argmax(dim=-1).tolist()
    assert expected == dict(zip(handles, reference))
    for observation in source.values():
        observation[:] = 123
    # A worker must use the captured batch even if the live builder is gone.
    policy.obs_builder = None
    assert policy.infer_prepared(prepared) == expected
    assert policy.last_action_probs == expected_probabilities
    np.testing.assert_array_equal(prepared[1], captured)
    for index, handle in enumerate(handles):
        np.testing.assert_array_equal(policy.last_observations[handle], captured[index])


@pytest.mark.parametrize(("old", "target"), [("goal_directed", "pf_ch_rl"), ("pf_ch_rl", "goal_directed")])
def test_play_switch_drains_actual_pf_ch_related_actor_before_starting_replacement(monkeypatch, old, target):
    async def exercise():
        session, previous, _ = _session(monkeypatch, old, lambda *_: {})
        # Reproduce the prior bug: the label already changed, the actor did not.
        session.policy = target
        entered = asyncio.Event()
        order, invalidated = [], []

        async def old_loop():
            entered.set()
            try:
                await asyncio.Event().wait()
            finally:
                order.append("old-drained")

        async def new_loop(session_id):
            order.append(play_manager.get(session_id).policy)
            await asyncio.Event().wait()

        previous.task = asyncio.create_task(old_loop())
        await entered.wait()
        monkeypatch.setattr(websockets, "ensure_policy_enabled", lambda *_: True)
        monkeypatch.setattr(websockets.pf_ch_bundle, "compatibility_error", lambda _: None)
        monkeypatch.setattr(websockets, "_play_loop", new_loop)
        monkeypatch.setattr("app.api.sessions._invalidate_scenario_forecasts", invalidated.append)
        try:
            response = await websockets.play(session.id, websockets.PlayRequest(policy=target, speed=7))
            await asyncio.sleep(0)
            replacement = play_manager.get(session.id)
            assert previous.task.done()
            assert replacement is not previous
            assert replacement.policy == session.policy == response["policy"] == target
            assert order == ["old-drained", target]
            assert invalidated == [session.id]
        finally:
            await play_manager.stop(session.id)

    asyncio.run(exercise())


@pytest.mark.parametrize(("old", "target"), [("pf_ch_rl", "pf_ch_rl"), ("shortest_path", "random")])
def test_same_actor_tempo_retune_and_legacy_only_play_switch_keep_the_existing_loop(monkeypatch, old, target):
    async def exercise():
        session, previous, _ = _session(monkeypatch, old, lambda *_: {})
        invalidated = []
        monkeypatch.setattr(websockets, "ensure_policy_enabled", lambda *_: True)
        monkeypatch.setattr(websockets.pf_ch_bundle, "compatibility_error", lambda _: None)
        monkeypatch.setattr("app.api.sessions._invalidate_scenario_forecasts", invalidated.append)
        try:
            response = await websockets.play(session.id, websockets.PlayRequest(policy=target, speed=9))
            assert play_manager.get(session.id) is previous
            assert previous.policy == old
            assert previous.speed == response["speed"] == 9
            assert session.policy == old
            assert not invalidated
        finally:
            await play_manager.stop(session.id)

    asyncio.run(exercise())


@pytest.mark.parametrize("failure", ["disabled", "incompatible"])
def test_invalid_pf_ch_play_request_cannot_stop_or_relabel_the_running_actor(monkeypatch, failure):
    from fastapi import HTTPException

    async def exercise():
        session, previous, _ = _session(monkeypatch, "shortest_path", lambda *_: {})
        monkeypatch.setattr(websockets, "ensure_policy_enabled", lambda *_: failure != "disabled")
        monkeypatch.setattr(websockets.pf_ch_bundle, "compatibility_error", lambda _: "unsupported geometry")
        try:
            with pytest.raises(HTTPException) as caught:
                await websockets.play(session.id, websockets.PlayRequest(policy="pf_ch_rl"))
            assert caught.value.status_code == 400
            assert play_manager.get(session.id) is previous
            assert previous.running
            assert session.policy == previous.policy == "shortest_path"
        finally:
            await play_manager.stop(session.id)

    asyncio.run(exercise())
