"""PF-CH learning episodes use live incident timing and complete service missions.

Cases record explicit timetable changes and incidents; changing a seed alone
never pretends to change a fixed preset. Headless runs do not write study data.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import uuid
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import NotRequired, TypedDict

import numpy as np
from flatland.envs.step_utils.states import TrainState

from app.core.disturbances import DisturbanceScheduler, parse_disturbance
from app.core.env_factory import create_env
from app.core.env_step import step_env
from app.core.notification_manager import notification_manager
from app.core.scenario_presets import select_disturbances
from app.core.stops import intermediate_stops, served_stops
from app.policies.learned.ecml_observation import OBSERVATION_SCHEMA as SERVICE_OBSERVATION_SCHEMA
from app.policies.learned.ecml_observation import FastTreeObsBuilder
from app.utils.agent_compat import agent_direction, agent_initial_direction, agent_initial_position, agent_position
from lab.marl.common import make_obs_builder, observe

CALL_BONUS = 0.25
MISSION_BONUS = 1.0
TEAM_BONUS = 0.5
PROGRESS_PER_CELL = 0.01
TIME_COST = 0.002
VIOLATION_COST = 0.5
UNFINISHED_COST = 1.0
MISSED_CALL_COST = 0.25
UC2_PRESETS = frozenset({"tutorial", "uc2-1", "uc2-2", "uc2-3", "uc2-4"})

Configuration = tuple[tuple[int, int], int]


def total_lateness(env) -> int:
    """Existing rollout metric: completed arrival, or current time if stranded.

    Kept in the offline adapter so importing it does not start or require the
    separate online learner, which is absent from the release application.
    """
    now = int(env._elapsed_steps)
    total = 0
    for agent in env.agents:
        latest = getattr(agent, "latest_arrival", None)
        if latest is None:
            continue
        arrival = getattr(agent, "arrival_time", None) if agent.state == TrainState.DONE else None
        reached = int(arrival) if arrival is not None else now
        total += max(0, reached - int(latest))
    return total


@dataclass(frozen=True)
class PFChCase:
    """One explicit PF-CH timetable and disturbance configuration."""

    preset: str
    seed: int = 0
    departure_offsets: tuple[int, ...] = ()
    disturbance_ids: tuple[str, ...] = ()
    disturbances: tuple[dict, ...] = ()
    horizon: int | None = None
    case_id: str = ""

    def __post_init__(self) -> None:
        if not self.preset.startswith("pf-ch-") and self.preset not in UC2_PRESETS:
            raise ValueError("learning cases require a PF-CH or named UC2/tutorial preset")
        if self.preset in UC2_PRESETS and self.horizon is not None:
            raise ValueError("UC2/tutorial cases preserve their native locked episode horizon")
        if self.horizon is not None and self.horizon <= 0:
            raise ValueError("horizon must be positive")
        object.__setattr__(self, "departure_offsets", tuple(self.departure_offsets))
        object.__setattr__(self, "disturbance_ids", tuple(self.disturbance_ids))
        object.__setattr__(self, "disturbances", tuple(copy.deepcopy(self.disturbances)))
        if not self.case_id:
            payload = asdict(self)
            payload.pop("case_id")
            digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:12]
            object.__setattr__(self, "case_id", f"{self.preset}-{digest}")

    def to_dict(self) -> dict:
        """Return JSON-compatible case metadata."""
        return json.loads(json.dumps(asdict(self)))

    @classmethod
    def from_dict(cls, payload: Mapping) -> PFChCase:
        """Read the same case configuration written by to_dict."""
        return cls(**dict(payload))


def load_cases(path: str | Path) -> list[PFChCase]:
    """Load a case list or a versioned case manifest."""
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    records = payload["cases"] if isinstance(payload, dict) else payload
    cases = [PFChCase.from_dict(record) for record in records]
    if not cases or len({case.case_id for case in cases}) != len(cases):
        raise ValueError("case manifest must contain nonempty, unique case ids")
    return cases


def save_cases(cases: Iterable[PFChCase], path: str | Path) -> None:
    """Save explicit cases for replay and comparison."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {"schema": "pf-ch-learning-cases", "version": 1, "cases": [case.to_dict() for case in cases]}
    target.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _configuration(agent) -> Configuration | None:
    position = agent_position(agent)
    if position is None:
        return None
    direction = agent_direction(agent)
    if direction is None:
        raise ValueError("on-map PF-CH train has no direction")
    return position, int(direction)


def _ignore_recording(*args, **kwargs) -> None:
    pass


class IncidentEvidence(TypedDict):
    """Per-event outcome recorded by the native disturbance scheduler."""

    event_id: int
    source: str
    source_index: int | None
    type: str
    scheduled_step: int
    status: str
    on_map_exposure_steps: int
    ready_exposure_steps: int
    handle: NotRequired[int]
    target_state: NotRequired[str]
    target_on_map: NotRequired[bool]
    counter_before: NotRequired[int]
    counter_after: NotRequired[int]
    delay_steps: NotRequired[int]
    attempted_step: NotRequired[int]
    effect_changed: NotRequired[bool]


class _ObservedDisturbanceScheduler(DisturbanceScheduler):
    """Record the native scheduler's outcomes without changing its decisions."""

    def __init__(self, disturbances):
        super().__init__(disturbances)
        self.outcomes: list[IncidentEvidence] = [{"event_id": index, "source": event.get("_source", ""),
                          "source_index": event.get("_index"), "type": event["type"],
                          "scheduled_step": int(event["step"]), "status": "not_reached",
                          "on_map_exposure_steps": 0, "ready_exposure_steps": 0}
                         for index, event in enumerate(self.events)]
        self._event_indices = {id(event): index for index, event in enumerate(self.events)}
        self.exposure_steps: set[tuple[int, int]] = set()

    def _apply(self, env, event) -> bool:
        index = self._event_indices[id(event)]
        record = self.outcomes[index]
        handle = int(event["agent_handle"]) if event["type"] == "train_delay" else None
        if handle is not None:
            agent = env.agents[handle]
            record.update({"handle": handle, "target_state": agent.state.name,
                           "target_on_map": agent_position(agent) is not None,
                           "counter_before": int(agent.malfunction_handler.malfunction_down_counter),
                           "delay_steps": int(event["delay_steps"])})
        applied = super()._apply(env, event)
        record.update({"status": "applied" if applied else "skipped",
                       "attempted_step": int(env._elapsed_steps)})
        if handle is not None:
            record["counter_after"] = int(env.agents[handle].malfunction_handler.malfunction_down_counter)
            # Flatland ignores a new delay while the old malfunction is active.
            record["effect_changed"] = record["counter_after"] != record["counter_before"]
        return applied

    def record_exposure(self, env) -> None:
        """Count train steps exposed before execution, separately from injection."""
        now = int(env._elapsed_steps)
        for record in self.outcomes:
            if (record["type"] != "train_delay" or record["status"] != "applied"
                    or not record["effect_changed"]):
                continue
            if now >= record["attempted_step"] + record["delay_steps"]:
                continue
            agent = env.agents[record["handle"]]
            if agent.state == TrainState.DONE or agent.malfunction_handler.malfunction_down_counter <= 0:
                continue
            if agent_position(agent) is not None:
                record["on_map_exposure_steps"] += 1
            elif now >= int(agent.earliest_departure or 0):
                record["ready_exposure_steps"] += 1
            else:
                continue
            self.exposure_steps.add((now, record["handle"]))


class PFChEpisode:
    """Physical-step adapter with independent stop-order and departure evidence."""

    def __init__(self, case: PFChCase, observation_schema: str = SERVICE_OBSERVATION_SCHEMA):
        self.case = case
        self.observation_schema = observation_schema
        horizon = case.horizon
        if horizon is None and case.preset == "pf-ch-corridor-stops":
            from app.core.dispatcher import PREPARED_DEMOS

            demo_horizon = PREPARED_DEMOS["shift"]["max_episode_steps"]
            if not isinstance(demo_horizon, int):
                raise TypeError("PF-CH demo horizon must be an integer")
            horizon = demo_horizon
        self.env = create_env(scenario_preset_id=case.preset, max_episode_steps=horizon)
        self.handles = list(self.env.get_agent_handles())
        self.native_counter_increases: list[dict] = []
        self.native_positive_counter_steps: set[tuple[int, int]] = set()
        if not self.handles:
            raise ValueError("PF-CH episode has no trains")
        if case.departure_offsets and len(case.departure_offsets) != len(self.handles):
            raise ValueError("departure_offsets must contain one offset per train")
        for agent, offset in zip(self.env.agents, case.departure_offsets):
            self._shift_timetable(agent, int(offset))
        selected = copy.deepcopy(select_disturbances(case.preset, list(case.disturbance_ids)))
        selected.extend(parse_disturbance(payload) for payload in case.disturbances)
        for disturbance in selected:
            for event in disturbance["events"]:
                if int(event["step"]) < 1:
                    raise ValueError("live post-step disturbances require step >= 1")
                if event["type"] == "train_delay" and int(event["agent_handle"]) not in self.handles:
                    raise ValueError("disturbance references an unknown train")
        self.disturbances = selected
        self.session = SimpleNamespace(
            id=f"pf-ch-learning-{uuid.uuid4().hex}", env=self.env,
            policy="pf-ch-learning", dispatcher=None,
            last_observations=getattr(self.env, "_initial_obs", None),
            last_info=getattr(self.env, "_initial_info", None),
            disturbance_scheduler=_ObservedDisturbanceScheduler(selected),
            # recorder_for returns this inert recorder even if study logging is on.
            trajectory=SimpleNamespace(before_step=_ignore_recording, after_step=_ignore_recording),
        )
        from app.policies.learned.pf_ch_observation import OBSERVATION_SCHEMA as CONTEXT_SCHEMA
        from app.policies.learned.pf_ch_observation import PFChObservationBuilder

        self.builder: PFChObservationBuilder | FastTreeObsBuilder
        if observation_schema == "uc2-context-v1":
            self.builder = make_obs_builder(self.env, observation_schema=observation_schema)
        elif observation_schema == "pf-ch-relative-v1":
            from app.policies.learned.pf_ch_relative_observation import PFChRelativeObservationBuilder
            self.builder = PFChRelativeObservationBuilder()
            self.builder.reset(self.env)
        elif observation_schema == CONTEXT_SCHEMA:
            self.builder = PFChObservationBuilder()
            self.builder.reset(self.env)
        elif observation_schema in (SERVICE_OBSERVATION_SCHEMA, "ecml36-legacy-v0"):
            self.builder = make_obs_builder(self.env, observation_schema=observation_schema)
        else:
            raise ValueError(f"unsupported PF-CH observation schema: {observation_schema!r}")
        self._observed_at = -1
        self._observed_handles: set[int] = set()
        self._stops = {h: intermediate_stops(self.env.agents[h]) for h in self.handles}
        self._served = {h: set(served_stops(self.env, h)) for h in self.handles}
        self._violations: dict[int, set[str]] = {h: set() for h in self.handles}
        self._consumed_visit = dict.fromkeys(self.handles, False)
        self.events: list[dict] = []
        self._end_paid = False
        for agent in self.env.agents:
            h = int(agent.handle)
            if not agent.targets:
                self._violations[h].add("missing_targets")
            waypoints = getattr(agent, "waypoints", None)
            if waypoints is None:
                self._violations[h].add("missing_waypoints")
            elif {stop.index for stop in self._stops[h]} != set(range(1, len(waypoints) - 1)):
                self._violations[h].add("missing_stop_alternatives")

    @staticmethod
    def _shift_timetable(agent, offset: int) -> None:
        earliest = int(agent.earliest_departure or 0) + offset
        if earliest < 0:
            raise ValueError("departure offset moves a train before step zero")
        agent.earliest_departure = earliest
        if agent.latest_arrival is not None:
            agent.latest_arrival = int(agent.latest_arrival) + offset
        for attribute in ("waypoints_earliest_departure", "waypoints_latest_arrival"):
            times = getattr(agent, attribute, None)
            if times:
                setattr(agent, attribute, [None if value is None else int(value) + offset for value in times])

    @property
    def done(self) -> bool:
        return bool((self.env.dones or {}).get("__all__", False)) or self.now >= self.horizon

    @property
    def now(self) -> int:
        return int(self.env._elapsed_steps)

    @property
    def horizon(self) -> int:
        horizon = self.env._max_episode_steps
        if horizon is None:
            raise ValueError("PF-CH episode requires a declared horizon")
        return int(horizon)

    def observe(self, handles: Iterable[int] | None = None) -> tuple[np.ndarray, np.ndarray]:
        """Return the runtime's features and masks before the next physical step."""
        selected = self.handles if handles is None else list(handles)
        result = observe(self.builder, selected)
        if self._observed_at != self.now:
            self._observed_handles.clear()
        self._observed_at = self.now
        self._observed_handles.update(selected)
        return result

    def _leg_distance(self, handle: int) -> float | None:
        agent = self.env.agents[handle]
        configuration = _configuration(agent)
        if configuration is None:
            configuration = (getattr(agent, "target_configuration", None) if agent.state == TrainState.DONE
                             else (agent_initial_position(agent), agent_initial_direction(agent)))
        if configuration is None:
            return None
        position, direction = configuration
        distances = self.builder._get_distance_map(handle)
        value = float(distances[position[0], position[1], int(direction)])
        return value if math.isfinite(value) else None

    def _record_service(self, before: Mapping[int, Configuration | None]) -> None:
        for agent in self.env.agents:
            h = int(agent.handle)
            configuration = _configuration(agent)
            previous = before[h]
            if configuration != previous:
                self._consumed_visit[h] = False
            if agent.state == TrainState.DONE:
                configuration = getattr(agent, "target_configuration", None) or configuration
                if configuration is None or configuration not in agent.targets:
                    self._violations[h].add("invalid_arrival_configuration")
            if previous is None and configuration is not None and self.now < int(agent.earliest_departure or 0):
                self._violations[h].add("early_initial_departure")
            if previous is not None and configuration != previous:
                position, heading = previous
                for stop in self._stops[h]:
                    if (stop.matches(position[0], position[1], heading) and stop.earliest_departure is not None
                            and self.now < stop.earliest_departure):
                        self._violations[h].add(f"early_stop_departure:{stop.index}")
                self.events.append({"step": self.now, "handle": h, "event": "departure", "configuration": previous})
            if configuration is None or agent.state != TrainState.STOPPED or self._consumed_visit[h]:
                continue
            position, heading = configuration
            matching = [stop for stop in self._stops[h]
                        if stop.index not in self._served[h] and stop.matches(position[0], position[1], heading)]
            if matching:
                stop = matching[0]
                if any(s.index < stop.index and s.index not in self._served[h] for s in self._stops[h]):
                    self._violations[h].add(f"stop_order:{stop.index}")
                self._served[h].add(stop.index)
                self._consumed_visit[h] = True
                self.events.append({"step": self.now, "handle": h, "event": "served_call", "stop_index": stop.index})

    def _mission_complete(self, handle: int) -> bool:
        return (self.env.agents[handle].state == TrainState.DONE and not self._violations[handle]
                and all(stop.index in self._served[handle] for stop in self._stops[handle]))

    def step(self, actions: Mapping[int, int]) -> tuple[dict, dict[int, float], dict, dict]:
        """Execute one live-compatible step and return the shared PF-CH reward."""
        if self.done:
            raise RuntimeError("episode is already finished")
        active = [h for h in self.handles if self.env.agents[h].state != TrainState.DONE]
        missing = [h for h in active if self._observed_at != self.now or h not in self._observed_handles]
        if missing:
            self.observe(missing)
        before = {h: _configuration(self.env.agents[h]) for h in self.handles}
        distances = {h: self._leg_distance(h) for h in active}
        counts = {h: len(self._served[h]) for h in active}
        violations = {h: len(self._violations[h]) for h in active}
        malfunction_before = {h: int(self.env.agents[h].malfunction_handler.malfunction_down_counter)
                              for h in active}
        self.session.disturbance_scheduler.record_exposure(self.env)
        try:
            observations, _, dones, info = step_env(self.session.id, self.session, dict(actions))
        finally:
            notification_manager.clear_session(self.session.id)
        self._record_service(before)
        # Observe the native counters after execution. No future malfunction
        # schedule is read, changed or exposed to the policy. For locked UC2
        # cases there are no session injections, so these are the file's faults.
        for h in active:
            agent = self.env.agents[h]
            counter = int(agent.malfunction_handler.malfunction_down_counter)
            if counter > malfunction_before[h]:
                self.native_counter_increases.append({
                    "step": self.now, "handle": h,
                    "counter_before": malfunction_before[h], "counter_after": counter,
                    "on_map": agent_position(agent) is not None,
                    "state": int(agent.state),
                })
            if counter > 0 and agent_position(agent) is not None and agent.state != TrainState.DONE:
                self.native_positive_counter_steps.add((self.now, h))
        rewards = {}
        for h in active:
            agent = self.env.agents[h]
            reward = -TIME_COST if agent.state != TrainState.WAITING else 0.0
            distance = self._leg_distance(h)
            previous_distance = distances[h]
            if previous_distance is not None and distance is not None:
                reward += PROGRESS_PER_CELL * max(-1.0, min(1.0, previous_distance - distance))
            if not self._violations[h]:
                reward += CALL_BONUS * (len(self._served[h]) - counts[h])
                if self._mission_complete(h):
                    reward += MISSION_BONUS
            reward -= VIOLATION_COST * (len(self._violations[h]) - violations[h])
            rewards[h] = reward
        if all(self._mission_complete(h) for h in self.handles):
            for h in active:
                rewards[h] += TEAM_BONUS
        return observations, rewards, dones, info

    def episode_end_rewards(self) -> dict[int, float]:
        """Charge each incomplete mission once at the declared episode boundary."""
        if self._end_paid:
            return {}
        if not self.done:
            raise RuntimeError("terminal reward requested before episode end")
        self._end_paid = True
        return {h: -UNFINISHED_COST - MISSED_CALL_COST * sum(stop.index not in self._served[h] for stop in self._stops[h])
                for h in self.handles if not self._mission_complete(h)}

    def metrics(self) -> dict:
        """Report full obligations, including those skipped by an arrived train."""
        trains = [{"handle": h, "arrived": self.env.agents[h].state == TrainState.DONE,
                   "complete_mission": self._mission_complete(h),
                   "arrival_step": getattr(self.env.agents[h], "arrival_time", None),
                   "served_stops": sorted(self._served[h]),
                   "missed_stops": [s.index for s in self._stops[h] if s.index not in self._served[h]],
                   "violations": sorted(self._violations[h])} for h in self.handles]
        incidents = copy.deepcopy(self.session.disturbance_scheduler.outcomes)
        physical = [record for record in incidents if record["type"] != "warning"]
        return {"case_id": self.case.case_id, "case": self.case.to_dict(), "steps": self.now,
                "observation_schema": self.observation_schema,
                "incidents": incidents,
                "scheduled_incidents": len(physical),
                "applied_incidents": sum(record["status"] == "applied" for record in physical),
                "skipped_incidents": sum(record["status"] == "skipped" for record in physical),
                "unreached_incidents": sum(record["status"] == "not_reached" for record in physical),
                "exposed_train_delay_incidents": sum(record["on_map_exposure_steps"] + record["ready_exposure_steps"] > 0
                                                     for record in physical if record["type"] == "train_delay"),
                "train_delay_exposure_steps": len(self.session.disturbance_scheduler.exposure_steps),
                "observed_malfunction_counter_increases": copy.deepcopy(self.native_counter_increases),
                "native_on_map_positive_counter_steps": len(self.native_positive_counter_steps),
                "horizon": self.horizon, "total": len(self.handles),
                "arrived": sum(train["arrived"] for train in trains),
                "served_calls": sum(len(train["served_stops"]) for train in trains),
                "required_calls": sum(len(stops) for stops in self._stops.values()),
                "complete_mission": all(train["complete_mission"] for train in trains),
                "completed_missions": sum(train["complete_mission"] for train in trains),
                "lateness": total_lateness(self.env), "trains": trains,
                "violations": {str(train["handle"]): train["violations"] for train in trains if train["violations"]},
                "terminated": all(agent.state == TrainState.DONE for agent in self.env.agents),
                "truncated": self.done and not all(agent.state == TrainState.DONE for agent in self.env.agents)}

    def close(self) -> None:
        """Release this offline episode's retained planner/native resources.

        Native method LRUs are process-wide: clearing drops other envs' cache
        warmth, but not their rail, physics, observations or model state.
        """
        from app.core.native_env_cache import clear_native_environment_caches
        from app.policies.goal_directed_policy import forget_env

        notification_manager.clear_session(self.session.id)
        forget_env(self.env)
        clear_native_environment_caches()
