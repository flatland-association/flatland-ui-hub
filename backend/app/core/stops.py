"""Intermediate stops: which a train has, which it has served, which remain.

Flatland (4.2.6, `rewards.DefaultRewards`) counts an intermediate stop as served
when the train was on one of the stop's `Waypoint(position, direction)`
alternatives *and* stood there (`STOPPED`). The record of that lives in the
env's reward tracker, so "served" is read from there — defensively, because the
tracker is Flatland's internals, not its API. A branch fork starts with an empty
tracker, so the stops served before the fork travel with it
(`carry_served_to_fork`).

Plan: docs/plans/proposal-agents-roadmap.md (stage 2f).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Set, Tuple

from flatland.envs.rail_env import RailEnv
from flatland.envs.step_utils.states import TrainState

Cell = Tuple[int, int]


@dataclass(frozen=True)
class Stop:
    """One intermediate stop of a train."""

    index: int                                   # position in `agent.waypoints`
    alternatives: Tuple[Tuple[int, int, Optional[int]], ...]  # (row, col, heading or None)
    earliest_departure: Optional[int]            # absolute step
    latest_arrival: Optional[int]                # absolute step

    @property
    def cells(self) -> Set[Cell]:
        return {(r, c) for r, c, _ in self.alternatives}

    def matches(self, row: int, col: int, heading: int) -> bool:
        """On one of the alternatives; a heading of -1 (unknown) matches any."""
        return any(
            r == row and c == col and (d is None or heading == -1 or d == heading)
            for r, c, d in self.alternatives
        )


#: A stop counts as still ahead when going through it costs at most this much
#: more than heading straight for the target. Turning round at a dead end and
#: coming back to a station the train already passed costs far more.
DETOUR_FACTOR = 1.25
DETOUR_SLACK = 10


def is_ahead(to_stop: float, stop_to_target: float, to_target: float) -> bool:
    """Whether a stop lies on the way: the detour through it is small."""
    if to_stop == float("inf") or stop_to_target == float("inf"):
        return False
    if to_target == float("inf"):
        return True
    return to_stop + stop_to_target <= DETOUR_FACTOR * to_target + DETOUR_SLACK


def _int_or_none(value) -> Optional[int]:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def intermediate_stops(agent) -> List[Stop]:
    """The train's stops between origin and target, in order. Empty without any."""
    waypoints = getattr(agent, "waypoints", None) or []
    eds = getattr(agent, "waypoints_earliest_departure", None) or []
    las = getattr(agent, "waypoints_latest_arrival", None) or []
    stops = []
    for i in range(1, len(waypoints) - 1):
        alternatives = tuple(
            (int(wp.position[0]), int(wp.position[1]), _int_or_none(wp.direction))
            for wp in waypoints[i] if wp is not None and wp.position is not None
        )
        if not alternatives:
            continue
        stops.append(Stop(
            index=i,
            alternatives=alternatives,
            earliest_departure=_int_or_none(eds[i]) if i < len(eds) else None,
            latest_arrival=_int_or_none(las[i]) if i < len(las) else None,
        ))
    return stops


def _tracker_states(env: RailEnv):
    """Flatland's per-train {Waypoint: {TrainState}} record, or None."""
    rewards = getattr(env, "rewards", None)
    tracker = getattr(rewards, "_proxy", rewards)
    return getattr(tracker, "states", None)


def served_stops(env: RailEnv, handle: int) -> Set[int]:
    """Indices (into `agent.waypoints`) of the stops the train has served."""
    agent = env.agents[int(handle)]
    served = set(getattr(env, "_stops_served_before", {}).get(int(handle), ()))
    states = _tracker_states(env)
    if states is None:
        return served
    record = states.get(int(handle), {}) if hasattr(states, "get") else {}
    for stop in intermediate_stops(agent):
        for wp, seen in record.items():
            position = getattr(wp, "position", None)
            if position is None or TrainState.STOPPED not in seen:
                continue
            direction = getattr(wp, "direction", None)
            if stop.matches(int(position[0]), int(position[1]), -1 if direction is None else int(direction)):
                served.add(stop.index)
                break
    return served


def remaining_stops(env: RailEnv, handle: int) -> List[Stop]:
    """The stops still to serve, in order. All of them for a train not yet departed."""
    agent = env.agents[int(handle)]
    if agent.state == TrainState.DONE:
        return []
    served = served_stops(env, handle)
    return [s for s in intermediate_stops(agent) if s.index not in served]


def stop_counts(env: RailEnv, handle: int) -> Tuple[int, int]:
    """(served, total) intermediate stops for the train."""
    agent = env.agents[int(handle)]
    stops = intermediate_stops(agent)
    return len(served_stops(env, handle) & {s.index for s in stops}), len(stops)


def carry_served_to_fork(source: RailEnv, target: RailEnv) -> None:
    """A fork's reward tracker starts empty; keep what was served before it."""
    served: Dict[int, Set[int]] = {}
    for agent in source.agents:
        if intermediate_stops(agent):
            done = served_stops(source, agent.handle)
            if done:
                served[int(agent.handle)] = done
    target._stops_served_before = served
