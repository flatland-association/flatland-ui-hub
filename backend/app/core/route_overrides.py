"""Reroute as a route, not as one action at the next switch.

"Umleiten" used to be the other branch at the first switch on the shortest
path; after that switch the train was handed back to a policy that drove it on
the shortest path again — often straight back into the block. Here a reroute is
a whole route: the shortest way from the train's cell and heading to its
target that avoids every cell a standing (malfunctioning) train occupies. It may
leave the usual path at any switch, but it keeps to the train's own planned
cells wherever it can: the plan has already sorted out which track the train
meets the others on, and the shortest way by distance alone happily runs a
train down the track the oncoming one uses.

On the override channel a reroute is the value `REROUTE_ACTION` (5), next to the
env actions 0–4, so everything that already carries overrides (decision log,
forecast caches, what-ifs) carries it too. `OverridePolicy` turns it into the
route's move every step. The route is fixed when the operator commits it and
kept on the env (`env._route_overrides`), which branch forks copy, so a
forecast follows the same route the live run does.

A drawn route ("Fahrweg einstellen") is a reroute too: the operator chooses the
switches (via cells), `route_through` fills the cells to the target. It is kept
as drawn (`env._route_drawn`): a train that leaves it ends the override instead
of getting a computed route. It may start before the train enters the map.

Plan: docs/plans/set-route-on-map.md.

Plan: docs/plans/proposal-agents-roadmap.md (stage 2e).
"""
from __future__ import annotations

from typing import Dict, List, Optional, Set, Tuple

import networkx as nx
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.step_utils.states import TrainState

from app.planners.replan import build_rail_digraph
from app.policies.goal_based_policies.infrastructure_graph import action_for_move
from app.utils.agent_compat import (
    agent_direction,
    agent_initial_direction,
    agent_initial_position,
    agent_planned_target,
    agent_position,
)

#: Override value for "reroute"; never reaches the env.
REROUTE_ACTION = 5

Node = Tuple[int, int, int]  # (row, col, heading)


def _down_steps(agent) -> int:
    handler = getattr(agent, "malfunction_handler", None)
    return int(getattr(handler, "malfunction_down_counter", 0) or 0)


def blocked_cells(env: RailEnv) -> Set[Tuple[int, int]]:
    """Cells occupied by a train standing with a malfunction."""
    return {
        (int(pos[0]), int(pos[1]))
        for a in env.agents
        if (pos := agent_position(a)) is not None and _down_steps(a) > 0
    }


def _rail_digraph(env: RailEnv) -> nx.DiGraph:
    """The env's transition graph, built once per env (the rail never changes)."""
    graph = getattr(env, "_rail_digraph", None)
    if graph is None:
        graph = build_rail_digraph(env)
        env._rail_digraph = graph
    return graph


#: Cost of entering a cell off the train's planned run, against 1 on it.
OFF_PLAN_COST = 3.0


def _planned_cells(env: RailEnv, handle: int) -> Set[Tuple[int, int]]:
    """Cells of the train's run in the plan the session follows; empty without one."""
    plan = getattr(env, "_route_reference_plan", None) or getattr(env, "_trainrun_plan", None) or {}
    return {
        (int(wp.waypoint.position[0]), int(wp.waypoint.position[1]))
        for wp in plan.get(int(handle), ())
    }


def route_around_blocks(env: RailEnv, handle: int) -> Optional[List[Node]]:
    """Route from the train's cell to its target that avoids blocked cells.

    Cheapest by cells, where a cell off the train's planned run costs
    `OFF_PLAN_COST` — so it leaves the plan only where the block forces it.
    Without a plan that is the plain shortest route. None when the train is not
    on the map, is itself standing, or no such route exists. The route starts
    with the train's current `(row, col, heading)`.
    """
    agent = env.agents[int(handle)]
    a_pos = agent_position(agent)
    if a_pos is None or agent.state == TrainState.DONE or _down_steps(agent) > 0:
        return None
    blocked = blocked_cells(env)
    target = (int(agent_planned_target(agent)[0]), int(agent_planned_target(agent)[1]))
    if target in blocked:
        return None

    graph = _rail_digraph(env)
    start: Node = (int(a_pos[0]), int(a_pos[1]), int(agent_direction(agent)))
    if start not in graph:
        return None
    view = nx.subgraph_view(graph, filter_node=lambda n: n == start or (n[0], n[1]) not in blocked)
    planned = _planned_cells(env, handle)

    def cost(_u, v, _data) -> float:
        return 1.0 if not planned or (v[0], v[1]) in planned else OFF_PLAN_COST

    lengths, paths = nx.single_source_dijkstra(view, start, weight=cost)
    ends = [(target[0], target[1], h) for h in range(4) if (target[0], target[1], h) in paths]
    if not ends:
        return None
    best = min(ends, key=lambda n: lengths[n])
    return [tuple(int(v) for v in node) for node in paths[best]]


#: States in which a train waits at its origin, off the map.
_OFF_MAP_WAITING = (TrainState.WAITING, TrainState.READY_TO_DEPART, TrainState.MALFUNCTION_OFF_MAP)


def _start_node(agent) -> Optional[Node]:
    """The train's cell and heading, or its origin's while it waits off the map."""
    pos = agent_position(agent)
    if pos is not None:
        return int(pos[0]), int(pos[1]), int(agent_direction(agent))
    if agent.state in _OFF_MAP_WAITING:
        origin, heading = agent_initial_position(agent), agent_initial_direction(agent)
        if origin is not None and heading is not None:
            return int(origin[0]), int(origin[1]), int(heading)
    return None


def route_through(env: RailEnv, handle: int, via: List[Tuple[int, int]]) -> Optional[List[Node]]:
    """Route from the train's cell and heading through `via`, in order, to its target.

    Each leg is the shortest path in the rail graph to any heading in the next
    via cell; after the last one the route goes on by the shortest path to the
    target. A train waiting at its origin starts there. None when the train is
    done or a leg has no path. Blocked cells are not avoided: the operator chose
    the switches.
    """
    agent = env.agents[int(handle)]
    if agent.state == TrainState.DONE:
        return None
    start = _start_node(agent)
    graph = _rail_digraph(env)
    if start is None or start not in graph:
        return None
    target = (int(agent_planned_target(agent)[0]), int(agent_planned_target(agent)[1]))
    route: List[Node] = [start]
    for cell in [tuple(int(v) for v in c) for c in via] + [target]:
        if (route[-1][0], route[-1][1]) == cell:
            continue
        lengths = nx.single_source_shortest_path_length(graph, route[-1])
        ends = [(cell[0], cell[1], h) for h in range(4) if (cell[0], cell[1], h) in lengths]
        if not ends:
            return None
        best = min(ends, key=lambda n: lengths[n])
        leg = nx.shortest_path(graph, route[-1], best)
        route.extend(tuple(int(v) for v in node) for node in leg[1:])
    return route


def first_switch_move(env: RailEnv, route: List[Node]) -> Tuple[Optional[int], Optional[Tuple[int, int]]]:
    """The route's move at its first cell with a choice, and that cell.

    What a one-switch view of the reroute would show (the Trains table stars the
    option the route takes there). (None, None) when the route passes no switch.
    """
    graph = _rail_digraph(env)
    for node, nxt in zip(route, route[1:]):
        if graph.out_degree(node) > 1:
            return int(action_for_move(node[2], nxt[2])), (node[0], node[1])
    return None, None


# ── the committed route, kept on the env ─────────────────────────────────────

def _routes(env: RailEnv) -> Dict[int, List[Node]]:
    routes = getattr(env, "_route_overrides", None)
    if routes is None:
        routes = {}
        env._route_overrides = routes
    return routes


def _drawn(env: RailEnv) -> Set[int]:
    drawn = getattr(env, "_route_drawn", None)
    if drawn is None:
        drawn = set()
        env._route_drawn = drawn
    return drawn


def commit_route(env: RailEnv, handle: int, via: Optional[List[Tuple[int, int]]] = None) -> Optional[List[Node]]:
    """Fix the route for `handle`; None if there is none.

    Without `via` the route around the current blocks; with `via` the route the
    operator drew through those cells (`route_through`), kept as drawn.
    """
    route = route_through(env, handle, via) if via else route_around_blocks(env, handle)
    if route is not None:
        _routes(env)[int(handle)] = route
        if via:
            _drawn(env).add(int(handle))
        else:
            _drawn(env).discard(int(handle))
    return route


def carry_to_fork(source: RailEnv, target: RailEnv) -> None:
    """Carry committed routes, and the plan routes are drawn against, to a fork.

    The plan goes under its own name: a fork with `_trainrun_plan` set would
    change which policy the registry builds for it.
    """
    routes = getattr(source, "_route_overrides", None)
    if routes:
        target._route_overrides = {h: list(r) for h, r in routes.items()}
    drawn = getattr(source, "_route_drawn", None)
    if drawn:
        target._route_drawn = set(drawn)
    plan = getattr(source, "_route_reference_plan", None) or getattr(source, "_trainrun_plan", None)
    if plan:
        target._route_reference_plan = plan


def route_move(env: RailEnv, handle: int) -> Optional[RailEnvActions]:
    """The action that keeps `handle` on its reroute this step.

    Follows the committed route. When there is none, or the train is not on it
    (a route left over from an earlier reroute, or a what-if proposing a new one
    on a fork), the route is committed afresh from here — except a drawn route,
    which is not replaced. A train waiting at the origin of its route enters.
    None when the reroute is over or impossible — the train arrived, left its
    drawn route, or no way around the blocks exists — and the caller then
    clears the override.
    """
    agent = env.agents[int(handle)]
    a_pos = agent_position(agent)
    route = _routes(env).get(int(handle))
    if agent.state == TrainState.DONE:
        return None
    if a_pos is None:
        start = _start_node(agent)
        if route and start is not None and route[0] == start:
            return RailEnvActions.MOVE_FORWARD
        return None
    here = (int(a_pos[0]), int(a_pos[1]), int(agent_direction(agent)))
    if not route or here not in route:
        if int(handle) in _drawn(env):
            return None
        route = commit_route(env, handle)
        if not route:
            return None
    index = route.index(here)
    if index >= len(route) - 1:
        return RailEnvActions.MOVE_FORWARD
    return RailEnvActions(action_for_move(here[2], route[index + 1][2]))


def drop_route(env: RailEnv, handle: int) -> None:
    _routes(env).pop(int(handle), None)
    _drawn(env).discard(int(handle))
