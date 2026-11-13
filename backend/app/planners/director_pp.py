"""Strict candidates from the existing PP bridge for the native Director.

No candidate is an admission decision. The caller must validate actual native
execution, including every required call, before adopting a converted schedule.
"""
from __future__ import annotations

from flatland.envs.rail_trainrun_data_structures import TrainrunDict
from flatland.envs.step_utils.states import TrainState

from app.planners.replan import replan_orders
from app.policies.goal_based_policies.infrastructure_graph import (
    DecisionPointGraph,
    _get_transitions,
)
from app.policies.goal_based_policies.schedule import ScheduleEntry, TrainSchedule
from app.utils.agent_compat import (
    agent_direction,
    agent_initial_direction,
    agent_initial_position,
    agent_position,
)

MAX_PRIORITY_ORDERS = 4
MAX_ACTIVE_SERVICES = 16


def candidate_trainruns(env, *, max_orders: int = MAX_PRIORITY_ORDERS, wait_cells=None,
                       wait_states=None):
    """Bounded existing PP variants without dropping required calls.

    This integration is scoped to at most sixteen active services. Do not
    unexpectedly run the full priority portfolio on larger imported networks.
    """
    if sum(a.state != TrainState.DONE for a in env.agents) > MAX_ACTIVE_SERVICES:
        return []
    return replan_orders(
        env,
        max_orders=max(0, min(MAX_PRIORITY_ORDERS, int(max_orders))),
        strict_stops=True,
        wait_cells=wait_cells,
        wait_states=wait_states,
    )


def schedules_from_trainruns(
    env, graph: DecisionPointGraph, trainruns: TrainrunDict
) -> list[TrainSchedule] | None:
    """Convert only routes and waits the native player can express faithfully.

    A cell-level PP path may wait inside a graph edge. ``SchedulePlayer``
    cannot express that, so those candidates are rejected instead of moving
    the wait to a different occupied cell. Delayed grid insertion is preserved
    as the first entry's absolute ``not_before`` time.
    Directional graph nodes can be crossed inside an edge; they are not
    blindly inserted into the resulting schedule. The native player's own
    deterministic edge choice must match the full PP path, including headings.
    """
    active = {int(a.handle) for a in env.agents if a.state != TrainState.DONE}
    if active != set(trainruns):
        return None
    elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)
    schedules = []
    for handle in sorted(active):
        run = trainruns[handle]
        if not run:
            return None
        agent = env.agents[handle]
        on_map = agent_position(agent) is not None
        start_cell = agent_position(agent) if on_map else agent_initial_position(agent)
        start_heading = agent_direction(agent) if on_map else agent_initial_direction(agent)
        cells = [tuple(wp.waypoint.position) for wp in run]
        headings = [int(wp.waypoint.direction) for wp in run]
        times = [int(wp.scheduled_at) for wp in run]
        start_time = elapsed if on_map else max(elapsed, int(agent.earliest_departure or 0))
        if cells[0] != start_cell or headings[0] != start_heading or times[0] < start_time:
            return None
        if on_map and times[0] != start_time:
            return None
        if cells[0] not in graph.nodes or cells[-1] not in graph.nodes:
            return None
        entries = []
        index = 0
        while index < len(run) - 1:
            cell = cells[index]
            if cell not in graph.nodes:
                return None
            transitions = _get_transitions(env, cell, headings[index])
            matching = []
            for edge in graph.edges_from(cell):
                if edge.travel_time <= 0:
                    continue
                end = index + edge.travel_time
                if end >= len(run) or not transitions[edge.out_direction]:
                    continue
                if tuple(cells[index:end + 1]) != edge.path:
                    continue
                if tuple(headings[index + 1:end + 1]) != edge.moves:
                    continue
                # Waiting after the source node is not expressible on a
                # reduced-graph schedule. The source's wait is handled below.
                if any(times[j + 1] - times[j] != 1 for j in range(index + 1, end)):
                    continue
                matching.append(edge)
            if not matching:
                return None
            edge = min(matching, key=lambda e: (e.travel_time, e.out_direction))
            usable = [e for e in graph.edges_from(cell)
                      if e.to_cell == edge.to_cell and transitions[e.out_direction]]
            native = min(usable, key=lambda e: (e.travel_time, e.out_direction))
            if native.path != edge.path or native.moves != edge.moves:
                return None
            wait = times[index + 1] - times[index] - 1
            if wait < 0:
                return None
            not_before = times[0] if index == 0 and not on_map else 0
            entries.append(ScheduleEntry(graph.node_id(cell), wait, not_before=not_before))
            index += edge.travel_time
        final_not_before = times[0] if not entries and not on_map else 0
        entries.append(ScheduleEntry(graph.node_id(cells[-1]), 0, not_before=final_not_before))
        schedules.append(TrainSchedule(handle=handle, entries=entries))
    return schedules


def candidate_schedules(
    env, graph: DecisionPointGraph, *, max_orders: int = MAX_PRIORITY_ORDERS
) -> list[tuple[tuple[int, ...], list[TrainSchedule]]]:
    """Strict PP variants that fit the native executor; still require validation."""
    candidates = []
    # Pure switch-approach nodes only stop a train in relevant headings. The
    # graph may cross that same cell inside an edge in another direction.
    wait_states = {(*edge.to_cell, edge.in_direction) for edge in graph.edges}
    wait_states.update(
        (*cell, heading)
        for cell, node in graph.nodes.items() if "station" in node.kinds
        for heading in range(4)
    )
    for order, trainruns in candidate_trainruns(
        env, max_orders=max_orders, wait_cells=set(graph.nodes), wait_states=wait_states
    ):
        schedules = schedules_from_trainruns(env, graph, trainruns)
        if schedules is not None:
            candidates.append((order, schedules))
    return candidates
