"""Deleting a run drains its actual actor, including after an RL→PP switch."""
import asyncio
from types import SimpleNamespace

import pytest

from app.api.sessions import delete_session
from app.core.play_manager import PlayState, play_manager
from app.core.session_manager import session_manager

pytestmark = pytest.mark.integration


class _Environment:
    pass


@pytest.mark.parametrize('actor', ['pf_ch_rl', 'goal_directed', 'plan'])
def test_delete_waits_for_actor_cancellation_before_releasing_only_its_session(monkeypatch, actor):
    async def exercise():
        deleted = SimpleNamespace(id='delete-playing', env=_Environment(), trajectory=None)
        other = SimpleNamespace(id='keep-playing', env=_Environment(), trajectory=None)
        monkeypatch.setattr(session_manager, '_sessions', {deleted.id: deleted, other.id: other})
        monkeypatch.setattr(play_manager, '_states', {})
        entered, cancelling, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
        order = []

        async def actor_loop():
            entered.set()
            try:
                await asyncio.Event().wait()
            except asyncio.CancelledError:
                cancelling.set()
                await release.wait()
                order.append('actor-drained')
                raise

        state = PlayState(deleted.id, 5, actor)
        state.running = True
        state.task = asyncio.create_task(actor_loop())
        play_manager.register(state)
        other_state = PlayState(other.id, 5, 'plan')
        other_state.running = True
        play_manager.register(other_state)
        deletion = None
        try:
            await entered.wait()
            deletion = asyncio.create_task(delete_session(deleted.id))
            await asyncio.wait_for(cancelling.wait(), 2)
            assert not deletion.done(), 'DELETE cannot acknowledge while the actual actor is still draining'
            assert session_manager.get(deleted.id) is deleted
            assert not state.running
            assert play_manager.get(other.id) is other_state and other_state.running
            release.set()
            response = await asyncio.wait_for(deletion, 2)
            order.append('delete-ack')
            assert response == {'deleted': deleted.id}
            assert order == ['actor-drained', 'delete-ack']
            assert state.task.done() and play_manager.get(deleted.id) is None
            assert session_manager.get(deleted.id) is None
            assert session_manager.get(other.id) is other
            assert play_manager.get(other.id) is other_state and other_state.running
        finally:
            release.set()
            await asyncio.gather(state.task, *([deletion] if deletion else []), return_exceptions=True)
            await play_manager.stop(other.id)

    asyncio.run(exercise())
