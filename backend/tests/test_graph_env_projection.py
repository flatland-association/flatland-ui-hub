"""Graph env playground: trains are placed on the edge geometry, with their remaining route and target."""
import pytest

from app.graph_env.env_factory import TARGET
from app.graph_env.projection import bearing, haversine, network_json, split_polyline, state_json
from app.graph_env.service import GraphEnvSession

LINE = [[47.0, 9.0], [47.0, 9.001], [47.001, 9.001]]  # east, then north


def test_haversine_and_bearing():
    assert haversine([47.0, 9.0], [47.001, 9.0]) == pytest.approx(111.2, abs=0.1)
    assert bearing([47.0, 9.0], [47.001, 9.0]) == pytest.approx(0)
    assert bearing([47.0, 9.0], [47.0, 9.001]) == pytest.approx(90, abs=0.01)
    assert bearing([47.0, 9.0], [46.999, 9.0]) == pytest.approx(180)


def test_split_polyline_ends():
    point, heading, rest = split_polyline(LINE, 0)
    assert point == LINE[0]
    assert heading == pytest.approx(90, abs=0.01)
    assert rest == LINE

    point, heading, rest = split_polyline(LINE, 1)
    assert point == pytest.approx(LINE[-1])
    assert heading == pytest.approx(0)
    assert rest[-1] == LINE[-1]


def test_split_polyline_follows_the_bend():
    first, second = haversine(LINE[0], LINE[1]), haversine(LINE[1], LINE[2])
    fraction = (first + second / 2) / (first + second)  # halfway along the northbound segment

    point, heading, rest = split_polyline(LINE, fraction)

    assert point == pytest.approx([47.0005, 9.001], abs=1e-6)
    assert heading == pytest.approx(0)
    assert rest == [point, LINE[2]]


def test_split_polyline_straight_line_and_clamping():
    straight = [[47.0, 9.0], [47.0, 9.002]]
    assert split_polyline(straight, 0.5)[0] == pytest.approx([47.0, 9.001])
    assert split_polyline(straight, 1.5)[0] == pytest.approx(straight[1])
    assert split_polyline(straight, -1)[0] == pytest.approx(straight[0])


def test_network_json_draws_each_track_once():
    session = GraphEnvSession("s")

    network = network_json(session.env.rail.g)

    assert len(network["tracks"]) == session.env.rail.g.number_of_edges() // 2
    assert len(network["nodes"]) == session.env.rail.g.number_of_nodes() // 2
    (south, west), (north, east) = network["bounds"]
    assert all(south <= n["lat"] <= north and west <= n["lon"] <= east for n in network["nodes"])


def test_state_before_departure_on_the_way_and_done():
    session = GraphEnvSession("s")
    g = session.env.rail.g
    target = [g.nodes[TARGET]["y"], g.nodes[TARGET]["x"]]

    agent = state_json(session.env, session.policy, session.done)["agents"][0]
    assert agent["lat"] is None and agent["edge"] is None
    assert agent["target"] == target
    full_route = len(agent["remaining_path"])
    assert full_route > 0

    session.step(30)
    state = state_json(session.env, session.policy, session.done)
    agent = state["agents"][0]
    assert state["step"] == 30 and not state["done"]
    u, v = agent["edge"]
    assert 0 <= agent["fraction"] <= 1
    # the route starts at the train and runs on from the end of its current edge
    assert agent["remaining_path"][0][0] == [agent["lat"], agent["lon"]]
    assert agent["remaining_path"][0][-1] == g.edges[u, v]["geometry"][-1]
    assert len(agent["remaining_path"]) < full_route
    for a, b in zip(agent["remaining_path"], agent["remaining_path"][1:]):
        assert a[-1] == b[0]
    assert agent["remaining_path"][-1][-1] == target

    session.step(10_000)
    state = state_json(session.env, session.policy, session.done)
    agent = state["agents"][0]
    assert state["done"]
    assert agent["state"] == "DONE"
    assert agent["lat"] is None and agent["remaining_path"] == []
