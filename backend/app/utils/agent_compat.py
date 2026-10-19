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


def agent_target_positions(agent) -> Set[Position]:
    """Every acceptable arrival cell for `agent`, direction-agnostic.

    The actual criterion the simulation (and anything walking toward "the
    target") should stop on. `targets` holds (position, direction) arrival
    alternatives; `_widen_terminus_targets`
    (`goal_based_policies/visualization.py`) adds the destination city's other
    platform to it so a rerouted train still counts as arrived - this doesn't
    collapse that down to one arbitrary cell the way picking a single
    representative position would (issue #92).
    """
    return {t[0] for t in agent.targets}


def agent_planned_target(agent) -> Position:
    """The last stop of the train's assigned line - its *planned* terminus.

    `agent.waypoints` carries the line the generator and timetable assigned
    and is untouched by `_widen_terminus_targets` (which only widens
    `targets`), so `waypoints[-1][0].position` survives that widening where a
    single pick from `targets` would not (issue #92). Falls back to a
    deterministic (sorted) pick from `targets` when `waypoints` isn't
    populated (e.g. hand-built envs in tests).
    """
    waypoints = getattr(agent, "waypoints", None)
    if not waypoints:
        return sorted(agent.targets)[0][0]
    return waypoints[-1][0].position
