"""The proposal agent sets its forecast horizon; the yardstick is the scenario's.

The API simulates every course for `agent.forecast_horizon(env)` steps, and
scores them against `proposal_arrival_reference(env)`, the same for every agent:
no agent grades its own work, and the API needs no knowledge of one agent.
"""
from types import SimpleNamespace

from flatland.envs.rail_trainrun_data_structures import TrainrunWaypoint, Waypoint

from app.api import overrides
from app.core.proposal_agents.pp_replan import PPReplanAgent
from app.core.proposal_agents.uc2_rl import UC2RLProposalAgent
from app.core.session_manager import session_manager
from app.policies.plan_policy import accept_trainrun_plan, planned_arrival_steps


def _env(elapsed, max_ep):
    return SimpleNamespace(_elapsed_steps=elapsed, _max_episode_steps=max_ep)


def test_an_ordinary_agent_forecasts_a_bounded_horizon():
    agent = PPReplanAgent()
    assert agent.forecast_horizon(_env(0, 400)) == 250
    assert agent.forecast_horizon(_env(380, 400)) == 50
    assert agent.forecast_horizon(_env(100, 220)) == 120
    assert agent.forecast_horizon(_env(10, 0)) == 200


def test_the_uc2_adviser_replays_the_rest_of_the_episode():
    agent = UC2RLProposalAgent()
    assert agent.forecast_horizon(_env(0, 400)) == 400
    assert agent.forecast_horizon(_env(380, 400)) == 20
    assert agent.forecast_horizon(_env(500, 400)) == 0
    assert agent.forecast_horizon(_env(10, 0)) == 200


def test_an_accepted_course_is_no_yardstick_where_the_scenario_shipped_no_plan():
    s = session_manager.create(width=30, height=30, number_of_agents=2, seed=7)
    try:
        assert planned_arrival_steps(s.env) == {}
        before = overrides.proposal_arrival_reference(s.env)
        start = s.env.agents[0].initial_configuration
        accept_trainrun_plan(s.env, {0: [TrainrunWaypoint(9999, Waypoint(*start))]})
        assert planned_arrival_steps(s.env) == {0: 10000}, "the accepted course looks like a plan"
        assert overrides.proposal_arrival_reference(s.env) == before
    finally:
        session_manager.delete(s.id)
