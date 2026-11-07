"""Dispatcher transactions stay observable and drain before handover."""
import asyncio
from threading import Event
from types import SimpleNamespace

import pytest
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.api.dispatcher import DispatcherControlMiddleware
from app.core import dispatcher_driver as driver
from app.core.play_manager import PlayState, play_manager

pytestmark = pytest.mark.integration


def test_cancelled_worker_keeps_transaction_locked_until_no_late_write_is_possible(monkeypatch):
    async def exercise():
        entered, release = Event(), Event()
        writes, messages = [], []
        session = SimpleNamespace(id='drain-worker-test', command_lock=asyncio.Lock())

        async def broadcast(_, payload):
            messages.append(payload)

        monkeypatch.setattr(driver.ws_manager, 'broadcast', broadcast)

        def compute():
            entered.set()
            assert release.wait(3), 'test did not release its worker'
            writes.append('inflight-finished')

        async def transaction():
            async with session.command_lock:
                await driver.run_in_worker(session, compute)

        task = asyncio.create_task(transaction())
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            assert driver.playback(session) == {'playing': False, 'busy': True}
            task.cancel()
            await asyncio.sleep(0)
            assert session.command_lock.locked()
            assert driver.interrupted(session)
            assert not task.done()
            task.cancel()
            await asyncio.sleep(0)
            assert not task.done()
            assert session.command_lock.locked()
            assert driver.playback(session)['busy'] is True
            release.set()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert writes == ['inflight-finished']
            assert not session.command_lock.locked()
            assert driver.playback(session)['busy'] is False
            assert [m['busy'] for m in messages] == [True, False]
        finally:
            release.set()
            if not task.done():
                await asyncio.gather(task, return_exceptions=True)

    asyncio.run(exercise())


def test_progress_reads_bypass_busy_transaction_and_handover_waits_for_it(monkeypatch):
    async def exercise():
        entered, release = Event(), Event()
        order = []
        session = SimpleNamespace(id='handover-worker-test', command_lock=asyncio.Lock(),
                                  dispatcher=SimpleNamespace(owner='agent'))
        state = PlayState(session.id, 1, 'random')
        state.running = True
        play_manager.register(state)

        async def broadcast(*_):
            pass

        monkeypatch.setattr(driver.ws_manager, 'broadcast', broadcast)
        monkeypatch.setattr('app.api.dispatcher.session_manager.get', lambda _: session)
        middleware = DispatcherControlMiddleware(lambda *_: None)

        def compute():
            entered.set()
            assert release.wait(3), 'test did not release its worker'
            order.append('worker-finished')

        async def transaction():
            async with session.command_lock:
                await driver.run_in_worker(session, compute)

        def request(path, method='GET'):
            return Request({'type': 'http', 'path': f'/session/{session.id}{path}', 'method': method, 'headers': []})

        async def read_status(_):
            return JSONResponse(driver.playback(session))

        async def acknowledge(_):
            assert not driver.playback(session)['busy']
            order.append('ownership-ack')
            return JSONResponse({'owner': 'human'})

        task = asyncio.create_task(transaction())
        handover = None
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            for path in ('/director/progress', '/play_status'):
                response = await asyncio.wait_for(middleware.dispatch(request(path), read_status), 1)
                assert response.status_code == 200
                assert b'"busy":true' in response.body
            handover = asyncio.create_task(middleware.dispatch(
                request('/dispatcher/ownership', 'POST'), acknowledge))
            await asyncio.sleep(0)
            assert not state.running
            assert driver.interrupted(session)
            assert not handover.done()
            assert order == []
            release.set()
            await asyncio.gather(task, handover)
            assert order == ['worker-finished', 'ownership-ack']
        finally:
            release.set()
            await asyncio.gather(task, *([handover] if handover else []), return_exceptions=True)
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())


def test_cancelling_before_worker_start_clears_busy_without_starting_work(monkeypatch):
    async def exercise():
        started = asyncio.Event()
        session = SimpleNamespace(id='cancel-start-test', command_lock=asyncio.Lock())
        calls = []

        async def broadcast(_, payload):
            if payload['busy']:
                started.set()
                await asyncio.Event().wait()

        monkeypatch.setattr(driver.ws_manager, 'broadcast', broadcast)

        async def transaction():
            async with session.command_lock:
                await driver.run_in_worker(session, lambda: calls.append('started'))

        task = asyncio.create_task(transaction())
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert calls == []
        assert not session.command_lock.locked()
        assert driver.playback(session)['busy'] is False
        assert not driver.interrupted(session)

    asyncio.run(exercise())


@pytest.mark.parametrize("terminal_status", ["aborted", "finished"])
def test_later_human_playback_failure_preserves_terminal_dispatcher_evidence(monkeypatch, terminal_status):
    from app.api import websockets
    from app.core.dispatcher import DispatcherConfig, DispatcherRuntime

    async def exercise():
        session = SimpleNamespace(id=f'terminal-playback-{terminal_status}', command_lock=asyncio.Lock(),
            env=SimpleNamespace(_elapsed_steps=7, _max_episode_steps=7,
                agents=[SimpleNamespace(state=SimpleNamespace(name='MOVING'))]), policy='random')
        runtime = DispatcherRuntime(session, DispatcherConfig(), 'recommendation', operator_type='human_dispatcher_team')
        session.dispatcher = runtime
        if terminal_status == 'aborted':
            runtime.invalidate(session, 'stop', human=True)
            runtime.run_status, runtime.abort_reason = 'aborted', 'stop'
        else:
            runtime.after_step(session, True)
            runtime.invalidate(session, 'takeover', human=True)
        original_reason = runtime.abort_reason
        original_metrics = runtime.metrics(session)
        original_result = runtime.simulation_result(session)
        # A human can reset and run the environment while old run evidence stays sealed.
        session.env._elapsed_steps = 0
        session.env._max_episode_steps = 50
        messages, calls = [], []

        async def broadcast(_, payload):
            messages.append(payload)

        def fail_pulse(*_args):
            calls.append('worker-entered')
            raise RuntimeError('later human playback failed')

        monkeypatch.setattr(websockets.session_manager, 'get', lambda _: session)
        monkeypatch.setattr(websockets.ws_manager, 'broadcast', broadcast)
        monkeypatch.setattr(websockets, '_dispatcher_pulse', fail_pulse)
        monkeypatch.setattr(websockets, '_build_state_payload', lambda *_: {
            'type': 'state', 'session_id': session.id, 'state': {'dispatcher': runtime.snapshot(session)}})
        monkeypatch.setattr(websockets, 'log_ws', lambda *_args, **_kwargs: None)
        state = PlayState(session.id, 1, session.policy)
        state.running = True
        play_manager.register(state)
        try:
            await websockets._dispatcher_play_loop(session.id)
            assert calls == ['worker-entered']
            assert runtime.owner == 'human'
            assert runtime.run_status == terminal_status
            assert runtime.abort_reason == original_reason
            assert runtime.metrics(session) == original_metrics
            assert runtime.simulation_result(session) == original_result
            assert not any(event['kind'] == 'run_error' for event in runtime.events)
            assert any(message['type'] == 'error' for message in messages)
            assert driver.playback(session) == {'playing': False, 'busy': False}
            assert not session.command_lock.locked()
        finally:
            play_manager._states.pop(session.id, None)

    asyncio.run(exercise())
