#!/usr/bin/env python
"""Convert a track graph (GraphML) into the network JSON of the graph env playground.

Step 1 of docs/plans/graph-env-playground.md: the backend reads only the JSON, so osmnx, geopandas and shapely are
not runtime dependencies. This script needs them, plus a checkout of flatland-scenarios PR #36 for its import
pipeline (`track_graph`, `double_vertex_graph_to_env`):

    git clone https://github.com/flatland-association/flatland-scenarios.git
    git -C flatland-scenarios checkout c2bc7b4093fea07c8bb62fd47f94ceaa6397e44f
    pip install osmnx "flatland-rl @ git+https://github.com/flatland-association/flatland-rl@be8cd30543"

    cd backend
    python scripts/build_graph_env_network.py \\
        --scenarios ../flatland-scenarios/osmnx_graph_import \\
        --graphml app/graph_env/data/walensee.graphml \\
        --out app/graph_env/data/walensee.json

It loads the track graph (`load_track_graph`), builds the double vertex graph (`build_double_vertex_graph`) and adds
the rail env actions (`add_actions`), as `create_env` does. The output is networkx node-link data:

* nodes: `x`, `y` (lon, lat), `is_switch` (track node with in+out degree > 2), `prohibited_actions` (`RailEnvActions` values);
* edges: `length` (metres), `actions` (`RailEnvActions` values), `geometry` (`[[lat, lon], ...]`, oriented from u to v).

`build_double_vertex_graph` copies each track's geometry onto both of its directed edges, in the OSM way's drawing
direction - it is reversed here where it does not start at u. An edge without geometry becomes the straight line u, v.
The output is deterministic (sorted, rounded), so regenerating from the same inputs gives the same file.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

COORDINATE_DIGITS = 7  # ~1 cm


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Planar distance between two (lon, lat) points - only used to compare which end is closer."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


def oriented_geometry(coords: list[tuple[float, float]], u_xy: tuple[float, float],
                      v_xy: tuple[float, float]) -> list[tuple[float, float]]:
    """`coords` ((lon, lat) points) oriented from u to v: reversed if its last point is closer to u than its first."""
    if _distance(coords[0], u_xy) + _distance(coords[-1], v_xy) > _distance(coords[-1], u_xy) + _distance(coords[0], v_xy):
        return list(reversed(coords))
    return list(coords)


def network_json(double_vertex_graph, track_graph, switches: set[int], track_node) -> dict:
    """Node-link data of `double_vertex_graph` (with actions added) as described in the module docstring."""
    def xy(vertex: str) -> tuple[float, float]:
        data = double_vertex_graph.nodes[vertex]
        return float(data["x"]), float(data["y"])

    nodes = []
    for vertex in sorted(double_vertex_graph.nodes):
        lon, lat = xy(vertex)
        nodes.append({
            "id": vertex,
            "x": round(lon, COORDINATE_DIGITS),
            "y": round(lat, COORDINATE_DIGITS),
            "is_switch": track_node(vertex) in switches,
            "prohibited_actions": sorted(a.value for a in double_vertex_graph.nodes[vertex].get("prohibited_actions", ())),
        })

    edges = []
    for u, v in sorted(double_vertex_graph.edges):
        data = double_vertex_graph.edges[u, v]
        geometry = data.get("geometry")
        coords = [tuple(map(float, c)) for c in geometry.coords] if geometry is not None else [xy(u), xy(v)]
        coords = oriented_geometry(coords, xy(u), xy(v))
        edges.append({
            "source": u,
            "target": v,
            "length": float(data["length"]),
            "actions": sorted(a.value for a in data.get("actions", ())),
            "geometry": [[round(lat, COORDINATE_DIGITS), round(lon, COORDINATE_DIGITS)] for lon, lat in coords],
        })

    return {
        "directed": True,
        "multigraph": False,
        "graph": {"crs": str(track_graph.graph.get("crs", ""))},
        "nodes": nodes,
        "edges": edges,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--scenarios", type=Path, required=True,
                        help="flatland-scenarios checkout's osmnx_graph_import directory")
    parser.add_argument("--graphml", type=Path, required=True, help="track graph (GraphML)")
    parser.add_argument("--out", type=Path, required=True, help="network JSON to write")
    args = parser.parse_args()

    sys.path.insert(0, str(args.scenarios.resolve()))
    from double_vertex_graph_to_env import add_actions  # noqa: E402  (from the scenarios checkout)
    from osm_to_track_graph import true_switches  # noqa: E402
    from track_graph import build_double_vertex_graph, load_track_graph, track_node  # noqa: E402

    track_graph = load_track_graph(args.graphml)
    double_vertex_graph = build_double_vertex_graph(track_graph)
    add_actions(double_vertex_graph, track_graph)

    data = network_json(double_vertex_graph, track_graph, true_switches(track_graph), track_node)
    args.out.write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")
    print(f"wrote {args.out}: {len(data['nodes'])} vertices, {len(data['edges'])} edges")


if __name__ == "__main__":
    main()
