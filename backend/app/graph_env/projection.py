"""Graph env playground: the static network and the env state as JSON for the map (docs/plans/graph-env-playground.md
§2, §3).

A train on edge (u, v) is placed at `speed_counter.distance / speed_counter.edge_length` of the way along the edge's
geometry (cf. the notebook's `train_location`, which uses the straight line from u to v instead). Edge geometries are
`[[lat, lon], ...]` lists oriented from u to v (see `scripts/build_graph_env_network.py`).
"""
from __future__ import annotations

import math
from typing import Any

import networkx as nx
from flatland.envs.agent_utils import EnvAgent
from flatland.envs.graph_rail_env import GraphRailEnv
from flatland.envs.step_utils.states import TrainState

from app.graph_env.env_factory import GraphShortestPathPolicy
from app.graph_env.network import track_node

LatLon = list[float]  # [lat, lon]

EARTH_RADIUS_M = 6_371_000


def haversine(a: LatLon, b: LatLon) -> float:
    """Great-circle distance between `a` and `b` in metres."""
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def bearing(a: LatLon, b: LatLon) -> float:
    """Initial bearing from `a` to `b` in degrees clockwise from north, in [0, 360)."""
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    y = math.sin(lon2 - lon1) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lon2 - lon1)
    return math.degrees(math.atan2(y, x)) % 360


def split_polyline(coords: list[LatLon], fraction: float) -> tuple[LatLon, float, list[LatLon]]:
    """The point at `fraction` (clamped to [0, 1]) of the polyline's length, the bearing of the segment it lies on,
    and the rest of the polyline from that point to its end."""
    fraction = min(1.0, max(0.0, fraction))
    segments = list(zip(coords, coords[1:]))
    lengths = [haversine(a, b) for a, b in segments]
    remaining = fraction * sum(lengths)
    for i, ((a, b), length) in enumerate(zip(segments, lengths)):
        if remaining <= length or i == len(segments) - 1:
            t = 0.0 if length == 0 else min(1.0, remaining / length)
            point = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
            return point, bearing(a, b), [point, *coords[i + 1:]]
        remaining -= length
    raise ValueError("polyline needs at least two points")


def _location(g: nx.DiGraph, vertex: str) -> LatLon:
    return [g.nodes[vertex]["y"], g.nodes[vertex]["x"]]


def network_json(g: nx.DiGraph) -> dict[str, Any]:
    """Tracks (one polyline per track - a vertex edge and its dual share it), track nodes and bounds of `g`."""
    tracks: dict[frozenset, list[LatLon]] = {}
    for u, v, geometry in g.edges(data="geometry"):
        tracks.setdefault(frozenset((track_node(u), track_node(v))), geometry)
    nodes: dict[int, dict[str, Any]] = {}
    for vertex, data in g.nodes(data=True):
        nodes.setdefault(track_node(vertex), {"id": str(track_node(vertex)), "lat": data["y"], "lon": data["x"],
                                              "is_switch": data["is_switch"]})
    lats = [n["lat"] for n in nodes.values()]
    lons = [n["lon"] for n in nodes.values()]
    return {
        "tracks": list(tracks.values()),
        "nodes": list(nodes.values()),
        "bounds": [[min(lats), min(lons)], [max(lats), max(lons)]],
    }


def _planned_path(g: nx.DiGraph, policy: GraphShortestPathPolicy, agent: EnvAgent) -> list[str]:
    """The policy's remaining vertices for `agent` from its current (else initial) entry point on - the policy trims
    its path only on its next `act_many()`, so it may still start before the current entry point."""
    path = policy._shortest_paths.get(agent.handle)
    start = agent.current_entry_point or agent.initial_entry_point
    if not path or start not in path:
        path = nx.shortest_path(g, agent.initial_entry_point, agent.waypoints[-1][0])
    return path[path.index(start):]


def agent_json(env: GraphRailEnv, policy: GraphShortestPathPolicy, agent: EnvAgent) -> dict[str, Any]:
    """Position, bearing, remaining route (one polyline per edge) and target of `agent`; position, edge and bearing
    None while it is off the map (not yet departed, or arrived)."""
    g = env.rail.g
    u, v = agent.current_entry_point, agent.next_entry_point
    result: dict[str, Any] = {
        "handle": agent.handle,
        "state": agent.state.name,
        "edge": None,
        "fraction": None,
        "lat": None,
        "lon": None,
        "bearing": None,
        "remaining_path": [],
        "target": _location(g, agent.waypoints[-1][0]),
    }
    if agent.state == TrainState.DONE:
        return result

    path = _planned_path(g, policy, agent)
    remaining = [g.edges[a, b]["geometry"] for a, b in zip(path, path[1:])]
    if u is not None:
        if v is None or agent.speed_counter.distance is None:
            result["lat"], result["lon"] = _location(g, u)
        else:
            fraction = float(agent.speed_counter.distance / agent.speed_counter.edge_length)
            point, heading, rest = split_polyline(g.edges[u, v]["geometry"], fraction)
            result.update(edge=[u, v], fraction=fraction, lat=point[0], lon=point[1], bearing=heading)
            if path[1:2] == [v]:
                remaining[0] = rest
    result["remaining_path"] = remaining
    return result


def state_json(env: GraphRailEnv, policy: GraphShortestPathPolicy, done: bool) -> dict[str, Any]:
    return {
        "step": env._elapsed_steps,
        "max_episode_steps": env._max_episode_steps,
        "done": done,
        "agents": [agent_json(env, policy, agent) for agent in env.agents],
    }
