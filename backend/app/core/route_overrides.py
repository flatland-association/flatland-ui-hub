"""Reroute as a route, not as one action at the next switch.

"Umleiten" used to be the other branch at the first switch on the shortest
path; after that switch the train was handed back to a policy that drove it on
the shortest path again — often straight back into the block. Here a reroute is
a whole route: the shortest way from the train's cell and heading to its
target that avoids every cell a standing (malfunctioning) train occupies. It may
leave the usual path at any switch, and it calls at the train's remaining
intermediate stops on the way, standing at each (stage 2f). It keeps to the train's own planned
cells wherever it can: the plan has already sorted out which track the train
meets the others on, and the shortest way by distance alone happily runs a
train down the track the oncoming one uses.

On the override channel a reroute is the value `REROUTE_ACTION` (5), next to the
env actions 0–4, so everything that already carries overrides (decision log,
forecast caches, what-ifs) carries it too. `OverridePolicy` turns it into the
route's move every step. The route is fixed when the operator commits it and
kept on the env (`env._route_overrides`), which branch forks copy, so a
forecast follows the same route the live run does.

The route is timed where the course is known (stage 2g): the other trains'
cells per step come from one branch run with the rerouted train held, and the
train is planned against them with the replan's own solver
(`replan.plan_train_against`), waiting where it has to. The committed route
then keeps the step each cell is due (`env._route_times`), and `route_move`
holds the train until its next cell is due. Without a course to forecast from,
or when the timed search finds nothing, the untimed route above is committed.

A drawn route ("Fahrweg einstellen") is a reroute too: the operator chooses the
switches (via cells), `route_through` fills the cells to the target. It is kept
as drawn (`env._route_drawn`): a train that leaves it ends the override instead
of getting a computed route. It may start before the train enters the map.

Plans: docs/plans/proposal-agents-roadmap.md (stages 2e, 2g),
docs/plans/set-route-on-map.md.
"""
from __future__ import annotations

from typing import Callable, Dict, List, Optional, Set, Tuple

import networkx as nx
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.step_utils.states import TrainState

from app.core.stops import intermediate_stops, is_ahead, remaining_stops
from app.planners.replan import build_rail_digraph, plan_train_against
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


def _cell_cost(env: RailEnv, handle: int) -> Callable[[Tuple[int, int]], float]:
    """Cost of entering a cell: 1 on the train's planned run (or without a plan),
    `OFF_PLAN_COST` off it."""
    planned = _planned_cells(env, handle)
    return lambda cell: 1.0 if not planned or cell in planned else OFF_PLAN_COST


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
    cell_cost = _cell_cost(env, handle)

    def cost(_u, v, _data) -> float:
        return cell_cost((v[0], v[1]))

    targets = [(target[0], target[1], h) for h in range(4)]

    def cheapest(lengths: dict, goals) -> Optional[Node]:
        reached = [g for g in goals if g in lengths]
        return min(reached, key=lambda n: lengths[n]) if reached else None

    # Through each remaining stop that is still on the way, then to the target.
    route: List[Node] = [start]
    node = start
    for stop in remaining_stops(env, handle):
        lengths, paths = nx.single_source_dijkstra(view, node, weight=cost)
        goal = cheapest(lengths, [
            n for r, c, d in stop.alternatives for n in ((r, c, h) for h in range(4))
            if d is None or n[2] == d
        ])
        if goal is None:
            continue  # behind a block, or behind the train
        on, _ = nx.single_source_dijkstra(view, goal, weight=cost)
        end_via, end_direct = cheapest(on, targets), cheapest(lengths, targets)
        inf = float("inf")
        if not is_ahead(lengths[goal], on.get(end_via, inf) if end_via else inf,
                        lengths.get(end_direct, inf) if end_direct else inf):
            continue  # passed already: only a turn at a dead end leads back
        route += paths[goal][1:]
        node = goal

    lengths, paths = nx.single_source_dijkstra(view, node, weight=cost)
    end = cheapest(lengths, targets)
    if end is None:
        return None
    route += paths[end][1:]
    return [tuple(int(v) for v in n) for n in route]


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


class LeftDrawnRoute(Exception):
    """The train is no longer on the route the operator drew: it moved on past a
    drawn switch, or onto another branch, while the operator was drawing or
    comparing."""


def route_through(
    env: RailEnv,
    handle: int,
    via: List[Tuple[int, int]],
    start: Optional[Node] = None,
) -> Optional[List[Node]]:
    """Route through `via`, in order, to the train's target.

    Each leg is the shortest path in the rail graph to any heading in the next
    via cell; after the last one the route goes on by the shortest path to the
    target. None when the train is done or a leg has no path. Blocked cells are
    not avoided: the operator chose the switches.

    Without `start` the route begins at the train's cell and heading (its
    origin while it waits off the map). With `start`, the cell and heading the
    drawing began at, it is the line the operator drew, cut where the train is
    now; `LeftDrawnRoute` when the train is no longer on it. The clock runs
    while the operator draws and compares, so the train may have moved on: a
    route rebuilt from its new cell would have to find its way back to the via
    cells, through a detour nobody drew.
    """
    agent = env.agents[int(handle)]
    if agent.state == TrainState.DONE:
        return None
    here = _start_node(agent)
    origin = tuple(int(v) for v in start) if start is not None else here
    graph = _rail_digraph(env)
    if here is None or origin not in graph:
        return None
    target = (int(agent_planned_target(agent)[0]), int(agent_planned_target(agent)[1]))
    route: List[Node] = [origin]
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
    if start is not None:
        if here not in route:
            raise LeftDrawnRoute(f"Train {handle} has left the drawn route")
        route = route[route.index(here):]
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


# ── timing against the other trains' forecast (stage 2g) ────────────────────

PolicyFactory = Callable[[], object]
Candidate = Tuple[List[Node], Optional[List[int]]]  # route, step each cell is due

#: Steps a candidate route is simulated for; after that nothing is reserved.
FORECAST_HORIZON = 250
#: Timed plans at most per reroute: each is planned against what the others did
#: on the previous one, so the others' reaction to the moving train counts.
TIMED_ROUNDS = 3


def _simulate(
    env: RailEnv, handle: int, policy_factory: PolicyFactory,
    overrides: Optional[Dict[int, int]], candidate: Optional[Candidate],
):
    """One branch run of the course with `handle` on `candidate`, or held where
    it is when there is none. Returns the result and the other trains' cells
    per step from now.

    The candidate is put on the env for the fork to carry and taken off again.
    The fork does not time reroutes of its own (`timed_routes=False`), so this
    never nests.
    """
    from app.core.scenario_runner import TrajectoryBranchRunner

    h = int(handle)
    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    max_steps = int(getattr(env, "_max_episode_steps", 0) or 0)
    horizon = min(max(1, max_steps - now) if max_steps else FORECAST_HORIZON, FORECAST_HORIZON)
    course = {int(o): int(a) for o, a in (overrides or {}).items() if int(o) != h}
    course[h] = REROUTE_ACTION if candidate else RailEnvActions.STOP_MOVING.value

    routes, times = _routes(env), _times(env)
    saved = routes.get(h), times.get(h)
    if candidate:
        routes[h] = candidate[0]
        if candidate[1]:
            times[h] = candidate[1]
        else:
            times.pop(h, None)
    try:
        res = TrajectoryBranchRunner(env, policy_factory, timed_routes=False).run_branch(
            overrides=course, max_steps=horizon, detect_deadlocks=False,
        )
    finally:
        for table, value in zip((routes, times), saved):
            if value is None:
                table.pop(h, None)
            else:
                table[h] = value

    cells: Dict[int, List[Tuple[Tuple[int, int], int]]] = {}
    for a in env.agents:
        pos = agent_position(a)
        if int(a.handle) != h and pos is not None:
            cells.setdefault(int(a.handle), []).append(((int(pos[0]), int(pos[1])), 0))
    for snap in res.snapshots:
        t = int(snap["step"]) - now
        for other, state in snap["agents"].items():
            if int(other) != h and state.get("pos") is not None:
                cells.setdefault(int(other), []).append(((int(state["pos"][0]), int(state["pos"][1])), t))
    return res, cells


def _timed(env: RailEnv, path: List[Tuple[Node, int]]) -> Candidate:
    """A physical path as a route with the step each of its cells is due."""
    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    route: List[Node] = []
    times: List[int] = []
    for node, t in path:
        if route and (route[-1][0], route[-1][1]) == (node[0], node[1]):
            continue  # a wait: the next cell's time carries it
        route.append((int(node[0]), int(node[1]), int(node[2])))
        times.append(now + int(t))
    return route, times


def _rank(res, handle: int) -> tuple:
    """Better first: the train arrives, more trains arrive, more of its stops, earlier."""
    o = res.agent_outcomes.get(int(handle)) or {}
    arrival = o.get("arrival_step")
    return (
        bool(o.get("arrived")),
        int(res.success_count or 0),
        int(o.get("stops_served", 0) or 0),
        -(arrival if arrival is not None else float("inf")),
    )


def timed_route(
    env: RailEnv, handle: int, policy_factory: PolicyFactory, overrides: Optional[Dict[int, int]] = None,
) -> Optional[Candidate]:
    """The best route around the blocks on the course `policy_factory` drives.

    Candidates: the untimed route, and up to `TIMED_ROUNDS` timed ones — the
    first planned against the others' forecast with the train held, each next
    one against what the others did on the one before. Every candidate is
    simulated; the best by `_rank` wins, and the rounds stop once a timed one
    gets the train in without fewer trains arriving than the untimed route.
    None when no route around the blocks exists.
    """
    untimed = route_around_blocks(env, handle)
    if untimed is None:
        return None
    floor, _ = _simulate(env, handle, policy_factory, overrides, (untimed, None))
    best, best_rank = (untimed, None), _rank(floor, handle)

    _, cells = _simulate(env, handle, policy_factory, overrides, None)
    graph, avoid, cost = _rail_digraph(env), blocked_cells(env), _cell_cost(env, handle)
    for _ in range(TIMED_ROUNDS):
        path = plan_train_against(env, handle, cells, graph=graph, avoid=avoid, cell_cost=cost)
        if not path:
            break
        candidate = _timed(env, path)
        res, cells = _simulate(env, handle, policy_factory, overrides, candidate)
        rank = _rank(res, handle)
        if rank > best_rank:
            best, best_rank = candidate, rank
        if rank[0] and rank[1] >= _rank(floor, handle)[1]:
            break
    return best


# ── the committed route, kept on the env ─────────────────────────────────────

def _routes(env: RailEnv) -> Dict[int, List[Node]]:
    routes = getattr(env, "_route_overrides", None)
    if routes is None:
        routes = {}
        env._route_overrides = routes
    return routes


def _times(env: RailEnv) -> Dict[int, List[int]]:
    times = getattr(env, "_route_times", None)
    if times is None:
        times = {}
        env._route_times = times
    return times


def _drawn(env: RailEnv) -> Set[int]:
    drawn = getattr(env, "_route_drawn", None)
    if drawn is None:
        drawn = set()
        env._route_drawn = drawn
    return drawn


def commit_route(
    env: RailEnv,
    handle: int,
    policy_factory: Optional[PolicyFactory] = None,
    overrides: Optional[Dict[int, int]] = None,
    *,
    via: Optional[List[Tuple[int, int]]] = None,
    start: Optional[Node] = None,
) -> Optional[List[Node]]:
    """Fix the route for `handle`; None if there is none.

    With `via`, the route the operator drew through those cells from `start`
    (`route_through`, which raises `LeftDrawnRoute` when the train has left
    it), kept as drawn and untimed. Without it, the route around the current
    blocks: with a course to simulate — `policy_factory` (with `overrides`), or
    the one a branch fork carries — the best of the untimed and the timed
    candidates (`timed_route`); the untimed route otherwise.
    """
    if via:
        route, times = route_through(env, handle, via, start), None
    else:
        factory = policy_factory or getattr(env, "_route_policy_factory", None)
        if factory is None:
            route, times = route_around_blocks(env, handle), None
        else:
            route, times = timed_route(env, handle, factory, overrides) or (None, None)
    if route is None:
        return None
    _routes(env)[int(handle)] = route
    if times:
        _times(env)[int(handle)] = times
    else:
        _times(env).pop(int(handle), None)
    if via:
        _drawn(env).add(int(handle))
    else:
        _drawn(env).discard(int(handle))
    return route


def carry_to_fork(source: RailEnv, target: RailEnv) -> None:
    """Carry committed routes, their timing, and the plan routes are drawn
    against, to a fork.

    The plan goes under its own name: a fork with `_trainrun_plan` set would
    change which policy the registry builds for it.
    """
    routes = getattr(source, "_route_overrides", None)
    if routes:
        target._route_overrides = {h: list(r) for h, r in routes.items()}
    times = getattr(source, "_route_times", None)
    if times:
        target._route_times = {h: list(t) for h, t in times.items()}
    drawn = getattr(source, "_route_drawn", None)
    if drawn:
        target._route_drawn = set(drawn)
    course_routes = getattr(source, "_plan_course_routes", None)
    if course_routes:
        target._plan_course_routes = {h: list(r) for h, r in course_routes.items()}
    plan = getattr(source, "_route_reference_plan", None) or getattr(source, "_trainrun_plan", None)
    if plan:
        target._route_reference_plan = plan


def route_move(env: RailEnv, handle: int, overrides: Optional[Dict[int, int]] = None) -> Optional[RailEnvActions]:
    """The action that keeps `handle` on its reroute this step.

    Follows the committed route, and on a timed one waits until the next cell
    is due. When there is none, or the train is not on it (a route left over
    from an earlier reroute, or a what-if proposing a new one on a fork), the
    route is committed afresh from here, timed against `overrides` where the
    env carries a course — except a drawn route, which is not replaced. A
    train waiting at the origin of its route enters. None when the reroute is
    over or impossible — the train arrived, left its drawn route, or no way
    around the blocks exists — and the caller then
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
        route = commit_route(env, handle, overrides=overrides)
        if not route:
            return None
    if _stands_at_stop(env, handle, here):
        return RailEnvActions.STOP_MOVING
    index = route.index(here)
    if index >= len(route) - 1:
        return RailEnvActions.MOVE_FORWARD
    times = _times(env).get(int(handle))
    elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)
    if times and elapsed + 1 < times[index + 1]:
        return RailEnvActions.STOP_MOVING  # the next cell is not due yet
    return RailEnvActions(action_for_move(here[2], route[index + 1][2]))


def _stands_at_stop(env: RailEnv, handle: int, here: Node) -> bool:
    """Hold at an intermediate stop: until the train has stood there (Flatland
    counts a stop only then), and until its earliest departure — a departure
    takes effect on entering the next cell, one step after the action."""
    if any(s.matches(*here) for s in remaining_stops(env, handle)):
        return True
    elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)
    return any(
        s.matches(*here) and s.earliest_departure is not None and elapsed + 1 < s.earliest_departure
        for s in intermediate_stops(env.agents[int(handle)])
    )


def drop_route(env: RailEnv, handle: int) -> None:
    _routes(env).pop(int(handle), None)
    _times(env).pop(int(handle), None)
    _drawn(env).discard(int(handle))
