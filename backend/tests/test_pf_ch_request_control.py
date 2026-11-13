"""PF-CH pure inference serializes mutations while forecasts stay responsive."""
import asyncio
import json
from threading import Event
from types import SimpleNamespace

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.core.pf_ch_control import PFChControlMiddleware as DispatcherControlMiddleware
from app.api.sessions import PolicyChangeRequest, set_session_policy
from app.core import pf_ch_control as driver
from app.core.play_manager import PlayState, play_manager

pytestmark = pytest.mark.integration


def _request(session, path, method="GET", body=None):
    async def receive():
        return {"type": "http.request", "body": json.dumps(body or {}).encode(), "more_body": False}

    return Request({"type": "http", "path": f"/session/{session.id}{path}",
                    "method": method, "headers": []}, receive)


def _session(monkeypatch, *, policy="pf_ch_rl", play_policy="pf_ch_rl", running=True):
    session = SimpleNamespace(id="pf-ch-request-control", policy=policy,
                              _pf_ch_command_lock=asyncio.Lock(), control_revision=0,
                              enabled_policy_ids={"pf_ch_rl", "plan", "deadlock_avoidance", "goal_directed", "shortest_path"},
                              env=SimpleNamespace(height=9, width=191, agents=[SimpleNamespace(handle=0)]))
    state = PlayState(session.id, 4, play_policy)
    state.running = running
    play_manager.register(state)
    monkeypatch.setattr("app.core.pf_ch_control.session_manager.get", lambda _: session)

    async def broadcast(*_):
        pass

    monkeypatch.setattr(driver.ws_manager, "broadcast", broadcast)
    return session, state, DispatcherControlMiddleware(lambda *_: None)


@pytest.mark.parametrize(("path", "method"), [
    ("/step", "POST"), ("/action", "POST"), ("/policy", "POST"), ("/agent/0/override", "POST"),
])
def test_manual_mutations_wait_for_pf_ch_inference(monkeypatch, path, method):
    async def exercise():
        session, _, middleware = _session(monkeypatch)
        entered, release = Event(), Event()
        order = []

        def infer():
            entered.set()
            assert release.wait(3), "test did not release inference"
            order.append("inference-complete")

        async def transaction():
            async with driver.command_lock(session):
                await driver.run_inference(session, infer)

        async def handler(_):
            assert driver.command_lock(session).locked()
            assert not getattr(session, "_pf_ch_busy", False)
            order.append("request")
            return JSONResponse({"ok": True})

        worker = asyncio.create_task(transaction())
        request = None
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            request = asyncio.create_task(middleware.dispatch(_request(session, path, method), handler))
            await asyncio.sleep(0)
            assert not request.done()
            assert order == []
            release.set()
            _, response = await asyncio.gather(worker, request)
            assert response.status_code == 200
            assert order == ["inference-complete", "request"]
        finally:
            release.set()
            await asyncio.gather(worker, *([request] if request else []), return_exceptions=True)
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize(("path", "method"), [
    ("/pause", "POST"), ("/reset", "POST"), ("", "DELETE"),
])
def test_stop_signals_before_waiting_and_acknowledges_only_after_drain(monkeypatch, path, method):
    async def exercise():
        session, state, middleware = _session(monkeypatch)
        entered, release = Event(), Event()
        order = []

        def infer():
            entered.set()
            assert release.wait(3), "test did not release inference"
            order.append("inference-complete")

        async def transaction():
            async with driver.command_lock(session):
                await driver.run_inference(session, infer)

        async def stop(_):
            assert not getattr(session, "_pf_ch_busy", False)
            order.append("play-stopped")

        async def acknowledge(_):
            assert driver.command_lock(session).locked()
            assert not getattr(session, "_pf_ch_busy", False)
            order.append("ack")
            return JSONResponse({"ok": True})

        monkeypatch.setattr(play_manager, "stop", stop)
        worker = asyncio.create_task(transaction())
        control = None
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            control = asyncio.create_task(middleware.dispatch(_request(session, path, method), acknowledge))
            await asyncio.sleep(0)
            assert not state.running
            assert not control.done()
            assert order == []
            release.set()
            await asyncio.gather(worker, control)
            assert order == (["inference-complete", "ack"] if path == "/pause"
                             else ["inference-complete", "play-stopped", "ack"])
        finally:
            release.set()
            await asyncio.gather(worker, *([control] if control else []), return_exceptions=True)
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize(("path", "method"), [
    ("/director/progress", "GET"), ("/play_status", "GET"), ("/state", "GET"),
    ("/hmi/scenarios", "GET"), ("/state", "HEAD"),
    ("/step", "OPTIONS"), ("/what-if-override", "POST"),
    ("/director/whatif", "POST"), ("/director/verify", "POST"),
])
def test_reads_and_read_only_previews_remain_available_during_pure_inference(monkeypatch, path, method):
    async def exercise():
        session, _, middleware = _session(monkeypatch)

        async def status(_):
            return JSONResponse({"busy": True})

        try:
            async with driver.command_lock(session):
                response = await asyncio.wait_for(middleware.dispatch(_request(session, path, method), status), 1)
                assert response.status_code == 200
        finally:
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize("running", [True, False])
def test_play_policy_keeps_guard_when_session_policy_is_not_yet_pf_ch(monkeypatch, running):
    async def exercise():
        session, _, middleware = _session(monkeypatch, policy="deadlock_avoidance", running=running)
        session._pf_ch_busy = not running
        calls = []

        async def mutate(_):
            calls.append("mutation")
            return JSONResponse({"ok": True})

        request = None
        try:
            async with driver.command_lock(session):
                request = asyncio.create_task(middleware.dispatch(_request(session, "/action", "POST"), mutate))
                await asyncio.sleep(0)
                assert not request.done()
                assert not calls
            await request
            assert calls == ["mutation"]
        finally:
            if request and not request.done():
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize(("policy", "play_policy"), [
    ("deadlock_avoidance", "deadlock_avoidance"), ("goal_directed", "goal_directed"),
    ("shortest_path", "shortest_path"), ("deadlock_avoidance", "pf_ch_rl"),
])
def test_legacy_and_inactive_former_pf_ch_sessions_keep_their_existing_path(monkeypatch, policy, play_policy):
    async def exercise():
        session, _, middleware = _session(monkeypatch, policy=policy, play_policy=play_policy, running=False)

        async def handler(_):
            return JSONResponse({"ok": True})

        try:
            async with driver.command_lock(session):
                response = await asyncio.wait_for(middleware.dispatch(_request(session, "/state"), handler), 1)
                assert response.status_code == 200
        finally:
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize(("actor", "session_policy", "requested"), [
    ("plan", "plan", "pf_ch_rl"), ("pf_ch_rl", "pf_ch_rl", "plan"),
    ("plan", "pf_ch_rl", "pf_ch_rl"), ("pf_ch_rl", "plan", "plan"),
])
def test_pf_ch_policy_switch_pauses_actual_actor_before_ack(monkeypatch, actor, session_policy, requested):
    async def exercise():
        session, state, middleware = _session(monkeypatch, policy=session_policy, play_policy=actor)
        entered, release = Event(), Event()
        order = []

        def infer():
            entered.set()
            assert release.wait(3), "test did not release inference"
            order.append("inference-drained")

        async def transaction():
            async with driver.command_lock(session):
                await driver.run_inference(session, infer)

        async def apply_policy(_):
            assert not state.running
            assert play_manager.get(session.id) is None
            result = set_session_policy(session.id, PolicyChangeRequest(policy=requested))
            order.append("policy-ack")
            return JSONResponse(result)

        worker = asyncio.create_task(transaction())
        state.task = worker
        change = None
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            change = asyncio.create_task(middleware.dispatch(
                _request(session, "/policy", "POST", {"policy": requested}), apply_policy))
            await asyncio.sleep(0)
            assert not state.running, "Stop must address the actual PlayState, before its lock drains"
            assert not change.done()
            assert session.policy == session_policy
            release.set()
            _, response = await asyncio.gather(worker, change)
            assert response.status_code == 200
            assert session.policy == requested
            assert order == ["inference-drained", "policy-ack"]
        finally:
            release.set()
            await asyncio.gather(worker, *([change] if change else []), return_exceptions=True)
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize(("actor", "requested"), [
    ("pf_ch_rl", "pf_ch_rl"), ("plan", "plan"), ("plan", "goal_directed"),
])
def test_same_actor_and_legacy_only_policy_switch_do_not_pause(monkeypatch, actor, requested):
    async def exercise():
        session, state, middleware = _session(monkeypatch, policy=actor, play_policy=actor)

        async def apply_policy(_):
            return JSONResponse(set_session_policy(session.id, PolicyChangeRequest(policy=requested)))

        try:
            response = await middleware.dispatch(_request(session, "/policy", "POST", {"policy": requested}), apply_policy)
            assert response.status_code == 200
            assert session.policy == requested
            assert state.running
            assert play_manager.get(session.id) is state
        finally:
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


@pytest.mark.parametrize("rejection", ["incompatible", "disabled"])
def test_rejected_pf_ch_policy_request_preserves_running_pp(monkeypatch, rejection):
    from fastapi import HTTPException

    async def exercise():
        session, state, middleware = _session(monkeypatch, policy="plan", play_policy="plan")
        if rejection == "incompatible":
            session.env.width = 100
        else:
            session.enabled_policy_ids.remove("pf_ch_rl")

        async def apply_policy(_):
            return JSONResponse(set_session_policy(session.id, PolicyChangeRequest(policy="pf_ch_rl")))

        try:
            with pytest.raises(HTTPException) as caught:
                await middleware.dispatch(_request(session, "/policy", "POST", {"policy": "pf_ch_rl"}), apply_policy)
            assert caught.value.status_code == 400
            assert session.policy == "plan"
            assert state.running
            assert play_manager.get(session.id) is state
        finally:
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


def test_incoming_pf_ch_play_waits_for_transaction_without_hiding_previous_actor(monkeypatch):
    async def exercise():
        session, state, middleware = _session(monkeypatch, policy="plan", play_policy="plan")
        seen = []

        async def play(_):
            seen.append(state.policy)
            assert not state.running, "The old actor must be signalled before the transaction drains"
            return JSONResponse({"ok": True})

        request = None
        try:
            async with driver.command_lock(session):
                request = asyncio.create_task(middleware.dispatch(
                    _request(session, "/play", "POST", {"policy": "pf_ch_rl", "speed": 4}), play))
                await asyncio.sleep(0)
                assert not request.done()
                assert not seen
                assert not state.running
            await request
            assert seen == ["plan"]
        finally:
            if request and not request.done():
                request.cancel()
                await asyncio.gather(request, return_exceptions=True)
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())
