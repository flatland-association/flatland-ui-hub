"""Service evidence and action semantics shared by lab and live observations."""
from types import SimpleNamespace

import numpy as np
import pytest
import torch
from flatland.core.grid.grid4_utils import get_new_position
from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.rail_grid_transition_map import RailGridTransitionMap
from flatland.envs.step_utils.states import TrainState

from app.policies.learned.ecml_observation import (
    LEGACY_OBSERVATION_SCHEMA,
    OBSERVATION_SCHEMA,
    FastTreeObsBuilder,
)
from app.policies.learned.learned_ppo_policy import (
    ActorCritic,
    LearnedPpoPolicy,
    checkpoint_observation_size,
    load_actor_critic_checkpoint,
)


def _env():
    rail = RailGridTransitionMap(width=7, height=3)
    for col in range(1, 6):
        rail.set_transition((1, col, 1), 1, 1)
        rail.set_transition((1, col, 3), 3, 1)
    waypoints = [[SimpleNamespace(position=(1, col), direction=1)] for col in (1, 2, 4, 5)]
    agent = SimpleNamespace(
        handle=0, waypoints=waypoints, current_configuration=((1, 2), 1),
        initial_configuration=((1, 1), 1), targets={((1, 5), 1)},
        state=TrainState.MOVING, latest_arrival=35,
        waypoints_earliest_departure=[0, 10, 20, None],
        waypoints_latest_arrival=[None, 8, 18, 35],
    )
    positions = np.full((3, 7), -1)
    positions[1, 2] = 0
    return SimpleNamespace(
        agents=[agent], rail=rail, width=7, height=3,
        _elapsed_steps=11, _max_episode_steps=40,
        agent_positions=positions, rewards=SimpleNamespace(states={0: {}}),
        get_num_agents=lambda: 1, get_agent_handles=lambda: [0],
    )


def _builder(env, with_action_mask=True):
    builder = FastTreeObsBuilder(with_action_mask=with_action_mask)
    builder.reset(env)
    return builder


@pytest.mark.parametrize(
    'record,time,expected_index,served_fraction',
    [
        ({((1, 2), 1): {TrainState.MOVING}}, 11, 0, 0),
        ({((1, 2), 3): {TrainState.STOPPED}}, 11, 0, 0),
        ({((1, 2), 1): {TrainState.STOPPED}}, 5, 0, 0.5),
        ({((1, 2), 1): {TrainState.STOPPED}}, 10, 1, 0.5),
        ({((1, 4), 1): {TrainState.STOPPED}}, 21, 0, 0.5),
    ],
)
def test_progress_requires_directed_service_in_order(record, time, expected_index, served_fraction):
    env = _env()
    env._elapsed_steps = time
    env.rewards.states[0] = record
    builder = _builder(env)
    observation = builder.get(0)
    assert builder.waypoint_index[0] == expected_index
    assert observation[34] == served_fraction
    assert observation.shape == (41,)
    assert np.isfinite(observation).all()


def test_served_call_exposes_release_time_until_departure_is_due():
    env = _env()
    env._elapsed_steps = 5
    env.rewards.states[0] = {((1, 2), 1): {TrainState.STOPPED}}
    builder = _builder(env)
    held = builder.get(0)
    assert builder._get_next_waypoint_target(0) == (1, 2)
    assert held[35] == pytest.approx(5 / 40)
    env._elapsed_steps = 10
    released = builder.get(0)
    assert builder._get_next_waypoint_target(0) == (1, 4)
    assert released[35] == pytest.approx(8 / 40)


def test_policy_recreation_reconstructs_the_same_observation():
    env = _env()
    persistent = _builder(env)
    persistent.get(0)
    env.rewards.states[0] = {((1, 2), 1): {TrainState.STOPPED}}
    env.agents[0].current_configuration = ((1, 3), 1)
    env.agent_positions[1, 2] = -1
    env.agent_positions[1, 3] = 0
    expected = persistent.get(0)
    recreated = _builder(env)
    np.testing.assert_array_equal(recreated.get(0), expected)
    assert recreated.waypoint_index[0] == 1
    assert OBSERVATION_SCHEMA == 'ecml36-service-v1'


def test_done_does_not_report_unserved_calls_as_served():
    env = _env()
    env.agents[0].state = TrainState.DONE
    env.agents[0].current_configuration = None
    observation = _builder(env).get(0)
    assert observation[34] == 0
    np.testing.assert_array_equal(observation[36:], [1, 0, 0, 0, 0])


def test_features_agree_with_or_without_appended_mask():
    env = _env()
    np.testing.assert_array_equal(_builder(env).get(0)[:36], _builder(env, False).get(0))


@pytest.mark.parametrize('exit_direction', [0, 2, 3])
def test_forward_is_available_on_single_exit_bends_and_dead_ends(exit_direction):
    env = _env()
    env.rail = RailGridTransitionMap(width=7, height=3)
    configuration = ((1, 3), 1)
    neighbour = get_new_position(configuration[0], exit_direction)
    env.rail.set_transition((*configuration[0], configuration[1]), exit_direction, 1)
    env.rail.set_transition((*neighbour, exit_direction), exit_direction, 1)
    env.agents[0].current_configuration = configuration
    env.agent_positions[:] = -1
    env.agent_positions[configuration[0]] = 0
    assert env.rail.apply_action_independent(RailEnvActions.MOVE_FORWARD, configuration) is not None
    assert _builder(env).get(0)[36 + RailEnvActions.MOVE_FORWARD.value] == 1


@pytest.mark.parametrize('schema', [LEGACY_OBSERVATION_SCHEMA, OBSERVATION_SCHEMA])
def test_checkpoint_schema_selects_compatible_runtime_after_recreation(tmp_path, schema):
    path = tmp_path / 'policy.pt'
    meta = {'observation_schema': schema} if schema == OBSERVATION_SCHEMA else {}
    torch.save({'model': ActorCritic().state_dict(), 'meta': meta}, path)
    env = _env()
    env.rewards.states[0] = {((1, 2), 1): {TrainState.STOPPED}}
    env.agents[0].current_configuration = ((1, 3), 1)
    env.agent_positions[1, 2] = -1
    env.agent_positions[1, 3] = 0
    policy = LearnedPpoPolicy(env, checkpoint=path)
    policy.act_many([0])
    assert policy.obs_builder.schema == schema
    expected_served = 0.5 if schema == OBSERVATION_SCHEMA else 0
    assert policy.last_observations[0][34] == expected_served
    recreated = LearnedPpoPolicy(env, checkpoint=path)
    recreated.act_many([0])
    np.testing.assert_array_equal(recreated.last_observations[0], policy.last_observations[0])


def test_unknown_checkpoint_and_builder_schemas_are_rejected():
    with pytest.raises(ValueError, match='unsupported observation schema'):
        FastTreeObsBuilder(schema='unknown')
    with pytest.raises(ValueError, match='unsupported observation schema'):
        load_actor_critic_checkpoint(ActorCritic(), {'meta': {'observation_schema': 'unknown'}})


@pytest.mark.parametrize('schema', [LEGACY_OBSERVATION_SCHEMA, OBSERVATION_SCHEMA])
def test_checkpoint_width_must_match_declared_schema(schema):
    checkpoint = {'model': ActorCritic(obs_size=37).state_dict(), 'meta': {'observation_schema': schema}}
    with pytest.raises(ValueError, match='expects 36 inputs'):
        checkpoint_observation_size(checkpoint)


@pytest.mark.integration
def test_context_checkpoint_registry_roundtrip_uses_full_inputs_and_mask(tmp_path, monkeypatch):
    from app.core.env_factory import create_env
    from app.core.scenario_runner import TrajectoryBranchRunner
    from app.policies.learned.lab_checkpoints import write_meta
    from app.policies.learned.pf_ch_observation import OBSERVATION_DIM
    from app.policies.learned.pf_ch_observation import OBSERVATION_SCHEMA as CONTEXT_SCHEMA
    from app.policies.registry import get_policy_spec

    monkeypatch.setenv('MARL_LAB_CHECKPOINTS_DIR', str(tmp_path))
    path = tmp_path / 'context.pt'
    meta = {'observation_schema': CONTEXT_SCHEMA, 'observation_dim': OBSERVATION_DIM,
            'experience_updates': 99}
    model = ActorCritic(obs_size=OBSERVATION_DIM)
    counts = {(0,) * 41: {'executed': [100] * 5, 'simulated': [0] * 5}}
    torch.save({'model': model.state_dict(), 'meta': meta, 'experience_counts': counts}, path)
    write_meta(path, meta)
    env = create_env(scenario_preset_id='pf-ch-wn-wal-conflict')
    policy = get_policy_spec('lab:context').runtime_factory(env)
    handles = list(env.get_agent_handles())
    actions = policy.act_many(handles)
    assert policy.model.trunk[0].in_features == OBSERVATION_DIM
    assert policy.obs_builder.schema == CONTEXT_SCHEMA
    assert policy.model.experience_estimator_ready is False
    assert policy.model.experience_counts == {}
    for handle in handles:
        observation = policy.last_observations[handle]
        assert observation.shape == (OBSERVATION_DIM + 5,)
        assert observation[OBSERVATION_DIM + actions[handle]] == 1
        assert len(policy.intervention_features(handle)['obs']) == OBSERVATION_DIM
        assert len(policy.intervention_features(handle)['mask']) == 5
        assert policy.last_action_seen_count_predictions[handle] == []
        assert policy.last_action_seen_count_exact[handle] is False
        assert policy.last_action_seen_count_uncertainty[handle] == [100] * 5
        assert np.isfinite(policy.value_estimate(env, handle))
    recreated = get_policy_spec('lab:context').runtime_factory(env)
    assert recreated.act_many(handles) == actions
    for handle in handles:
        np.testing.assert_array_equal(recreated.last_observations[handle], policy.last_observations[handle])

    fork = TrajectoryBranchRunner(env, lambda: None)._fork_env()
    branched = get_policy_spec('lab:context').branch_factory()
    branched.reset(fork)
    assert branched.act_many(handles) == actions
    for handle in handles:
        np.testing.assert_array_equal(branched.last_observations[handle], policy.last_observations[handle])
        assert branched.value_estimate(fork, handle) == policy.value_estimate(env, handle)
