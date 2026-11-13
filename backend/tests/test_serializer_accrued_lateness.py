"""Fleet totals keep actual arrival lateness without changing live badges."""
import copy
from types import SimpleNamespace

import pytest
from flatland.envs.step_utils.states import TrainState

from app.core.serializer import serialize_agent, serialize_env


def _agent(*, state=TrainState.MOVING, latest=10, arrival=None):
    return SimpleNamespace(
        state=state, handle=0, earliest_departure=0, latest_arrival=latest,
        arrival_time=arrival, current_configuration=((0, 0), 1),
        initial_configuration=((0, 0), 1), targets={((0, 1), 1)},
        waypoints=[], speed_counter=SimpleNamespace(speed=1.0),
        malfunction_handler=SimpleNamespace(malfunction_down_counter=0),
    )


def test_done_lateness_uses_actual_arrival_and_stays_fixed_afterwards():
    agent = _agent(state=TrainState.DONE, latest=10, arrival=18)
    env = SimpleNamespace(_elapsed_steps=30)
    first = serialize_agent(env, agent)
    env._elapsed_steps = 150
    later = serialize_agent(env, agent)
    assert first['arrival_time'] == later['arrival_time'] == 18
    assert first['accrued_lateness'] == later['accrued_lateness'] == 8
    assert first['delay'] == later['delay'] == 0
    assert first['is_visible'] is later['is_visible'] is False


@pytest.mark.parametrize('state', [TrainState.WAITING, TrainState.READY_TO_DEPART,
                                 TrainState.MOVING, TrainState.STOPPED])
def test_unfinished_lateness_uses_current_clock_even_with_an_arrival_field(state):
    agent = _agent(state=state, latest=10, arrival=3)
    env = SimpleNamespace(_elapsed_steps=12)
    assert serialize_agent(env, agent)['accrued_lateness'] == 2
    env._elapsed_steps = 15
    payload = serialize_agent(env, agent)
    assert payload['accrued_lateness'] == payload['delay'] == 5


@pytest.mark.parametrize('state', [TrainState.MOVING, TrainState.DONE])
def test_missing_deadline_does_not_invent_lateness(state):
    payload = serialize_agent(SimpleNamespace(_elapsed_steps=100), _agent(state=state, latest=None))
    assert payload['accrued_lateness'] == 0
    assert payload['arrival_time'] is None


@pytest.mark.parametrize('arrival', [None, -1, 'unknown'])
def test_done_unknown_arrival_is_null_instead_of_current_time(arrival):
    payload = serialize_agent(SimpleNamespace(_elapsed_steps=100),
                              _agent(state=TrainState.DONE, latest=10, arrival=arrival))
    assert payload['arrival_time'] is None
    assert payload['accrued_lateness'] is None
    assert payload['delay'] == 0


def test_older_agents_without_arrival_field_keep_unknown_done_lateness():
    agent = _agent(state=TrainState.DONE)
    del agent.arrival_time
    payload = serialize_agent(SimpleNamespace(_elapsed_steps=100), agent)
    assert payload['arrival_time'] is payload['accrued_lateness'] is None


@pytest.mark.parametrize('state,clock,arrival', [(TrainState.MOVING, 8, None),
                                               (TrainState.DONE, 50, 8)])
def test_on_time_lateness_cannot_be_negative(state, clock, arrival):
    payload = serialize_agent(SimpleNamespace(_elapsed_steps=clock),
                              _agent(state=state, latest=10, arrival=arrival))
    assert payload['accrued_lateness'] == 0


def test_zero_deadline_is_a_real_deadline_and_serialization_is_read_only():
    env = SimpleNamespace(_elapsed_steps=50)
    agent = _agent(state=TrainState.DONE, latest=0, arrival=12)
    before = copy.deepcopy((env.__dict__, agent.__dict__))
    payload = serialize_agent(env, agent)
    assert payload['accrued_lateness'] == payload['arrival_time'] == 12
    assert (env.__dict__, agent.__dict__) == before


@pytest.mark.integration
def test_selected_uc2_three_retains_actual_lateness_after_all_three_arrivals():
    from app.policies import registry
    from lab.marl.pf_ch_episode import PFChCase, PFChEpisode

    episode = PFChEpisode(PFChCase('uc2-3'))
    try:
        policy = registry.create_runtime_policy('uc2_rl', episode.env)
        while not episode.done:
            episode.step(policy.act_many(episode.handles))
        assert episode.metrics()['complete_mission']
        expected = [max(0, int(agent.arrival_time) - int(agent.latest_arrival))
                    for agent in episode.env.agents]
        assert sum(expected) > 0  # This fixture must exercise late completed trains.
        assert episode.metrics()['lateness'] == sum(expected)
        before = [(agent.state, agent.arrival_time, agent.current_configuration,
                   agent.speed_counter.speed, agent.speed_counter.distance,
                   agent.malfunction_handler.malfunction_down_counter) for agent in episode.env.agents]
        elapsed = episode.now
        payload = serialize_env(episode.env)
        assert [agent['accrued_lateness'] for agent in payload['agents']] == expected
        assert sum(agent['accrued_lateness'] for agent in payload['agents']) == sum(expected)
        assert all(agent['delay'] == 0 and agent['state'] == 'DONE' for agent in payload['agents'])
        assert [agent['arrival_time'] for agent in payload['agents']] == [int(agent.arrival_time) for agent in episode.env.agents]
        assert episode.now == elapsed
        assert before == [(agent.state, agent.arrival_time, agent.current_configuration,
                           agent.speed_counter.speed, agent.speed_counter.distance,
                           agent.malfunction_handler.malfunction_down_counter) for agent in episode.env.agents]
    finally:
        episode.close()
