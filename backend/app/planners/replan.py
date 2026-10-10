"""Replan the trains from the current state with Prioritized Planning.

The solver is AI4REALNET/flatland-blackbox's PP (vendored in `blackbox/`). This
module is the glue it does not have for a running episode:

- a `(row, col, heading)` graph of the env's transitions;
- start states taken from where the trains are *now*, each train only leaving in
  the heading it has — a train cannot turn round;
- the cells of trains standing with a malfunction reserved while they stand;
- a physical-occupancy check, because the solver lets a train "wait" on its start
  proxy, which is off the grid, while in reality it keeps occupying its cell;
- intermediate stops: the solver knows one goal per train, so a train with stops
  still to serve is planned leg by leg (`_StopAwarePP`), standing at each stop
  until its earliest departure;
- one train planned alone against the others' forecast cells, for a timed
  reroute (`plan_train_against`);
- the result as a `TrainrunDict`, which `PlanPolicy` already executes.

Plan: docs/plans/proposal-agents-roadmap.md (stages 2a, 2f, 2g).
"""
from __future__ import annotations

import itertools
from types import SimpleNamespace
from typing import Callable, Dict, List, Optional, Sequence, Set, Tuple

import networkx as nx
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_trainrun_data_structures import TrainrunDict, TrainrunWaypoint, Waypoint
from flatland.envs.step_utils.states import TrainState

from app.planners.blackbox.pp import PrioritizedPlanningSolver
from app.core.stops import Stop, is_ahead, remaining_stops
from app.planners.blackbox.utils import (
    NoSolutionError,
    add_proxy_nodes,
    check_no_collisions,
    get_direction,
    is_proxy_node,
    true_distance_heuristic,
)
from app.policies.goal_based_policies.infrastructure_graph import _get_transitions

_DELTA = {0: (-1, 0), 1: (0, 1), 2: (1, 0), 3: (0, -1)}


def build_rail_digraph(env: RailEnv) -> nx.DiGraph:
    """Directed graph over `(row, col, heading)`: an edge per allowed move, cost 1."""
    graph = nx.DiGraph()
    for r in range(env.height):
        for c in range(env.width):
            if int(env.rail.grid[r, c]) == 0:
                continue
            for heading in range(4):
                moves = _get_transitions(env, (r, c), heading)
                if not any(moves):
                    continue
                node = (r, c, heading)
                graph.add_node(node, type="rail")
                for move, allowed in enumerate(moves):
                    if not allowed:
                        continue
                    dr, dc = _DELTA[move]
                    nr, nc = r + dr, c + dc
                    if not (0 <= nr < env.height and 0 <= nc < env.width):
                        continue
                    nxt = (nr, nc, move)
                    if nxt not in graph:
                        graph.add_node(nxt, type="rail")
                    graph.add_edge(node, nxt, type="dir", l=1.0)
    return graph


def _down_steps(agent) -> int:
    handler = getattr(agent, "malfunction_handler", None)
    return int(getattr(handler, "malfunction_down_counter", 0) or 0)


def _start_states(env: RailEnv) -> List[SimpleNamespace]:
    elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)
    starts = []
    for agent in env.agents:
        if agent.state == TrainState.DONE:
            continue
        on_map = agent.position is not None
        cell = agent.position if on_map else agent.initial_position
        heading = agent.direction if on_map else agent.initial_direction
        if cell is None or heading is None:
            continue
        starts.append(SimpleNamespace(
            handle=int(agent.handle),
            initial_position=(int(cell[0]), int(cell[1])),
            target=(int(agent.target[0]), int(agent.target[1])),
            heading=int(heading),
            on_map=on_map,
            down=_down_steps(agent) if on_map else 0,
            earliest_departure=0 if on_map else max(0, int(agent.earliest_departure or 0) - elapsed),
            stops=remaining_stops(env, agent.handle),
            elapsed=elapsed,
        ))
    return starts


class _StopAwarePP(PrioritizedPlanningSolver):
    """PP that routes a train through its remaining stops before its target.

    The vendored solver plans one leg, start to goal. Here a train with stops is
    planned as a chain of those legs with the solver's own cooperative A*: to
    each stop, a stand there (at least one step, and until the stop's earliest
    departure — Flatland counts a stop only when the train stood on it), then on.
    The stand is checked against and later reserved like any other occupancy. A
    stop that is no longer on the way — the train passed it, and only turning
    round at a dead end would bring it back (`stops.is_ahead`) — is left out,
    and when the trains planned earlier leave no room for all stops, the train
    serves as many as they allow (`_stop_subsets`): PP is sequential, so with
    stops a fixed order otherwise fails as a whole (measured on
    `pf-ch-corridor-stops`: no order feasible at step 10, against 14 of 17
    without stops). A skipped stop shows as missed in the comparison.
    """

    def _compute_best_path_for_agent(self, agent):
        stops: Sequence[Stop] = getattr(agent, "stops", ()) or ()
        if not stops:
            return super()._compute_best_path_for_agent(agent)
        # Most stops first: all of them, then each one left out, then none. A
        # chain can fail after a stop that itself went fine — the stand there
        # walks the train into a corner the trains planned earlier close — and
        # sequential PP cannot take that stop back, so the subset is retried.
        for subset in _stop_subsets(list(stops)):
            path = self._chain(agent, subset)
            if path:
                return path
        return None

    def _chain(self, agent, stops: Sequence[Stop]):
        """Start → each stop on the way (standing there) → target, or None."""
        data = self.agent_data[agent.handle]
        node, t = data["start_node"], int(data["earliest_departure"])
        path: list = []
        for stop in stops:
            leg = self._leg_to_stop(agent, node, t, stop, data["dist_map"])
            if leg is None:
                continue  # not on the way any more: the train passed it
            if leg is False:
                return None
            path += leg if not path else leg[1:]
            node, t = leg[-1]

        last = self._cooperative_a_star(agent.handle, node, data["goal_node"], data["dist_map"], t)
        if not last:
            return None
        return path + (last if not path else last[1:])

    #: How often a leg is searched again for a later arrival when the stand at
    #: the stop would collide with a train the plan already put there.
    STAND_RETRIES = 40

    def _leg_to_stop(self, agent, node, t: int, stop: Stop, to_target: dict):
        """Path from `node` at `t` to the stop's first alternative on the way,
        ending with the stand there.

        None when no alternative is on the way (the stop is behind the train);
        False when one is but the reservations leave no path. When the stand
        would collide, the arrival time is barred and the leg searched again, so
        the train arrives later instead of failing.
        """
        inf = float("inf")
        for r, c, heading in stop.alternatives:
            goals = [
                n for n in self.nx_graph.nodes
                if len(n) == 3 and n[0] == r and n[1] == c and n[2] != -1
                and (heading is None or n[2] == heading)
            ]
            for goal in goals:
                dist_map = self._dist_to(goal)
                if not is_ahead(dist_map.get(node, inf), to_target.get(goal, inf), to_target.get(node, inf)):
                    continue
                return self._leg_with_stand(agent, node, t, goal, dist_map, stop)
        return None

    def _dist_to(self, goal) -> dict:
        cache = self.__dict__.setdefault("_dist_cache", {})
        if goal not in cache:
            cache[goal] = true_distance_heuristic(self.nx_graph, goal)
        return cache[goal]

    def _leg_with_stand(self, agent, node, t: int, goal, dist_map: dict, stop: Stop):
        barred = []
        try:
            for _ in range(self.STAND_RETRIES):
                leg = self._cooperative_a_star(agent.handle, node, goal, dist_map, t)
                if not leg:
                    return False
                at, arrival = leg[-1]
                depart = max(arrival + 1, (stop.earliest_departure or 0) - int(agent.elapsed))
                stand = [(at, wait) for wait in range(arrival + 1, depart + 1)]
                clash = next(
                    (w for _n, w in stand if self.res_manager.is_blocked(agent.handle, at[0], at[1], at[0], at[1], w)),
                    None,
                )
                if clash is None:
                    return leg + stand
                # Bar arriving at this time; the next search arrives later.
                key = ((at[0], at[1]), arrival)
                if key in self.res_manager.occupant_table:
                    return False
                self.res_manager.occupant_table[key] = -1
                barred.append(key)
            return False
        finally:
            for key in barred:
                self.res_manager.occupant_table.pop(key, None)


def _stop_subsets(stops: List[Stop]):
    """All stops, then each one left out, then none — most stops first.

    Every subset would be 2^n; with the few stops a train has left this covers
    the cases that matter (one stop the order makes impossible) cheaply.
    """
    yield stops
    if len(stops) > 1:
        for i in range(len(stops)):
            yield stops[:i] + stops[i + 1:]
    yield []


def _physical_paths(solution: Dict[int, list], starts: Dict[int, SimpleNamespace]) -> Dict[int, list]:
    """Paths including the steps a train stands in its cell before its first move.

    The solver's own paths leave that out (the train waits on its off-grid start
    proxy); a train already on the map occupies its cell during that wait.
    """
    physical = {}
    for handle, path in solution.items():
        rail = [(node, t) for node, t in path if not is_proxy_node(node)]
        start = starts[handle]
        if rail and start.on_map:
            first_node, first_t = rail[0]
            standing = [
                ((start.initial_position[0], start.initial_position[1], start.heading), t)
                for t in range(0, int(first_t))
            ]
            rail = standing + rail
        physical[handle] = rail
    return physical


def _to_trainruns(paths: Dict[int, list], elapsed: int) -> TrainrunDict:
    trainruns: TrainrunDict = {}
    for handle, path in paths.items():
        run = []
        last_cell = None
        for node, t in path:
            cell = (int(node[0]), int(node[1]))
            if cell == last_cell:
                continue  # a wait: the next waypoint's time carries it
            run.append(TrainrunWaypoint(
                scheduled_at=elapsed + int(t),
                waypoint=Waypoint(cell, int(get_direction(node))),
            ))
            last_cell = cell
        if run:
            trainruns[int(handle)] = run
    return trainruns


def replan_from_state(env: RailEnv, priority: Sequence[int] = ()) -> Optional[TrainrunDict]:
    """A collision-free plan for every train not yet arrived, from the current step.

    `priority` lists handles to plan first, in order; the rest follow with trains
    standing on a malfunction first, then by handle. Returns None when the solver
    finds no plan or the plan would put two trains in one cell.
    """
    starts = _start_states(env)
    if not starts:
        return None
    rank = {int(h): i for i, h in enumerate(priority)}
    starts.sort(key=lambda a: (rank.get(a.handle, len(rank)), -a.down, a.handle))

    graph = add_proxy_nodes(build_rail_digraph(env), starts, cost=0.0)
    for start in starts:
        proxy = next(
            n for n in graph.nodes
            if is_proxy_node(n) and len(n) == 4 and int(n[3]) == start.handle
        )
        for succ in list(graph.successors(proxy)):
            if get_direction(succ) != start.heading:
                graph.remove_edge(proxy, succ)

    solver = _StopAwarePP(graph)
    for start in starts:
        if start.down > 0:
            node = (start.initial_position[0], start.initial_position[1], start.heading)
            solver.res_manager.block_path(start.handle, [(node, t) for t in range(start.down + 1)])
            start.earliest_departure = max(start.earliest_departure, start.down)

    try:
        solution = solver.solve(starts)
    except (NoSolutionError, ValueError):
        return None

    by_handle = {s.handle: s for s in starts}
    paths = _physical_paths(solution, by_handle)
    try:
        check_no_collisions(paths)
    except AssertionError:
        return None

    elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)
    return _to_trainruns(paths, elapsed)


def replan_orders(env: RailEnv, max_orders: int = 24) -> List[Tuple[Tuple[int, ...], TrainrunDict]]:
    """Distinct replans for different priority orders of the trains not yet arrived.

    With PP the order is the decision: who goes first into a contested section.
    Up to four trains every order is tried; beyond that, each train once in
    front. Orders the solver cannot plan are dropped, and orders that produce the
    same plan are reported once, under the first order that produced it.
    """
    handles = sorted(s.handle for s in _start_states(env))
    if not handles:
        return []
    if len(handles) <= 4:
        candidates = list(itertools.permutations(handles))
    else:
        candidates = [tuple(handles)] + [(h, *[o for o in handles if o != h]) for h in handles]

    seen = set()
    distinct: List[Tuple[Tuple[int, ...], TrainrunDict]] = []
    for order in candidates[:max_orders]:
        trainruns = replan_from_state(env, priority=order)
        if trainruns is None:
            continue
        key = tuple(
            (handle, tuple((wp.scheduled_at, tuple(wp.waypoint.position)) for wp in run))
            for handle, run in sorted(trainruns.items())
        )
        if key in seen:
            continue
        seen.add(key)
        distinct.append((tuple(order), trainruns))
    return distinct


Cell = Tuple[int, int]


def plan_train_against(
    env: RailEnv,
    handle: int,
    occupied: Dict[int, List[Tuple[Cell, int]]],
    graph: Optional[nx.DiGraph] = None,
    avoid: Set[Cell] = frozenset(),
    cell_cost: Optional[Callable[[Cell], float]] = None,
) -> Optional[List[Tuple[Tuple[int, int, int], int]]]:
    """One train planned alone against the other trains' cells per step.

    `occupied` maps another train's handle to the `((row, col), t)` it holds, `t`
    counted in steps from now; those are reserved, and the train is planned by
    the same `_StopAwarePP` as a replan — through its remaining stops, waiting
    where it has to. `avoid` drops cells from the graph (standing trains);
    `cell_cost` weighs entering a cell in the search only (`learned_l`), arrival
    times still count one step per cell. Returns the physical path
    `[((row, col, heading), t), …]` from the train's cell at t = 0, or None
    when the train is not on the map, stands itself, or no path exists.
    (Plan stage 2g.)
    """
    start = next((s for s in _start_states(env) if s.handle == int(handle)), None)
    if start is None or not start.on_map or start.down > 0:
        return None
    rail = graph if graph is not None else build_rail_digraph(env)
    here = (start.initial_position[0], start.initial_position[1], start.heading)
    rail = rail.subgraph([n for n in rail.nodes if n == here or (n[0], n[1]) not in avoid]).copy()
    if cell_cost is not None:
        for _u, v, data in rail.edges(data=True):
            data["learned_l"] = float(cell_cost((v[0], v[1])))

    graph = add_proxy_nodes(rail, [start], cost=0.0)
    proxy = next(n for n in graph.nodes if is_proxy_node(n) and len(n) == 4 and int(n[3]) == start.handle)
    for succ in list(graph.successors(proxy)):
        if get_direction(succ) != start.heading:
            graph.remove_edge(proxy, succ)

    solver = _StopAwarePP(graph)
    for other, cells in occupied.items():
        if int(other) != start.handle:
            solver.res_manager.block_path(int(other), cells)
    try:
        solution = solver.solve([start])
    except (NoSolutionError, ValueError):
        return None
    return _physical_paths(solution, {start.handle: start}).get(start.handle) or None


__all__ = ["build_rail_digraph", "plan_train_against", "replan_from_state", "replan_orders"]
