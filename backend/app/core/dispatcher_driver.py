"""Read-only playback telemetry and drained worker execution for dispatcher runs."""
from __future__ import annotations

import asyncio
from collections.abc import Callable
from threading import Event

from app.core.play_manager import play_manager
from app.core.ws_manager import ws_manager


def playback(session) -> dict:
    return {'playing': play_manager.is_playing(session.id),
            'busy': bool(getattr(session, 'command_busy', False))}


async def broadcast_playback(session) -> None:
    await ws_manager.broadcast(session.id, {'type': 'play_status', 'session_id': session.id, **playback(session)})


def request_stop(session) -> None:
    """Prevent a new step; an already-running model call drains before ACK."""
    state = play_manager.get(session.id)
    if state is not None:
        state.running = False
    token = getattr(session, 'command_cancel', None)
    if token is not None:
        token.set()


def interrupted(session) -> bool:
    token = getattr(session, 'command_cancel', None)
    return bool(token is not None and token.is_set())


async def run_in_worker(session, work: Callable):
    """Do not release a caller's command transaction while its worker can write."""
    session.command_cancel = Event()
    session.command_busy = True
    worker = None
    try:
        await broadcast_playback(session)
        worker = asyncio.create_task(asyncio.to_thread(work))
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        request_stop(session)
        # Cancelling asyncio.to_thread does not stop its Python/model thread.
        # Keep the caller's lock until no late commit/step can race a handover.
        if worker is not None:
            while not worker.done():
                try:
                    await asyncio.shield(worker)
                except asyncio.CancelledError:
                    # Another stop/shutdown request must not release the transaction.
                    continue
            worker.result()
        raise
    finally:
        session.command_busy = False
        session.command_cancel = None
        await broadcast_playback(session)
