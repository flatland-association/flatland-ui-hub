"""Tests for the flatland-rl 4.3.0 EnvAgent compatibility accessors."""
import warnings
warnings.filterwarnings("ignore")

from flatland.envs.agent_utils import EnvAgent

from app.policies.goal_based_policies.visualization import build_demo_env
from app.utils.agent_compat import (
    agent_direction,
    agent_initial_direction,
    agent_initial_position,
    agent_planned_target,
    agent_position,
    agent_target_positions,
)


def test_position_and_direction_reflect_current_configuration():
    agent = EnvAgent(initial_configuration=((1, 2), 0))
    assert agent_position(agent) is None
    assert agent_direction(agent) is None

    agent.current_configuration = ((3, 4), 1)
    assert agent_position(agent) == (3, 4)
    assert agent_direction(agent) == 1


def test_initial_position_and_direction():
    agent = EnvAgent(initial_configuration=((1, 2), 3))
    assert agent_initial_position(agent) == (1, 2)
    assert agent_initial_direction(agent) == 3


def test_target_positions_is_the_full_acceptance_set():
    agent = EnvAgent(initial_configuration=((0, 0), 0))
    agent.targets = {((5, 5), 0), ((5, 5), 1), ((7, 7), 2)}
    assert agent_target_positions(agent) == {(5, 5), (7, 7)}


def test_planned_target_reads_the_assigned_terminus_from_waypoints():
    env = build_demo_env(number_of_agents=1)
    agent = env.agents[0]
    assert agent.waypoints, "this env should populate the line's waypoints"
    expected = tuple(int(v) for v in agent.waypoints[-1][0].position)
    assert tuple(int(v) for v in agent_planned_target(agent)) == expected


def test_planned_target_falls_back_to_targets_without_waypoints():
    """EnvAgent.waypoints defaults to [[]] - one empty leg, not an empty
    list - so the fallback must also trigger on that, not just on a falsy
    `waypoints` attribute."""
    agent = EnvAgent(initial_configuration=((0, 0), 0))
    agent.targets = {((5, 5), 0), ((5, 5), 1)}
    assert agent.waypoints == [[]]
    assert tuple(agent_planned_target(agent)) == (5, 5)
