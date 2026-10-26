"""Graph env playground: sessions step the live env until done and are evicted beyond the cap."""
import pytest
from flatland.envs.step_utils.states import TrainState

from app.graph_env.service import GraphEnvSession, GraphEnvSessions


def test_step_until_done():
    session = GraphEnvSession("s")
    assert session.env._elapsed_steps == 0

    session.step(10)
    assert session.env._elapsed_steps == 10
    assert not session.done

    session.step(10_000)
    assert session.done
    assert session.env.agents[0].state == TrainState.DONE
    steps = session.env._elapsed_steps

    session.step(5)  # no-op once done
    assert session.env._elapsed_steps == steps


def test_reset_starts_over():
    session = GraphEnvSession("s")
    session.step(20)

    session.reset()

    assert session.env._elapsed_steps == 0
    assert not session.done


def test_sessions_create_get_and_evict():
    sessions = GraphEnvSessions(max_sessions=2)
    first = sessions.create()
    second = sessions.create()
    assert sessions.get(first.id) is first  # now the most recently used

    third = sessions.create()

    assert len(sessions) == 2
    assert sessions.get(first.id) is first
    assert sessions.get(third.id) is third
    with pytest.raises(KeyError):
        sessions.get(second.id)


def test_sessions_unknown_id():
    with pytest.raises(KeyError):
        GraphEnvSessions().get("nope")
