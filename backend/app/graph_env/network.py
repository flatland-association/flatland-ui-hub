"""Load the network JSON written by `scripts/build_graph_env_network.py` into the double vertex graph
`env_factory.create_env` builds a GraphRailEnv on (see docs/plans/graph-env-playground.md)."""
from __future__ import annotations

import json
from pathlib import Path

import networkx as nx
from flatland.envs.rail_env import RailEnvActions

DATA_DIR = Path(__file__).parent / "data"
WALENSEE_NETWORK = DATA_DIR / "walensee.json"

# cf. track_graph.PRIME_SUFFIX / track_node() in flatland-scenarios #36
PRIME_SUFFIX = "_prime"


def track_node(vertex: str) -> int:
    """Track node of the double vertex graph's vertex "x" / "x_prime"."""
    return int(vertex.removesuffix(PRIME_SUFFIX))


def load_network(path: str | Path = WALENSEE_NETWORK) -> nx.DiGraph:
    """The double vertex graph saved at `path`, with `actions` and `prohibited_actions` as sets of `RailEnvActions`
    (as `double_vertex_graph_to_env.add_actions` leaves them). `prohibited_actions` is only set where non-empty, as
    there. Edge `geometry` stays a `[[lat, lon], ...]` list, oriented from u to v."""
    data = json.loads(Path(path).read_text())
    g = nx.node_link_graph(data, directed=True, multigraph=False, edges="edges")
    for _, node_data in g.nodes(data=True):
        prohibited = node_data.pop("prohibited_actions", [])
        if prohibited:
            node_data["prohibited_actions"] = {RailEnvActions(a) for a in prohibited}
    for _, _, edge_data in g.edges(data=True):
        edge_data["actions"] = {RailEnvActions(a) for a in edge_data["actions"]}
    return g
