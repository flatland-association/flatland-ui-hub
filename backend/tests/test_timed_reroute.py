"""Stage 2g: a reroute timed against the other trains' forecast.

Plan: docs/plans/proposal-agents-roadmap.md (stage 2g).
"""
import warnings

warnings.filterwarnings("ignore")

import pytest
from flatland.envs.rail_env_action import RailEnvActions

from app.api.overrides import _branch_run, _policy_factory_for_session
from app.api.sessions import _build_policy
from app.core.route_overrides import (
    REROUTE_ACTION,
    commit_route,
    drop_route,
    route_around_blocks,
    route_move,
)
from app.core.scenario_runner import TrajectoryBranchRunner
from app.core.session_manager import session_manager

PRESET = "pf-ch-corridor-stops"  # no plan to prefer: the untimed reroute meets oncoming trains
FORK_STEP = 20
#: Without timing this reroute strands it and drags four more trains down (4 of 16 arrive).
TRAIN = 14


@pytest.fixture(scope="module")
def session():
    session = session_manager.create(scenario_preset_id=PRESET)
    policy = _build_policy(session.id, session.env, session.policy)
    for _ in range(FORK_STEP):
        policy.start_step()
        actions = policy.act_many(session.env.get_agent_handles(), session.last_observations or {})
        session.last_observations, _, _, _ = session.env.step(actions)
        policy.end_step()
    return session


def test_the_timed_reroute_arrives_where_the_untimed_one_strands(session):
    factory = _policy_factory_for_session(session)
    untimed = TrajectoryBranchRunner(session.env, factory, timed_routes=False).run_branch(
        overrides={TRAIN: REROUTE_ACTION}, max_steps=200,
    )
    timed = _branch_run(session.env, factory, {TRAIN: REROUTE_ACTION}, 200)

    assert not untimed.agent_outcomes[TRAIN]["arrived"]
    assert timed.agent_outcomes[TRAIN]["arrived"]
    assert timed.success_count > untimed.success_count


def test_a_committed_route_keeps_when_each_cell_is_due(session):
    env = session.env
    try:
        route = commit_route(env, TRAIN, _policy_factory_for_session(session))
        times = env._route_times[TRAIN]

        assert route[0] == (*env.agents[TRAIN].position, env.agents[TRAIN].direction)
        assert len(times) == len(route)
        assert times == sorted(times) and times[0] == env._elapsed_steps
    finally:
        drop_route(env, TRAIN)
    assert TRAIN not in env._route_times


def test_without_a_course_the_route_is_untimed(session):
    env = session.env
    try:
        assert commit_route(env, TRAIN) == route_around_blocks(env, TRAIN)
        assert TRAIN not in env._route_times
    finally:
        drop_route(env, TRAIN)


def test_the_train_waits_until_its_next_cell_is_due(session):
    env = session.env
    route = route_around_blocks(env, TRAIN)
    now = env._elapsed_steps
    try:
        env._route_overrides[TRAIN] = route
        env._route_times[TRAIN] = [now, now + 5] + [now + 5 + i for i in range(1, len(route) - 1)]
        assert route_move(env, TRAIN) == RailEnvActions.STOP_MOVING

        env._route_times[TRAIN] = [now + i for i in range(len(route))]
        assert route_move(env, TRAIN) != RailEnvActions.STOP_MOVING
    finally:
        drop_route(env, TRAIN)


def test_the_forecast_fork_does_not_time_again(session):
    factory = _policy_factory_for_session(session)

    assert TrajectoryBranchRunner(session.env, factory)._fork_env()._route_policy_factory is factory
    assert TrajectoryBranchRunner(session.env, factory, timed_routes=False)._fork_env()._route_policy_factory is None
