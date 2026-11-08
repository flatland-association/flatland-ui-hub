"""Strict upstream PP adapters and lossless native schedule conversion."""
from types import SimpleNamespace

import networkx as nx
import pytest
from flatland.envs.rail_trainrun_data_structures import TrainrunWaypoint, Waypoint
from flatland.envs.step_utils.states import TrainState

from app.core.stops import Stop
from app.planners.blackbox.utils import NoSolutionError, add_proxy_nodes, true_distance_heuristic
from app.planners.director_pp import schedules_from_trainruns
from app.planners.replan import _start_states, _StopAwarePP
from app.policies.goal_based_policies.infrastructure_graph import (
    DecisionPointGraph,
    GraphEdge,
    GraphNode,
)


def _pp_agent(stop):
    return SimpleNamespace(
        handle=0, initial_position=(0, 0), target=(0, 2), heading=1,
        earliest_departure=0, elapsed=0, stops=[stop],
    )


def test_strict_pp_rejects_a_mandatory_stop_that_legacy_pp_skips():
    graph = nx.DiGraph()
    graph.add_edge((0, 0, 1), (0, 1, 1), l=1)
    graph.add_edge((0, 1, 1), (0, 2, 1), l=1)
    graph.add_node((1, 0, 1), type="rail")
    for node in graph:
        graph.nodes[node]["type"] = "rail"
    stop = Stop(1, ((1, 0, 1),), 0, None)
    agent = _pp_agent(stop)
    graph = add_proxy_nodes(graph, [agent], cost=0.0)

    legacy = _StopAwarePP(graph.copy()).solve([agent])
    assert legacy[0][-1][0][:2] == (0, 2)
    with pytest.raises(NoSolutionError):
        _StopAwarePP(graph.copy(), strict_stops=True).solve([agent])


def test_strict_pp_enforces_stop_heading_using_unchanged_upstream_search():
    # The upstream goal test compares cells. Its cheaper result reaches the
    # correct cell in the wrong direction; only the longer route serves this
    # directional call. The strict adapter supplies a sink reachable solely
    # from the required rail state.
    start, wrong, middle, right = (0, 0, 1), (0, 1, 3), (1, 0, 1), (0, 1, 1)
    graph = nx.DiGraph()
    graph.add_edge(start, wrong, l=1)
    graph.add_edge(wrong, middle, l=1)
    graph.add_edge(middle, right, l=1)
    distances = true_distance_heuristic(graph, right)
    legacy = _StopAwarePP(graph.copy())
    strict = _StopAwarePP(graph.copy(), strict_stops=True)

    assert legacy._cooperative_a_star(0, start, right, distances, 0)[-1][0] == wrong
    assert strict._cooperative_a_star(0, start, right, distances, 0)[-1][0] == right
    assert set(strict.nx_graph.nodes) == set(graph.nodes)


def test_strict_pp_uses_the_assigned_terminus_instead_of_an_arbitrary_platform():
    agent = SimpleNamespace(
        handle=0, state=TrainState.WAITING, current_configuration=None,
        initial_configuration=((0, 0), 1), earliest_departure=0,
        targets={((0, 1), 1), ((0, 3), 1)},
        waypoints=[[Waypoint((0, 0), 1)], [Waypoint((0, 3), 1)]],
    )
    env = SimpleNamespace(agents=[agent], _elapsed_steps=0)

    assert _start_states(env)[0].target == (0, 1)
    assert _start_states(env, strict_stops=True)[0].target == (0, 3)


def _conversion_case(times=(0, 1, 2, 3)):
    agent = SimpleNamespace(
        handle=0, state=TrainState.WAITING, current_configuration=None,
        initial_configuration=((0, 0), 1), earliest_departure=0,
    )
    env = SimpleNamespace(
        agents=[agent], _elapsed_steps=0,
        rail=SimpleNamespace(get_transitions=lambda *_: (0, 1, 0, 0)),
    )
    nodes = {
        (0, 0): GraphNode((0, 0), node_id=0),
        (0, 3): GraphNode((0, 3), node_id=1),
    }
    graph = DecisionPointGraph(nodes=nodes, switch_cells={}, edges=[GraphEdge(
        (0, 0), (0, 3), 1, 1, ((0, 0), (0, 1), (0, 2), (0, 3))
    )])
    runs = {0: [TrainrunWaypoint(t, Waypoint((0, c), 1)) for c, t in enumerate(times)]}
    return env, graph, runs


def test_native_conversion_preserves_node_wait_without_inventing_extra_nodes():
    env, graph, runs = _conversion_case((0, 3, 4, 5))

    schedules = schedules_from_trainruns(env, graph, runs)

    assert schedules is not None
    assert schedules[0].to_flat_list() == [0, 2, 1, 0]


def test_native_conversion_rejects_mid_edge_wait():
    env, graph, runs = _conversion_case((0, 1, 4, 5))

    assert schedules_from_trainruns(env, graph, runs) is None


def test_native_conversion_preserves_delayed_insertion_as_off_grid_time():
    env, graph, runs = _conversion_case((2, 3, 4, 5))

    schedules = schedules_from_trainruns(env, graph, runs)

    assert schedules is not None
    assert schedules[0].entries[0].not_before == 2
    assert schedules[0].entries[0].wait == 0


def test_native_conversion_rejects_a_route_the_player_would_resolve_differently():
    env, graph, _ = _conversion_case()
    env.rail.get_transitions = lambda *_: (1, 1, 0, 0)
    graph.edges.append(GraphEdge(
        (0, 0), (0, 3), 0, 2,
        ((0, 0), (-1, 0), (-1, 1), (-1, 2), (-1, 3), (0, 3)),
    ))
    cells = graph.edges[-1].path
    headings = (1, 0, 1, 1, 1, 2)
    runs = {0: [TrainrunWaypoint(i, Waypoint(c, d))
                for i, (c, d) in enumerate(zip(cells, headings))]}

    assert schedules_from_trainruns(env, graph, runs) is None


def test_native_conversion_requires_a_plan_for_every_active_train():
    env, graph, runs = _conversion_case()
    env.agents.append(SimpleNamespace(handle=1, state=TrainState.WAITING))

    assert schedules_from_trainruns(env, graph, runs) is None


def test_large_imported_network_does_not_trigger_the_demo_pp_portfolio():
    from app.planners.director_pp import candidate_trainruns

    env = SimpleNamespace(agents=[SimpleNamespace(state=TrainState.WAITING) for _ in range(17)])

    assert candidate_trainruns(env) == []


def test_strict_native_wait_constraint_preserves_movement_successors():
    start, middle, goal = (0, 0, 1), (0, 1, 1), (0, 2, 1)
    graph = nx.DiGraph()
    graph.add_edge(start, middle, l=1)
    graph.add_edge(middle, goal, l=1)
    unconstrained = _StopAwarePP(graph.copy(), strict_stops=True)
    constrained = _StopAwarePP(graph.copy(), strict_stops=True, wait_cells={(0, 0), (0, 2)})

    old = unconstrained._get_successors(0, middle, 0, 0)
    new = constrained._get_successors(0, middle, 0, 0)

    assert any(node == middle for node, _, _ in old)
    assert new == [successor for successor in old if successor[0] != middle]


def test_strict_native_wait_constraint_respects_directional_approaches():
    source, middle, target = (0, 0, 3), (0, 1, 3), (0, 2, 3)
    graph = nx.DiGraph()
    graph.add_edge(source, middle, l=1)
    graph.add_edge(middle, target, l=1)
    solver = _StopAwarePP(
        graph, strict_stops=True, wait_cells={(0, 1)}, wait_states={(0, 1, 1)},
    )

    assert all(node != middle for node, _, _ in solver._get_successors(0, middle, 0, 0))


def test_strict_pp_does_not_wait_forever_for_a_reserved_target():
    source, target = (0, 0, 1), (0, 1, 1)
    graph = nx.DiGraph()
    graph.add_edge(source, target, l=1)
    solver = _StopAwarePP(graph, strict_stops=True, max_time=3)
    solver.res_manager.block_path(1, [(target, t) for t in range(10)])
    distances = true_distance_heuristic(graph, target)

    assert solver._cooperative_a_star(0, source, target, distances, 0) is None


def test_strict_pp_rejects_an_unreachable_target_before_searching_waits():
    source, target = (0, 0, 1), (0, 1, 1)
    graph = nx.DiGraph()
    graph.add_nodes_from([source, target])
    solver = _StopAwarePP(graph, strict_stops=True, max_time=3)

    assert solver._cooperative_a_star(
        0, source, target, true_distance_heuristic(graph, target), 0
    ) is None


@pytest.mark.integration
def test_strict_existing_pp_plan_completes_a_real_three_service_episode():
    from app.core.session_manager import session_manager
    from app.planners.director_pp import candidate_trainruns
    from app.planners.plan_validation import validate_trainruns

    session = session_manager.create(
        scenario_preset_id="pf-ch-wn-wal-long-approach", seed=42,
        max_episode_steps=150, malfunction_rate=0,
    )
    try:
        candidates = candidate_trainruns(session.env, max_orders=1)
        assert candidates, "the strict adapter should preserve the known small PP case"
        result = validate_trainruns(session.env, candidates[0][1])
        assert result.accepted, result.to_dict()
    finally:
        session_manager.delete(session.id)


@pytest.mark.integration
def test_native_strict_pp_completes_all_sixteen_services_and_forty_eight_calls():
    from app.core.session_manager import session_manager
    from app.planners.director_pp import candidate_schedules
    from app.planners.plan_validation import validate_schedules
    from app.policies.goal_directed_policy import _director_graph

    session = session_manager.create(
        scenario_preset_id="pf-ch-corridor-stops", seed=42,
        max_episode_steps=320, malfunction_rate=0,
    )
    try:
        graph = _director_graph(session.env)
        candidates = candidate_schedules(session.env, graph, max_orders=1)
        assert candidates, "strict PP must preserve a representable full mission"
        result = validate_schedules(session.env, graph, candidates[0][1])
        assert result.accepted, result.to_dict()
        assert result.to_dict()["arrived"] == 16
        assert sum(len(t.served_stops) for t in result.trains) == 48
    finally:
        session_manager.delete(session.id)
