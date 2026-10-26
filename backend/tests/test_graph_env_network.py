"""Graph env playground: the network JSON loads into a valid GraphRailEnv, and the shortest-path policy gets the train
to its target (cf. test_double_vertex_graph_to_env.py in flatland-scenarios #36)."""
from flatland.envs.rail_env import RailEnvActions
from flatland.envs.step_utils.states import TrainState

from app.graph_env.env_factory import (
    MAX_EPISODE_STEPS,
    SOURCE,
    TARGET,
    GraphShortestPathPolicy,
    create_playground_env,
)
from app.graph_env.network import load_network


def test_load_network():
    g = load_network()

    assert g.number_of_nodes() == 76
    assert g.number_of_edges() == 82
    assert SOURCE in g and TARGET in g
    for u, v, data in g.edges(data=True):
        assert data["actions"] and data["actions"] <= set(RailEnvActions), (u, v)
        assert data["length"] > 0
        assert len(data["geometry"]) >= 2
    # dead ends prohibit all actions, as add_actions() leaves them
    for n in g.nodes:
        if g.out_degree(n) == 0:
            assert g.nodes[n]["prohibited_actions"] == set(RailEnvActions)
        else:
            assert "prohibited_actions" not in g.nodes[n]


def test_playground_env_actions_partitioned():
    env = create_playground_env()

    env.rail._assert_actions_partitioned()


def test_shortest_path_policy_arrives():
    env = create_playground_env()
    env.reset()
    policy = GraphShortestPathPolicy()
    handles = env.get_agent_handles()

    done = False
    while not done:
        actions = policy.act_many(handles, [env] * len(handles))
        _, _, dones, _ = env.step(actions)
        done = dones["__all__"]

    assert env.agents[0].state == TrainState.DONE
    assert env._elapsed_steps < MAX_EPISODE_STEPS
