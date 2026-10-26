# Copied from flatland-scenarios PR #36, osmnx_graph_import/double_vertex_graph_to_env.py at commit
# c2bc7b4093fea07c8bb62fd47f94ceaa6397e44f (branch feature/osmnx-to-graph-import). Adapted in the following commits;
# see docs/plans/graph-env-playground.md.

"""Create a GraphRailEnv from a double vertex graph (see `track_graph.build_double_vertex_graph`): rail env actions on
its edges, a resource map and a timetable for a single train from a source to a target vertex - plus a shortest-path
policy to run it.

TODO depend on flatland-rl main, and finally a released version, once branch 526-edge-lengths (edge lengths,
`GraphRailEnv.from_graph`) is merged and released - for now it requires that branch.
"""
import math
import shutil
from fractions import Fraction
from pathlib import Path
from typing import List

import networkx as nx
import osmnx as ox
from flatland.envs import malfunction_generators as mal_gen
from flatland.envs.agent_utils import EnvAgent
from flatland.envs.graph_rail_env import GraphRailEnv
from flatland.envs.observations import FullEnvObservation
from flatland.envs.rail_env import RailEnvActions
from flatland.envs.rail_env_policy import RailEnvPolicy
from flatland.envs.rewards import DefaultRewards
from flatland.envs.step_utils.states import TrainState
from flatland.envs.timetable_utils import Timetable
from flatland.trajectories.policy_runner import PolicyRunner
from flatland.trajectories.trajectories import Trajectory

from switch_geometry import legs_from_geometry, switch_legs
from track_graph import track_node


def add_actions(double_vertex_graph: nx.DiGraph, track_graph: nx.DiGraph) -> None:
    """Add rail env actions to `double_vertex_graph` (in place), such that at every vertex, each rail env action is
    either prohibited or in the actions of exactly one outgoing edge (cf. `GraphTransitionMap._assert_actions_partitioned()`):

    * at a dead end, all actions are prohibited (`prohibited_actions` vertex attribute);
    * a single outgoing edge (non-switch, or switch passed from a leg into its point) gets all actions;
    * at a switch passed from its point into its two legs (see `switch_geometry.legs_from_geometry`), the diverging leg
      gets MOVE_RIGHT (right switch) or MOVE_LEFT (left switch) and the forward leg all other actions (see
      `switch_geometry.switch_legs`).

    `track_graph` is the track graph `double_vertex_graph` was built from.
    """
    track_graph_proj = ox.projection.project_graph(nx.MultiDiGraph(track_graph))
    undirected = track_graph.to_undirected()
    for v in double_vertex_graph.nodes:
        successors = list(double_vertex_graph.successors(v))
        if len(successors) == 0:
            double_vertex_graph.nodes[v]["prohibited_actions"] = set(RailEnvActions)
            continue
        if len(successors) == 1:
            double_vertex_graph.edges[v, successors[0]]["actions"] = set(RailEnvActions)
            continue
        switch = track_node(v)
        legs = {track_node(leg): leg for leg in successors}
        assert set(legs) == set(legs_from_geometry(track_graph_proj, switch)), (
            f"outgoing edges of switch {v} don't lead to its legs"
        )
        (point,) = set(undirected.neighbors(switch)) - set(legs)
        forward, diverging, diverges_right = switch_legs(track_graph_proj, switch, point)
        turn = RailEnvActions.MOVE_RIGHT if diverges_right else RailEnvActions.MOVE_LEFT
        double_vertex_graph.edges[v, legs[forward]]["actions"] = set(RailEnvActions) - {turn}
        double_vertex_graph.edges[v, legs[diverging]]["actions"] = {turn}


def resource_map(double_vertex_graph: nx.DiGraph) -> dict[str, str]:
    """One resource per track node: both vertices of a track node are the same place on the tracks."""
    return {v: str(track_node(v)) for v in double_vertex_graph.nodes}


def rational_lengths(double_vertex_graph: nx.DiGraph) -> nx.DiGraph:
    """Copy of `double_vertex_graph` with its float edge lengths (osmnx's `length`, in metres) as Fractions, in
    millimetres precision - GraphRailEnv only accepts int or Fraction edge lengths."""
    g = double_vertex_graph.copy()
    for _, _, data in g.edges(data=True):
        if isinstance(data.get("length"), float):
            data["length"] = Fraction(data["length"]).limit_denominator(1000)
    return g


def create_env(
    double_vertex_graph: nx.DiGraph,
    track_graph: nx.DiGraph,
    source: str,
    target: str,
    speed: float = 1,
    latest_arrival: int | None = None,
    max_episode_steps: int | None = None,
    seed: int = 42,
) -> GraphRailEnv:
    """GraphRailEnv on `double_vertex_graph` (see `add_actions` and `resource_map`) with a single train from vertex
    `source` to vertex `target` at `speed`, departing at step 0.

    Edge lengths are taken as they are (osmnx's `length`: metres), so the train needs roughly the shortest path's
    length / `speed` steps. `latest_arrival` defaults to twice that, `max_episode_steps` to `latest_arrival` plus that.
    The observations are the env itself (`FullEnvObservation`), as needed by `GraphShortestPathPolicy`.

    N.B. `target` must not be a dead end (a vertex without outgoing edge): when entering an edge, GraphRailEnv needs the
    entry point after its end, and fails an assertion in `step()` otherwise - pick the dead end's other vertex instead.
    """
    g = rational_lengths(double_vertex_graph)
    add_actions(g, track_graph)
    if not nx.has_path(g, source, target):
        raise ValueError(f"no directed path {source} -> {target}")
    if g.out_degree(target) == 0:
        raise ValueError(f"target {target} is a dead end (no outgoing edge), GraphRailEnv can't end there")
    travel_steps = math.ceil(nx.shortest_path_length(g, source, target, weight="length") / speed)
    if latest_arrival is None:
        latest_arrival = 2 * travel_steps
    if max_episode_steps is None:
        max_episode_steps = latest_arrival + travel_steps
    timetable = Timetable(
        earliest_departures=[[0, None]],
        latest_arrivals=[[None, latest_arrival]],
        max_episode_steps=max_episode_steps,
    )
    env = GraphRailEnv.from_graph(
        g=g,
        resource_map=resource_map(g),
        agent_waypoints={0: [[source], [target]]},
        agent_speeds={0: speed},
        observation_builder=FullEnvObservation(),
        malfunction_generator=mal_gen.NoMalfunctionGen(),
        timetable_generator=lambda *args, **kwargs: timetable,
        seed=seed,
        rewards=DefaultRewards(),
    )
    env.rail._assert_actions_partitioned()
    return env


class GraphShortestPathPolicy(RailEnvPolicy[GraphRailEnv, GraphRailEnv, RailEnvActions]):
    """Follow the shortest path (in number of edges) in `env.rail.g` from the agent's
    initial entry point to its first reachable target - cf. `ShortestPathPolicy` in
    flatland/envs/rail_env_policies.py, but on the graph instead of the grid.
    Needs `FullEnvObservation` (observations are the env itself)."""

    def __init__(self):
        super().__init__()
        self._shortest_paths = {}

    def _act(self, env: GraphRailEnv, agent: EnvAgent):
        if len(self._shortest_paths[agent.handle]) <= 1:
            return RailEnvActions.DO_NOTHING

        if agent.current_entry_point is None:
            # actions are applied at cell entry: the action entering the map already decides
            # the transition out of the initial entry point (a switch, possibly)
            lookahead_from = agent.initial_entry_point
            target_index = 1
        else:
            # once agent.next_entry_point holds a pending target (decided one step ago), this
            # step's action decides the look-ahead beyond it, so evaluate from
            # next_entry_point against the node after it
            has_pending_target = agent.next_entry_point is not None and agent.next_entry_point != agent.current_entry_point
            lookahead_from = agent.next_entry_point if has_pending_target else agent.current_entry_point
            target_index = 2 if has_pending_target else 1
        if target_index >= len(self._shortest_paths[agent.handle]):
            return RailEnvActions.MOVE_FORWARD

        next_entry_point = self._shortest_paths[agent.handle][target_index]
        for a in [RailEnvActions.MOVE_FORWARD, RailEnvActions.MOVE_LEFT, RailEnvActions.MOVE_RIGHT]:
            if env.rail.apply_action_independent(a, lookahead_from) == next_entry_point:
                return a
        raise Exception(f"Invalid state: no action leads from {lookahead_from} to {next_entry_point}")

    def act_many(self, handles: List[int], observations: List[GraphRailEnv], **kwargs):
        actions = {}
        for handle, env in zip(handles, observations):
            agent = env.agents[handle]
            self._update_agent(agent, env)
            actions[handle] = self._act(env, agent)
        return actions

    def _update_agent(self, agent: EnvAgent, env: GraphRailEnv):
        """
        Update `_shortest_paths`.
        """
        if agent.state == TrainState.DONE:
            self._shortest_paths.pop(agent.handle, None)
            return

        if agent.handle not in self._shortest_paths:
            p = [agent.waypoints[0][0]]
            for pp2 in agent.waypoints[1:]:
                p_next = None
                for p2 in pp2:
                    if nx.has_path(env.rail.g, p[-1], p2):
                        p_next = nx.shortest_path(env.rail.g, p[-1], p2)[1:]
                        break
                assert p_next is not None, f"Not found next path from {p[-1]} to any of {pp2}, agent.waypoints={agent.waypoints}"
                p += p_next
            self._shortest_paths[agent.handle] = p

        if agent.current_entry_point is None:
            return

        while self._shortest_paths[agent.handle][0] != agent.current_entry_point:
            self._shortest_paths[agent.handle] = self._shortest_paths[agent.handle][1:]


def run_shortest_path_policy(env: GraphRailEnv, data_dir: Path) -> Trajectory:
    """Run `GraphShortestPathPolicy` on `env` until done, recording the trajectory in `data_dir`."""
    # start from an empty dir: flatland can't read back graph positions from an existing
    # trajectory (pandas parses node ids like 2042222934 as floats, which
    # normalize_position_read() can't literal_eval)
    shutil.rmtree(data_dir, ignore_errors=True)
    # GraphRailEnv does not support env persistence yet - hence no_save/no snapshots
    return PolicyRunner.create_from_policy(
        env=env,
        policy=GraphShortestPathPolicy(),
        data_dir=data_dir,
        no_save=True,
        snapshot_interval=0,
    )
