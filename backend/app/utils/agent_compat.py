"""Compatibility accessors for flatland-rl>=4.3's EnvAgent configuration API.

flatland-rl 4.3.0 removed EnvAgent.position/.direction/.old_position/
.old_direction/.initial_position/.initial_direction/.target and replaced them
with optional (position, direction) configuration tuples
(current_configuration / old_configuration / initial_configuration) plus a
`targets` set (an agent may have several direction alternatives at its target
cell). These helpers restore the old flat access pattern used throughout this
codebase without touching flatland internals at every call site.
"""
from typing import Optional, Set, Tuple

Position = Tuple[int, int]


def agent_position(agent) -> Optional[Position]:
    return agent.current_configuration[0] if agent.current_configuration is not None else None


def agent_direction(agent) -> Optional[int]:
    return agent.current_configuration[1] if agent.current_configuration is not None else None


def agent_old_position(agent) -> Optional[Position]:
    return agent.old_configuration[0] if agent.old_configuration is not None else None


def agent_old_direction(agent) -> Optional[int]:
    return agent.old_configuration[1] if agent.old_configuration is not None else None


def agent_initial_position(agent) -> Position:
    return agent.initial_configuration[0]


def agent_initial_direction(agent) -> int:
    return agent.initial_configuration[1]


def agent_target(agent) -> Position:
    """A single representative *acceptable arrival* position from `agent.targets`.

    `targets` holds (position, direction) arrival alternatives - callers here
    only ever need a `(row, col)` for display/distance purposes, so pick
    deterministically (sorted) rather than relying on set iteration order.

    This is the simulation's arrival criterion, not necessarily the train's
    *planned* terminus: `_widen_terminus_targets`
    (`goal_based_policies/visualization.py`) adds the destination city's other
    platform to `targets` so a rerouted train still counts as arrived, which
    makes the sorted choice here pick whichever platform sorts first - not
    the one the line generator actually assigned. Use `agent_planned_target`
    for "where is this train scheduled to end up" (issue #92).
    """
    return sorted(agent.targets)[0][0]


def agent_target_positions(agent) -> Set[Position]:
    """Every acceptable arrival cell for `agent`, direction-agnostic.

    The actual criterion the simulation (and anything walking toward "the
    target") should stop on - unlike `agent_target`, this doesn't collapse a
    widened `targets` down to one arbitrary cell (issue #92).
    """
    return {t[0] for t in agent.targets}


def agent_planned_target(agent) -> Position:
    """The last stop of the train's assigned line - its *planned* terminus.

    `agent.waypoints` carries the line the generator and timetable assigned
    and is untouched by `_widen_terminus_targets` (which only widens
    `targets`), so `waypoints[-1][0].position` survives that widening where
    `agent_target` does not (issue #92). Falls back to `agent_target` when
    `waypoints` isn't populated (e.g. hand-built envs in tests).
    """
    waypoints = getattr(agent, "waypoints", None)
    if not waypoints:
        return agent_target(agent)
    return waypoints[-1][0].position
