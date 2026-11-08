"""Admit plans using actual execution and complete timetable obligations.

This is a current-state check, not a prediction of future external incidents.
The live env, policy/player state and random generator are never advanced. A
deepcopy deliberately retains already served stops and active malfunctions;
session-scripted future disturbances are outside this env and are not forecast.
Historical call service is taken from the env's records; past call order and
departure times cannot be reconstructed from those configuration-level sets.
"""
from __future__ import annotations

import copy
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict, dataclass

from flatland.envs.step_utils.states import TrainState

from app.core.stops import intermediate_stops, served_stops
from app.utils.agent_compat import agent_direction, agent_position


@dataclass(frozen=True)
class TrainValidation:
    handle: int
    arrived: bool
    arrival_step: int | None
    served_stops: tuple[int, ...]
    missed_stops: tuple[int, ...]
    violations: tuple[str, ...]


@dataclass(frozen=True)
class PlanValidation:
    accepted: bool
    reason: str
    simulated_steps: int
    start_step: int
    end_step: int
    trains: tuple[TrainValidation, ...]
    errors: tuple[str, ...] = ()

    @property
    def arrived_handles(self) -> tuple[int, ...]:
        return tuple(train.handle for train in self.trains if train.arrived)

    @property
    def incomplete_handles(self) -> tuple[int, ...]:
        return tuple(train.handle for train in self.trains if not train.arrived)

    @property
    def missed_stops_by_handle(self) -> dict[int, tuple[int, ...]]:
        return {train.handle: train.missed_stops for train in self.trains if train.missed_stops}

    def to_dict(self) -> dict:
        result = asdict(self)
        result["arrived"] = len(self.arrived_handles)
        result["total"] = len(self.trains)
        result["scope"] = "current_state_no_future_session_incidents"
        result["history_scope"] = "served_stop_evidence_only"
        return result


def _configuration(agent):
    position = agent_position(agent)
    if position is None:
        return None
    return (tuple(int(v) for v in position), int(agent_direction(agent)))


def validate_execution(env, policy_factory: Callable, *, max_steps: int | None = None,
                       covered_handles: Iterable[int] | None = None) -> PlanValidation:
    """Run a fresh policy on a clone and check every train's obligations.

    ``policy_factory(fork)`` returns a policy implementing the usual
    ``act_many(handles, observations)`` contract. Optional reset/start_step/
    end_step hooks are called on this fork only. ``max_steps`` is an optional
    *remaining* step budget; it can shorten, but never extend, the real episode.
    Lateness remains an optimisation objective, while required stops, their
    order, earliest departures and valid destination alternatives are mandatory.
    """
    start = int(getattr(env, "_elapsed_steps", 0) or 0)
    now = start
    fork = None
    errors = []
    violations = {int(a.handle): set() for a in env.agents}
    stops = {int(a.handle): intermediate_stops(a) for a in env.agents}
    served = {int(a.handle): set(served_stops(env, a.handle)) for a in env.agents}

    def report(reason: str) -> PlanValidation:
        current = fork if fork is not None else env
        trains = tuple(
            TrainValidation(
                handle=int(a.handle),
                arrived=a.state == TrainState.DONE,
                arrival_step=(int(a.arrival_time) if getattr(a, "arrival_time", None) is not None else None),
                served_stops=tuple(sorted(served[int(a.handle)])),
                missed_stops=tuple(s.index for s in stops[int(a.handle)] if s.index not in served[int(a.handle)]),
                violations=tuple(sorted(violations[int(a.handle)])),
            )
            for a in current.agents
        )
        return PlanValidation(reason == "verified", reason, now - start, start, now, trains, tuple(errors))

    # Empty/malformed missions must not become a vacuous successful rollout.
    if not env.agents:
        errors.append("no_trains")
    for agent in env.agents:
        handle = int(agent.handle)
        if not getattr(agent, "targets", None):
            violations[handle].add("missing_targets")
        waypoints = getattr(agent, "waypoints", None)
        if waypoints is None:
            violations[handle].add("missing_waypoints")
        elif len(waypoints) > 2:
            expected = set(range(1, len(waypoints) - 1))
            if {stop.index for stop in stops[handle]} != expected:
                violations[handle].add("missing_stop_alternatives")
        ordered = [stop.index for stop in stops[handle]]
        completed = [index for index in ordered if index in served[handle]]
        if completed != ordered[:len(completed)]:
            violations[handle].add("stop_order_before_validation")
    if errors or any(violations.values()):
        return report("invalid_mission_data")

    if covered_handles is not None:
        covered = set(covered_handles)
        for agent in env.agents:
            if agent.state != TrainState.DONE and int(agent.handle) not in covered:
                violations[int(agent.handle)].add("missing_plan")
        if any(violations.values()):
            return report("incomplete_plan")

    horizon = int(getattr(env, "_max_episode_steps", 0) or 0)
    if max_steps is not None:
        if int(max_steps) <= 0:
            errors.append("non_positive_step_budget")
            return report("invalid_budget")
        horizon = min(horizon, start + int(max_steps)) if horizon else start + int(max_steps)
    if horizon <= 0:
        errors.append("missing_episode_horizon")
        return report("invalid_budget")

    try:
        fork = copy.deepcopy(env)
        policy = policy_factory(fork)
        if hasattr(policy, "reset"):
            policy.reset(fork)
        handles = [int(a.handle) for a in fork.agents]
        observations = {}
        # Several consecutive STOPPED frames are one physical visit, even if
        # the mission contains the same station more than once. Historical
        # evidence at the current cell already consumed this visit.
        consumed_visit = {}
        for agent in fork.agents:
            handle = int(agent.handle)
            configuration = _configuration(agent)
            consumed_visit[handle] = configuration is not None and any(
                stop.index in served[handle] and stop.matches(*configuration[0], configuration[1])
                for stop in stops[handle]
            )

        def observe(before: Mapping[int, object]) -> None:
            for agent in fork.agents:
                handle = int(agent.handle)
                configuration = _configuration(agent)
                previous = before.get(handle)
                if configuration != previous:
                    consumed_visit[handle] = False
                if agent.state == TrainState.DONE:
                    target = getattr(agent, "target_configuration", None) or configuration
                    if target is None:
                        violations[handle].add("missing_arrival_configuration")
                    elif target not in agent.targets:
                        violations[handle].add("invalid_arrival_configuration")
                    configuration = target
                if previous is None and configuration is not None:
                    earliest = getattr(agent, "earliest_departure", None)
                    if earliest is not None and now < int(earliest):
                        violations[handle].add("early_initial_departure")
                if previous is not None and configuration != previous:
                    position, heading = previous
                    for stop in stops[handle]:
                        if (stop.matches(*position, heading)
                                and stop.earliest_departure is not None
                                and now < stop.earliest_departure):
                            violations[handle].add(f"early_stop_departure:{stop.index}")
                if (configuration is not None and agent.state == TrainState.STOPPED
                        and not consumed_visit[handle]):
                    position, heading = configuration
                    matching = [stop for stop in stops[handle]
                                if stop.index not in served[handle] and stop.matches(*position, heading)]
                    if matching:
                        stop = matching[0]
                        missing_before = [s.index for s in stops[handle]
                                          if s.index < stop.index and s.index not in served[handle]]
                        if missing_before:
                            violations[handle].add(f"stop_order:{stop.index}")
                        served[handle].add(stop.index)
                        consumed_visit[handle] = True

        # Include the current state, notably a dwell at the fork boundary.
        observe({h: _configuration(fork.agents[h]) for h in handles})
        while now < horizon and not all(a.state == TrainState.DONE for a in fork.agents):
            before = {int(a.handle): _configuration(a) for a in fork.agents}
            if hasattr(policy, "start_step"):
                policy.start_step()
            actions = policy.act_many(handles, observations) or {}
            observations, _, dones, _ = fork.step(actions)
            if hasattr(policy, "end_step"):
                policy.end_step()
            now = int(fork._elapsed_steps)
            observe(before)
            for handle in getattr(policy, "off_plan_handles", ()):
                violations[int(handle)].add("left_plan")
            if dones.get("__all__"):
                break
    except Exception as exc:  # noqa: BLE001 — any failed execution proof must reject the candidate.
        # A failed clone, adapter or execution is a failed proof, never approval.
        errors.append(f"{type(exc).__name__}: {exc}")
        return report("execution_error")

    if any(violations.values()):
        return report("mission_constraints")
    if any(stop.index not in served[h] for h in stops for stop in stops[h]):
        return report("missed_required_stops")
    if not all(a.state == TrainState.DONE for a in fork.agents):
        return report("incomplete_arrivals")
    return report("verified")


class _SchedulePolicy:
    def __init__(self, player):
        self.player = player

    def act_many(self, handles, observations):
        return self.player.act_many(handles)


def validate_schedules(env, graph, schedules: Iterable, *, waited: Mapping[int, int] | None = None,
                       max_steps: int | None = None) -> PlanValidation:
    """Check a complete native Director schedule without loading any model."""
    from app.policies.goal_based_policies.schedule import SchedulePlayer

    schedules = list(schedules)
    snapshot = {int(s.handle): (list(s.entries), int((waited or {}).get(s.handle, 0))) for s in schedules}

    def factory(fork):
        player = SchedulePlayer(graph, fork)
        player.restore(snapshot)
        return _SchedulePolicy(player)

    return validate_execution(env, factory, max_steps=max_steps,
                              covered_handles=[h for h, (entries, _) in snapshot.items() if entries])


def validate_player(env, player, *, max_steps: int | None = None) -> PlanValidation:
    """Check exactly the mixed committed/spliced player and its elapsed waits."""
    from app.policies.goal_based_policies.schedule import SchedulePlayer

    snapshot = player.snapshot()

    def factory(fork):
        candidate = SchedulePlayer(player.graph, fork)
        candidate.restore(snapshot)
        return _SchedulePolicy(candidate)

    return validate_execution(env, factory, max_steps=max_steps,
                              covered_handles=[h for h, (entries, _) in snapshot.items() if entries])


def validate_trainruns(env, trainruns, *, max_steps: int | None = None) -> PlanValidation:
    """Check the PP bridge's actual PlanPolicy execution and mandatory calls."""
    from app.policies.plan_policy import PlanPolicy

    return validate_execution(env, lambda fork: PlanPolicy(fork, trainruns), max_steps=max_steps,
                              covered_handles=[int(h) for h, run in trainruns.items() if run])
