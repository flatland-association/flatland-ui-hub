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
