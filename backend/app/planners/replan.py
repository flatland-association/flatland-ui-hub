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
from app.utils.agent_compat import (
    agent_direction,
    agent_initial_direction,
    agent_initial_position,
    agent_planned_target,
    agent_position,
)

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


def _start_states(env: RailEnv, *, strict_stops: bool = False) -> List[SimpleNamespace]:
    elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)
    starts = []
    for agent in env.agents:
        if agent.state == TrainState.DONE:
            continue
        on_map = agent_position(agent) is not None
        cell = agent_position(agent) if on_map else agent_initial_position(agent)
        heading = agent_direction(agent) if on_map else agent_initial_direction(agent)
        if cell is None or heading is None:
            continue
        # Keep the legacy comparison's deterministic platform choice. The
        # strict Director adapter instead follows the assigned terminus; a
        # second acceptable platform is not necessarily the planned one (#92).
        target = agent_planned_target(agent) if strict_stops else sorted(agent.targets)[0][0]
        starts.append(SimpleNamespace(
            handle=int(agent.handle),
            initial_position=(int(cell[0]), int(cell[1])),
            target=(int(target[0]), int(target[1])),
            heading=int(heading),
            on_map=on_map,
            down=_down_steps(agent) if on_map else 0,
            earliest_departure=0 if on_map else max(0, int(agent.earliest_departure or 0) - elapsed),
            stops=remaining_stops(env, agent.handle),
            elapsed=elapsed,
            remaining_horizon=max(0, int(getattr(env, "_max_episode_steps", 0) or 0) - elapsed),
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

    The strict opt-in never drops a call, enforces its directional alternative
    and bounds every search by the remaining episode. It may retry the complete
    mission from a later off-grid departure, at most 32 times. Native callers
    can restrict waits to their representable cells and heading states.
    """

    def __init__(self, graph, *, strict_stops: bool = False, wait_cells=None, wait_states=None,
                 max_time=None):
        super().__init__(graph)
        self.strict_stops = strict_stops
        self.wait_cells = None if wait_cells is None else frozenset(wait_cells)
        self.wait_states = None if wait_states is None else frozenset(wait_states)
        self.max_time = None if max_time is None else int(max_time)

    def _get_successors(self, agent_id, node, occ_t, g_val):
        successors = super()._get_successors(agent_id, node, occ_t, g_val)
        if self.strict_stops and self.max_time is not None:
            successors = [successor for successor in successors if successor[2] <= self.max_time]
        if not self.strict_stops or is_proxy_node(node):
            return successors
        if ((self.wait_cells is None or node[:2] in self.wait_cells)
                and (self.wait_states is None or node[:3] in self.wait_states)):
            return successors
        # Native schedules can hold only on their existing decision nodes.
        # Keep every upstream movement successor; exclude solely a stand at
        # an unrepresentable intermediate cell. Off-grid waits remain legal.
        return [successor for successor in successors if successor[0] != node]

    def _compute_best_path_for_agent(self, agent):
        stops: Sequence[Stop] = getattr(agent, "stops", ()) or ()
        if not stops:
            return super()._compute_best_path_for_agent(agent)
        if self.strict_stops:
            # PP plans the calls sequentially. The earliest feasible arrival
            # at one call can leave no continuation to the next, even though
            # leaving the origin slightly later serves the complete mission.
            # Reuse the same upstream searches from bounded later departures;
            # never remove a required call or move an already on-map train.
            data = self.agent_data[agent.handle]
            departure = int(data["earliest_departure"])
            attempts = 1
            if not getattr(agent, "on_map", False):
                horizon = int(getattr(agent, "remaining_horizon", departure + 32))
                attempts = max(0, min(32, horizon - departure + 1))
            try:
                for delay in range(attempts):
                    data["earliest_departure"] = departure + delay
                    path = self._chain(agent, list(stops))
                    if path:
                        return path
                return None
            finally:
                data["earliest_departure"] = departure
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
                if self.strict_stops:
                    return None
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
                if not self.strict_stops and not is_ahead(dist_map.get(node, inf), to_target.get(goal, inf), to_target.get(node, inf)):
                    continue
                leg = self._leg_with_stand(agent, node, t, goal, dist_map, stop)
                if not self.strict_stops:
                    return leg
                # The upstream A* goal test matches cells, not headings. A
                # required stop may have a directional platform alternative.
                if leg and (heading is None or int(leg[-1][0][2]) == heading):
                    return leg
        return None

    def _dist_to(self, goal) -> dict:
        cache = self.__dict__.setdefault("_dist_cache", {})
        if goal not in cache:
            cache[goal] = true_distance_heuristic(self.nx_graph, goal)
        return cache[goal]

    def _cooperative_a_star(self, agent_id, start_node, goal_node, dist_map, earliest_departure):
        if self.strict_stops:
            if dist_map.get(start_node, float("inf")) == float("inf"):
                return None
            if self.max_time is not None and int(earliest_departure) > self.max_time:
                return None
        if not self.strict_stops or is_proxy_node(goal_node):
            return super()._cooperative_a_star(
                agent_id, start_node, goal_node, dist_map, earliest_departure
            )
        # The vendored solver deliberately terminates on a goal *cell*. A
        # mandatory call also specifies its arrival heading. Connect precisely
        # that rail state to a temporary zero-cost sink, so the unchanged
        # upstream search can reach its goal only via the required heading.
        sink = (-1, -1, -1)
        self.nx_graph.add_node(sink, type="proxy")
        self.nx_graph.add_edge(goal_node, sink, l=0.0)
        distances = dict(dist_map)
        distances[sink] = 0.0
        try:
            path = super()._cooperative_a_star(
                agent_id, start_node, sink, distances, earliest_departure
            )
        finally:
            self.nx_graph.remove_node(sink)
        return [(node, t) for node, t in path if node != sink] if path else None

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


def replan_from_state(
    env: RailEnv,
    priority: Sequence[int] = (),
    *,
    strict_stops: bool = False,
    wait_cells=None,
    wait_states=None,
) -> Optional[TrainrunDict]:
    """A collision-free plan for every train not yet arrived, from the current step.

    `priority` lists handles to plan first, in order; the rest follow with trains
    standing on a malfunction first, then by handle. Returns None when the solver
    finds no plan or the plan would put two trains in one cell.

    ``strict_stops`` never drops an unserved intermediate call and targets the
    assigned terminus. It is opt-in so Recommendation comparisons retain their
    existing explicit trade-off of served versus missed stops. This is still a
    candidate: the caller must execute and validate it before adoption.
    """
    starts = _start_states(env, strict_stops=strict_stops)
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

    elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)
    horizon = max(0, int(getattr(env, "_max_episode_steps", 0) or 0) - elapsed)
    solver = _StopAwarePP(
        graph, strict_stops=strict_stops, wait_cells=wait_cells,
        wait_states=wait_states, max_time=horizon,
    )
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


def replan_orders(
    env: RailEnv, max_orders: int = 24, *, strict_stops: bool = False, wait_cells=None,
    wait_states=None,
) -> List[Tuple[Tuple[int, ...], TrainrunDict]]:
    """Distinct replans for different priority orders of the trains not yet arrived.

    With PP the order is the decision: who goes first into a contested section.
    Up to four trains every order is tried; beyond that, each train once in
    front. Orders the solver cannot plan are dropped, and orders that produce the
    same plan are reported once, under the first order that produced it.
    """
    handles = sorted(s.handle for s in _start_states(env, strict_stops=strict_stops))
    if not handles:
        return []
    if len(handles) <= 4:
        candidates = list(itertools.permutations(handles))
    else:
        candidates = [tuple(handles)] + [(h, *[o for o in handles if o != h]) for h in handles]

    seen = set()
    distinct: List[Tuple[Tuple[int, ...], TrainrunDict]] = []
    for order in candidates[:max_orders]:
        trainruns = replan_from_state(
            env, priority=order, strict_stops=strict_stops, wait_cells=wait_cells,
            wait_states=wait_states,
        )
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
