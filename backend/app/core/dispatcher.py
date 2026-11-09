"""Deterministic operator strategies on the existing HMI commands.

One session-owned runtime advances only from the simulation driver. A decision
pulse precedes a Flatland step; Recommendation holds that step while a response
is pending. Browser reads never advance either clock.
"""
from __future__ import annotations

import json
import math
from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from threading import RLock
from time import monotonic_ns
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.contention_identity import contention_identity
from app.core.director_objectives import DIRECTOR_STRATEGY_PRESETS

PROFILE_VERSION = "1"
DEMO_SETUP = {
    "scenario_preset_id": "pf-ch-wn-wal-long-approach",
    "disturbance_ids": ["strategy-e1-breakdown-weesen"],
}
PROFILES = {
    "baseline": {"modes": ["recommendation", "director"], "capability": "preferred-strategy-or-directive"},
    "delayed": {"modes": ["recommendation", "director"], "capability": "logical-response-delay"},
    "priority": {"modes": ["recommendation", "director"], "capability": "pp-order-or-director-objective"},
    "goal-switch": {"modes": ["director"], "capability": "replace-global-directive"},
}
ORIGIN: ContextVar[str] = ContextVar("dispatcher_origin", default="human")
AXES = ("punctuality", "connections", "stability")
TERMINAL_RUNS = ("finished", "error", "aborted")


class Directive(BaseModel):
    """The three existing Director dials; zero total has no defined objective."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    punctuality: float = Field(default=1, ge=0, le=5)
    connections: float = Field(default=1, ge=0, le=5)
    stability: float = Field(default=1, ge=0, le=5)

    @model_validator(mode="after")
    def nonzero(self):
        if not sum(self.model_dump().values()):
            raise ValueError("At least one Director weight must be positive")
        return self


class DispatcherConfig(BaseModel):
    """Immutable measurement condition, separate from policy and mode."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    profile: Literal["baseline", "delayed", "priority", "goal-switch"] = "baseline"
    delay: int = Field(default=3, ge=1, le=100)
    priority: tuple[int, ...] = ()
    objective: Literal["punctuality", "connections", "stability"] = "punctuality"
    initial: Directive = Field(default_factory=Directive)
    switched: Directive = Field(default_factory=lambda: Directive(punctuality=5, connections=1, stability=1))
    switch_at: int = Field(default=10, ge=2, le=10000)
    comparison: bool = False

    @model_validator(mode="after")
    def valid_order(self):
        if len(set(self.priority)) != len(self.priority) or any(h < 0 for h in self.priority):
            raise ValueError("Train priority must contain unique non-negative handles")
        if self.comparison and self.profile != "goal-switch":
            raise ValueError("Prepared comparison requires the goal-switch profile")
        return self


PREPARED_DEMOS = {
    "recommendation": {
        **DEMO_SETUP, "interaction_mode": "recommendation", "seed": 42,
        "dispatcher": DispatcherConfig(profile="delayed", delay=3).model_dump(),
        "open_at_step": 14, "play_speed_level": 3,
    },
    "director": {
        "scenario_preset_id": DEMO_SETUP["scenario_preset_id"], "disturbance_ids": [],
        "interaction_mode": "director", "seed": 42,
        "dispatcher": DispatcherConfig(profile="goal-switch", switch_at=2, comparison=True,
                                       initial=Directive(**DIRECTOR_STRATEGY_PRESETS[2]["weights"]),
                                       switched=Directive(**DIRECTOR_STRATEGY_PRESETS[0]["weights"])).model_dump(),
        "open_at_step": 1, "play_speed_level": 3,
    },
}
PREPARED_DEMOS["team"] = {
    **PREPARED_DEMOS["recommendation"],
    "operator_type": "human_dispatcher_team",
    "dispatcher": DispatcherConfig(profile="baseline").model_dump(),
}
PREPARED_DEMOS["shift"] = {
    "scenario_preset_id": "pf-ch-corridor-stops",
    "disturbance_ids": ["corridor-shift-incidents"],
    "interaction_mode": "recommendation", "seed": 42,
    "dispatcher": DispatcherConfig(profile="baseline").model_dump(),
    "open_at_step": 1, "play_speed_level": 5,
    "max_episode_steps": 320, "malfunction_rate": 0,
}
PREPARED_DEMOS["shift-team"] = {
    **PREPARED_DEMOS["shift"], "operator_type": "human_dispatcher_team",
    "play_speed_level": 3,
}


def identity(value) -> str:
    """Stable semantic reference; elapsed time alone never expires a choice."""
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:20]


def alternative_identity(option: dict) -> str:
    """Bind the offered action/order; changing scores alone does not expire it."""
    return identity({key: option.get(key) for key in ("id", "priority", "passOrder")})


def equivalent_objectives(first, second) -> bool:
    """The existing controller normalises dials: common scaling is no new goal."""
    if not first or not second or len(first) != len(second) or sum(first) <= 0 or sum(second) <= 0:
        return False
    return all(math.isclose(a / sum(first), b / sum(second), rel_tol=1e-9, abs_tol=1e-12)
               for a, b in zip(first, second))


def capture_provenance() -> dict:
    """Capture run-start file versions once; later exports cannot relabel evidence."""
    from importlib.metadata import version
    backend = Path(__file__).resolve().parents[1]
    code = sha256()
    for path in sorted(backend.rglob("*.py")):
        code.update(str(path.relative_to(backend)).encode())
        code.update(path.read_bytes())
    captured_at = datetime.now(timezone.utc).isoformat()  # noqa: UP017 - Python 3.10 support
    return {"code_version": code.hexdigest(), "controller_version": code.hexdigest(),
            "controller_models": {p.name: sha256(p.read_bytes()).hexdigest()
                                  for p in sorted((backend.parent / "models" / "goal_directed").glob("*.ckpt"))},
            "flatland_version": version("flatland-rl"),
            "provenance": {"captured_at": captured_at, "capture": "runtime_creation"}}


def require_human(session) -> None:
    """Reject competing manual actuation without an explicit handover."""
    runtime = getattr(session, "dispatcher", None)
    if runtime and runtime.owner == "agent" and ORIGIN.get() == "human":
        raise HTTPException(409, {"reason": "dispatcher_owns_role", "action": "take_over_first"})


class DispatcherRuntime:
    """A single pending decision with generation and command deduplication."""

    def __init__(self, session, config: DispatcherConfig, mode: str, *, operator_type="synthetic_dispatcher"):
        if config.comparison and (mode != "director" or operator_type != "synthetic_dispatcher"):
            raise ValueError("Prepared comparison requires a synthetic Director dispatcher")
        self.operator_type = operator_type
        self.neutral_observer = operator_type == "human_dispatcher_team" and mode == "co-learning"
        self.requires_approval = operator_type == "human_dispatcher_team" and not self.neutral_observer
        if self.neutral_observer and config.profile != "baseline":
            raise ValueError("Co-Learning partners only observe neutrally")
        if not self.neutral_observer and mode not in PROFILES[config.profile]["modes"]:
            raise ValueError(f"Profile {config.profile} is not supported in {mode}")
        if any(h >= len(session.env.agents) for h in config.priority):
            raise ValueError("Train priority refers to a train outside this session")
        self.config, self.mode = config, mode
        self.session_id = session.id
        self._started_ns = monotonic_ns()
        self.provenance = capture_provenance()
        self.initial_policy = None
        self._frozen_policy = None
        self._frozen_elapsed_ms = None
        from app.core.contention_strategies import _reference_arrivals
        from app.policies.plan_policy import planned_arrival_steps
        authored_arrivals = planned_arrival_steps(session.env)
        self.planned_arrivals = authored_arrivals or _reference_arrivals(session.env)
        self.arrival_reference_source = "authored_plan" if authored_arrivals else "latest_arrival" if self.planned_arrivals else "unavailable"
        self.owner = "human" if self.neutral_observer else "agent"
        self.generation = 0
        self.clock = 0
        self.status = "paused"
        self.lock = RLock()
        self.pending = None
        self.comparison = None
        self.observation = None
        self.events: list[dict] = []
        self.results: dict[str, dict] = {}
        self.approvals: dict[str, dict] = {}
        self.approved_command_id: str | None = None
        self.answered: set[str] = set()
        self.unavailable: set[str] = set()
        self._unavailable_at = None
        self.opportunity_ids: set[str] = set()
        self.directives: set[str] = set()
        self.effective: set[str] = set()
        self.arrivals: dict[int, int] = {}
        self.queue: list[dict] = []
        self.effects: dict[str, dict] = {}
        self._visible_contentions: set[str] = set()
        self._forecast_simulation_time = None
        self.mixed = False
        self.run_status = "ready"
        self.abort_reason = None
        self._frozen_metrics: dict | None = None
        self._frozen_simulation_result: str | None = None
        self.event(session, "configured", source="system", config=config.model_dump(), mode=mode, operator_type=operator_type)
        if config.profile == "goal-switch":
            self.event(session, "goal_change_scheduled", due=config.switch_at, weights=config.switched.model_dump())

    def event(self, session, kind: str, source=None, **data) -> dict:
        """Append an immutable event with both clocks and its actual origin."""
        row = {"seq": len(self.events), "kind": kind, "source": source or self.command_origin,
               "generation": self.generation, "logical_time": self.clock,
               "simulation_time": int(session.env._elapsed_steps), "elapsed_ms": self.elapsed_ms, **deepcopy(data)}
        self.events.append(row)
        return row

    @property
    def elapsed_ms(self) -> int:
        return (monotonic_ns() - self._started_ns) // 1_000_000

    @property
    def command_origin(self) -> str:
        return "digital_shift_partner" if self.operator_type == "human_dispatcher_team" else "synthetic_dispatcher"

    @property
    def awaiting_approval(self) -> bool:
        return bool(self.requires_approval and self.pending and self.approved_command_id != self.pending["command_id"])

    def freeze_measurements(self, session) -> None:
        """Seal the old run before a reset or subsequent manual operation."""
        if self._frozen_metrics is None:
            self._frozen_metrics = self.metrics(session)
            self._frozen_simulation_result = self.simulation_result(session)
            self._frozen_policy = getattr(session, "policy", None)
            self._frozen_elapsed_ms = self.elapsed_ms

    def simulation_result(self, session) -> str:
        if self._frozen_simulation_result is not None:
            return self._frozen_simulation_result
        if len(self.arrivals) == len(session.env.agents):
            return "all_arrived"
        horizon = int(getattr(session.env, "_max_episode_steps", 0) or 0)
        if horizon > 0 and int(session.env._elapsed_steps) >= horizon:
            return "horizon"
        return "unfinished"

    def invalidate(self, session, reason: str, *, human=False) -> None:
        """Invalidate immediately; a later hand-back starts from observation."""
        with self.lock:
            if self.comparison is not None:
                self.comparison.cancel(session, reason)
            self.generation += 1
            if self.pending:
                self.finish(session, self.pending, "cancelled", reason)
            self.pending = None
            self.approved_command_id = None
            self._refresh_queue()
            if human:
                self.owner = "human"
                self.mixed = True
                self.status = "human_control"
            else:
                self.status = "stopped"
            self.event(session, reason, source="human" if human else "system")
            if reason in ("reset", "stop", "mode_change", "restart", "session_end", "pulse_limit", "run_error"):
                self.freeze_measurements(session)

    def validate_hand_back(self, session) -> None:
        """Check delegation before signalling any playback cancellation."""
        if self.run_status in TERMINAL_RUNS:
            raise HTTPException(409, "Start a new run before delegating again")
        if self.neutral_observer:
            raise HTTPException(409, "Co-Learning partner is a neutral observer; decisions remain human")
        if self.owner != "agent" and self.mode == "director":
            from app.policies.goal_directed_policy import loaded_models
            if "goal_directed" not in session.enabled_policy_ids or loaded_models() is None:
                raise HTTPException(409, "Director delegation requires the enabled objective-aware goal_directed controller")

    def hand_back(self, session) -> None:
        """Explicit fresh delegation, with no resurrection of cancelled work."""
        with self.lock:
            self.validate_hand_back(session)
            if self.owner == "agent":
                return
            if self.comparison is not None:
                self.comparison.cancel(session, "hand_back")
            if self.mode == "director":
                from app.api.sessions import _invalidate_scenario_forecasts
                session.policy = "goal_directed"
                _invalidate_scenario_forecasts(session.id)
            self.generation += 1
            self.owner, self.status = "agent", "paused"
            self.pending = None
            self.approved_command_id = None
            self.answered.clear()
            self.unavailable.clear()
            self.directives.clear()
            self.event(session, "hand_back", source="human")

    def decide(self, session, command_id: str, generation: int, decision: str) -> None:
        """Record real human consent; the driver executes on a later pulse."""
        with self.lock:
            if decision not in ("approve", "decline"):
                raise HTTPException(422, "Decision must be approve or decline")
            if not self.requires_approval:
                raise HTTPException(409, "This dispatcher does not accept human proposal approvals")
            if generation != self.generation or self.owner != "agent" or self.run_status in TERMINAL_RUNS:
                raise HTTPException(409, "Proposal ownership or generation changed")
            previous = self.approvals.get(command_id)
            receipt = {"command_id": command_id, "generation": generation, "decision": decision}
            if previous is not None:
                if any(previous.get(key) != value for key, value in receipt.items()):
                    raise HTTPException(409, "A different response was already recorded for this proposal")
                return
            if not self.pending or self.pending["command_id"] != command_id or self.pending["generation"] != generation:
                raise HTTPException(409, "No matching pending proposal")
            receipt["elapsed_ms"] = self.elapsed_ms
            self.approvals[command_id] = receipt
            self.event(session, "human_decision", source="human", **receipt)
            if decision == "approve":
                self.approved_command_id = command_id
            else:
                command = self.pending["command"]
                if command["kind"] == "strategy":
                    self.answered.add(command["situation"])
                elif command["kind"] == "directive":
                    self.directives.add(command["phase"])
                self.finish(session, self.pending, "declined", "human_declined")
                self.pending = None
                self.approved_command_id = None
                if self.status != "paused":
                    self.status = "waiting"
                self._refresh_queue()

    def _refresh_queue(self) -> None:
        pending_id = self.pending["command"].get("contention_id") if self.pending else None
        for entry in self.queue:
            entry["status"] = "pending" if entry["contention_id"] == pending_id else (
                "answered" if entry["contention_id"] in self.answered else (
                    "unavailable" if entry["contention_id"] in self.unavailable else "queued"))

    def observe(self, session) -> dict:
        """Only operator-visible HMI data enters selection."""
        if self.mode == "director":
            from app.policies.goal_directed_policy import env_weights
            return {"mode": self.mode, "weights": list(env_weights(session.env)), "open_decisions": 0}
        from app.api.hmi import get_contentions
        groups = get_contentions(session.id).get("groups") or []
        forecast_revision = (int(session.env._elapsed_steps), getattr(session, "control_revision", 0))
        if forecast_revision != self._unavailable_at:
            self.unavailable.clear()
            self._unavailable_at = forecast_revision
        self._visible_contentions = {contention_identity(group) for group in groups}
        self._forecast_simulation_time = int(session.env._elapsed_steps)
        self.answered.intersection_update(self._visible_contentions)
        self.unavailable.intersection_update(self._visible_contentions)
        self.queue = [{"contention_id": contention_identity(group), "handles": list(group["handles"]),
                       "location": deepcopy(group.get("location")), "forecast_step": group.get("step"), "status": "queued"}
                      for group in groups]
        self._refresh_queue()
        for effect in self.effects.values():
            if effect.get("contention_id"):
                effect["contention_observation"] = {
                    "status": "visible" if effect["contention_id"] in self._visible_contentions else "not_visible",
                    "simulation_time": self._forecast_simulation_time}
        if not self.neutral_observer:
            self.opportunity_ids.update(self._visible_contentions)
        if self.neutral_observer:
            return {"mode": self.mode, "open_decisions": len(groups), "neutral": True,
                    "handles": sorted({int(h) for group in groups for h in group["handles"]})}
        from app.core.contention_strategies import contention_strategies
        if not groups:
            self.answered.clear()
            return {"mode": self.mode, "open_decisions": 0, "alternatives": []}
        pending_id = self.pending["command"].get("contention_id") if self.pending else None
        candidates = [group for group in groups if contention_identity(group) == pending_id] if pending_id else [
            group for group in groups if contention_identity(group) not in self.answered | self.unavailable]
        for group in candidates:
            reference_id = contention_identity(group)
            handles = [int(h) for h in group["handles"]]
            order = [h for h in self.config.priority if h in handles]
            priority_available = bool(order)
            order += sorted(h for h in handles if h not in order)
            payload = contention_strategies(session.id, session, order if self.config.profile == "priority" else None,
                                           contention_id=reference_id)
            # Same public scored options; no new forecast/planner for explanation.
            alternatives = [{key: option.get(key) for key in ("id", "priority", "metrics", "passOrder")}
                            for option in payload.get("strategies", [])]
            observation = {"mode": self.mode, "open_decisions": len(groups), "handles": handles,
                           "situation": reference_id, "contention_id": reference_id,
                           "location": deepcopy(group.get("location")), "forecast_step": group.get("step"),
                           "horizon_steps": payload.get("horizonSteps"), "preferred": payload.get("recommended"),
                           "alternatives": alternatives, "priority_available": priority_available,
                           "strategy_offer": deepcopy(payload)}
            if pending_id or self.choose(observation)[0] is not None:
                return observation
            self.unavailable.add(reference_id)
            self.event(session, "contention_unavailable", contention_id=reference_id, reason="no_valid_offered_strategy")
            self._refresh_queue()
        return {"mode": self.mode, "open_decisions": len(groups), "alternatives": []}

    def choose(self, obs: dict) -> tuple[dict | None, str, str | None]:
        """Reusable selection, delay and goal schedule; no UI dependencies."""
        cfg = self.config
        if self.mode == "director":
            phase = "switched" if cfg.profile == "goal-switch" and self.clock >= cfg.switch_at else "initial"
            if phase in self.directives:
                return None, "standing_directive", None
            weights = (cfg.switched if phase == "switched" else cfg.initial).model_dump()
            if cfg.profile == "priority":
                weights = {axis: 5 if axis == cfg.objective else 1 for axis in AXES}
            return {"kind": "directive", "phase": phase, "weights": weights}, "explicit_directive", None
        if not obs.get("alternatives") or obs["situation"] in self.answered:
            return None, "no_new_situation", None
        selected = obs["preferred"]
        rule, fallback = "preferred_strategy", None
        if cfg.profile == "priority":
            custom = next((s for s in obs["alternatives"] if s["id"] == "pp-human"), None)
            if obs["priority_available"] and custom:
                selected, rule = custom["id"], "explicit_pp_train_order"
            else:
                fallback = "priority_not_available_use_preferred"
        option = next((s for s in obs["alternatives"] if s["id"] == selected), None)
        if not option:
            return None, "no_valid_preferred_strategy", "missing_preferred_option"
        return {"kind": "strategy", "strategy": selected, "priority": option["priority"],
                "situation": obs["situation"], "contention_id": obs.get("contention_id"),
                "option": alternative_identity(option), "handles": obs["handles"]}, rule, fallback

    def explanation(self, command: dict, obs: dict, rule: str, fallback) -> dict:
        if command["kind"] == "directive":
            return {"kind": "director_objective", "rule": rule, "fallback": fallback,
                    "weights": [command["weights"][axis] for axis in AXES]}
        selected = next(option for option in obs["alternatives"] if option["id"] == command["strategy"])
        baseline = next((option for option in obs["alternatives"] if option["id"] == "keep"), {})
        chosen_metrics, baseline_metrics = selected.get("metrics") or {}, baseline.get("metrics") or {}
        return {"kind": "forecast_comparison", "rule": rule, "fallback": fallback,
                "contention_id": command.get("contention_id"), "location": deepcopy(obs.get("location")),
                "forecast_step": (obs.get("strategy_offer") or {}).get("step", obs.get("simulation_time")),
                "conflict_step": obs.get("forecast_step"), "horizon_steps": obs.get("horizon_steps"),
                "forecast_reference": deepcopy((obs.get("strategy_offer") or {}).get("forecast_reference")),
                "selected_strategy": command["strategy"], "baseline_metrics": deepcopy(baseline_metrics),
                "selected_metrics": deepcopy(chosen_metrics),
                "forecast_delta": {key: chosen_metrics[key] - baseline_metrics[key]
                                   for key in chosen_metrics.keys() & baseline_metrics.keys()
                                   if isinstance(chosen_metrics[key], (int, float)) and isinstance(baseline_metrics[key], (int, float))}}

    def finish(self, session, decision: dict, status: str, reason: str, **details) -> dict:
        """Record one terminal processing result for the original command."""
        result = {"command_id": decision["command_id"], "status": status, "reason": reason, **details}
        self.results[decision["command_id"]] = result
        self.event(session, "result", decision=decision, result=result)
        if status == "rejected" and decision["command"].get("situation"):
            self.answered.add(decision["command"]["situation"])
        return result

    def execute(self, session, decision: dict, obs: dict) -> dict:
        """Revalidate the original reference and reuse the human command path."""
        with self.lock:
            if decision["command_id"] in self.results:
                return self.results[decision["command_id"]]
            if decision.get("session_id") != session.id or session.id != self.session_id:
                return self.finish(session, decision, "rejected", "wrong_session")
            if decision["generation"] != self.generation or self.owner != "agent":
                return self.finish(session, decision, "cancelled", "ownership_or_generation_changed")
            original = next((e["decision"] for e in self.events if e["kind"] == "planned"
                             and e["decision"]["command_id"] == decision["command_id"]), None)
            if original is None or decision != original:
                return self.finish(session, decision, "rejected", "unknown_or_mutated_command")
            if self.run_status in TERMINAL_RUNS:
                return self.finish(session, decision, "cancelled", "run_ended")
            if self.requires_approval and self.approved_command_id != decision["command_id"]:
                return {"status": "awaiting_approval", "command_id": decision["command_id"]}
            if self.clock < decision["due"]:
                return {"status": "pending", "command_id": decision["command_id"]}
            command = decision["command"]
            if command.get("kind") not in ("strategy", "directive"):
                return self.finish(session, decision, "unsupported", "unknown_command_kind")
            if command["kind"] == "strategy":
                options = obs.get("alternatives", [])
                match = next((o for o in options if o["id"] == command["strategy"]), None)
                if obs.get("situation") != command["situation"] or not match or alternative_identity(match) != command["option"] or command.get("priority") != match.get("priority"):
                    return self.finish(session, decision, "stale", "original_alternative_changed")
            token = ORIGIN.set(self.command_origin)
            try:
                details = {"observed_before": self.observed_metrics(session)}
                if command["kind"] == "strategy":
                    from app.api.hmi import StrategyApplyRequest, post_contention_strategy
                    result = post_contention_strategy(session.id, StrategyApplyRequest(
                        strategy=command["strategy"], priority=command["priority"], mode=self.mode,
                        contention_id=command.get("contention_id")))
                    self.answered.add(command["situation"])
                else:
                    from app.api.sessions import DirectorWeightsRequest, set_director_weights_for_session
                    from app.policies.goal_directed_policy import env_weights
                    details["previous_weights"] = list(env_weights(session.env))
                    result = set_director_weights_for_session(session.id, DirectorWeightsRequest(**command["weights"], plan=True))
                    self.directives.add(command["phase"])
                    if not result.get("replanned") or str((result.get("plan") or {}).get("source", "")).startswith(("avoidance", "pp (no models)")):
                        self.status = "error"
                        self.run_status = "error"
                        self.abort_reason = "director_plan_unavailable"
                        terminal = self.finish(session, decision, "unsupported", "director_plan_unavailable", response=result)
                        self.freeze_measurements(session)
                        return terminal
                    # Controller uptake is checked after act_many / env.step,
                    # separately from acceptance of the weights command.
                self.status = "executed"
                return self.finish(session, decision, "executed", "accepted", response=result,
                                   response_ticks=self.clock - decision["observed_at"], **details)
            except HTTPException as exc:
                self.status = "rejected"
                return self.finish(session, decision, "rejected", "domain_rejected", detail=exc.detail)
            finally:
                ORIGIN.reset(token)

    def pulse(self, session) -> bool:
        """Return whether Flatland may advance on this logical decision pulse."""
        with self.lock:
            if self.run_status in TERMINAL_RUNS:
                return self.owner == "human"
            if self.owner != "agent" and not self.neutral_observer:
                return True
            if self.comparison is not None and self.comparison.held:
                return False
            self.run_status = "running"
            if self.initial_policy is None:
                self.initial_policy = getattr(session, "policy", None)
            self.clock += 1
            obs = self.observe(session)
            history = [{"kind": e["kind"], "logical_time": e["logical_time"],
                        "simulation_time": e["simulation_time"], "source": e["source"],
                        "command": e.get("decision", {}).get("command"),
                        "status": e.get("result", {}).get("status"),
                        "reason": e.get("result", {}).get("reason")}
                       for e in self.events if e["kind"] in ("result", "takeover", "human_command", "directive_effective")][-8:]
            obs = {"session_id": session.id, "generation": self.generation,
                   "logical_time": self.clock, "simulation_time": int(session.env._elapsed_steps),
                   "allowed_commands": [] if self.neutral_observer else ["directive" if self.mode == "director" else "strategy"],
                   "history": history, **obs}
            self.observation = obs
            if self.neutral_observer:
                if self.status != "observing":
                    self.status = "observing"
                    self.event(session, "observing", observation=obs)
                return True
            if not self.pending:
                command, rule, fallback = self.choose(obs)
                if obs.get("alternatives"):
                    self.opportunity_ids.add(obs["situation"])
                if command and command["kind"] == "directive":
                    self.opportunity_ids.add("directive:" + command["phase"])
                if command:
                    command_id = f"g{self.generation}-d{len(self.events)}"
                    if self.requires_approval:
                        command_id = f"{session.id}:{command_id}"
                    self.pending = {"session_id": session.id, "command_id": command_id,
                                    "generation": self.generation, "command": command,
                                    "observed_at": self.clock, "elapsed_ms": self.elapsed_ms,
                                    "due": self.clock + (self.config.delay if self.config.profile == "delayed" else 0),
                                    "reason": {"rule": rule, "fallback": fallback},
                                    "explanation": self.explanation(command, obs, rule, fallback)}
                    if command["kind"] == "strategy":
                        self.pending["offer"] = deepcopy(obs.get("strategy_offer"))
                    self.status = "planned"
                    self.approved_command_id = None
                    self.event(session, "planned", observation={"session_id": session.id, "generation": self.generation,
                               "logical_time": self.clock, "simulation_time": int(session.env._elapsed_steps), **obs}, decision=self.pending)
                elif self.status != "waiting":
                    self.status = "waiting"
                    self.event(session, "waiting", observation=obs, rule=rule)
            if (self.config.comparison and not self.mixed and self.pending
                    and self.pending["command"].get("phase") == "switched"):
                from app.core.director_comparison import DirectorComparison
                self.comparison = DirectorComparison(session, self.pending)
                self.event(session, "comparison_waiting", command_id=self.pending["command_id"])
                return False
            if self.pending and self.clock >= self.pending["due"] and not self.awaiting_approval:
                self.execute(session, self.pending, obs)
                self.pending = None
                self.approved_command_id = None
            self._refresh_queue()
            return self.run_status != "error" and not (self.mode == "recommendation" and self.pending)

    def after_step(self, session, done: bool) -> None:
        """Evaluator records arrivals and independently checks plan uptake."""
        if self.run_status in TERMINAL_RUNS:
            return
        for handle, agent in enumerate(session.env.agents):
            if getattr(agent.state, "name", "") == "DONE":
                self.arrivals.setdefault(handle, int(session.env._elapsed_steps))
        if self.mode == "director" and session.policy == "goal_directed":
            from app.policies.goal_directed_policy import plan_info, plan_player
            info = plan_info(session.env)
            for command_id, result in list(self.results.items()):
                if result["status"] != "executed" or command_id in self.effective:
                    continue
                event = next(e for e in self.events if e["kind"] == "result" and e["result"]["command_id"] == command_id)
                command = event["decision"]["command"]
                weights = [command["weights"][a] for a in AXES]
                if info and info.get("weights") == weights and plan_player(session.env) is not None:
                    self.effective.add(command_id)
                    self.event(session, "directive_effective", source="dispatching_ai", command_id=command_id, phase=command["phase"],
                               weights=weights, plan_source=info.get("source"),
                               goal_changed=not equivalent_objectives(result.get("previous_weights"), weights))
        self.update_effects(session, done)
        if done:
            self.invalidate(session, "episode_end")
            self.run_status = "finished"
            self.freeze_measurements(session)

    def observed_metrics(self, session) -> dict:
        delays = [max(0, arrival - self.planned_arrivals[handle]) for handle, arrival in self.arrivals.items()
                  if handle in self.planned_arrivals]
        return {"arrived": len(self.arrivals), "simulation_steps": int(session.env._elapsed_steps),
                "total_arrival_delay": sum(delays) if delays else None, "delay_denominator": len(delays)}

    def update_effects(self, session, done=False) -> None:
        after = self.observed_metrics(session)
        executed = [(command_id, result) for command_id, result in self.results.items() if result["status"] == "executed"]
        for index, (command_id, result) in enumerate(executed):
            event = next(event for event in self.events if event["kind"] == "result" and event["result"]["command_id"] == command_id)
            command = event["decision"]["command"]
            before = result.get("observed_before", after)
            effect = {"command_id": command_id, "contention_id": command.get("contention_id"),
                      "scope": "observed_since_command", "causal_claim": False,
                      "before": deepcopy(before), "after": deepcopy(after),
                      "delta": {key: after[key] - before[key] if after[key] is not None and before[key] is not None else None for key in after},
                      "intervening_commands": len(executed) - index - 1}
            if command.get("contention_id") and self._forecast_simulation_time is not None:
                effect["contention_observation"] = {"status": "visible" if command["contention_id"] in self._visible_contentions else "not_visible",
                                                    "simulation_time": self._forecast_simulation_time}
            previous = self.effects.get(command_id)
            self.effects[command_id] = effect
            if previous is None or (index == len(executed) - 1 and (previous["after"]["arrived"] != after["arrived"] or done)):
                self.event(session, "effect_observed", source="environment", effect=effect)

    def metrics(self, session) -> dict:
        """Count terminal commands and evaluate arrivals against the original timetable."""
        if self._frozen_metrics is not None:
            return deepcopy(self._frozen_metrics)
        reference = self.planned_arrivals
        delays = [max(0, arrival - reference[h]) for h, arrival in self.arrivals.items() if h in reference]
        results = list(self.results.values())
        responses = [r["response_ticks"] for r in results if r.get("status") == "executed"]
        return {"opportunities": len(self.opportunity_ids),
                "planned": len([e for e in self.events if e["kind"] == "planned"]),
                **{status: sum(r["status"] == status for r in results)
                   for status in ("executed", "stale", "rejected", "cancelled", "unsupported", "declined")},
                "response_ticks": responses, "mean_response_ticks": sum(responses) / len(responses) if responses else None,
                "effective_directives": len(self.effective),
                "effective_goal_changes": sum(e["kind"] == "directive_effective" and e.get("phase") == "switched" and e.get("goal_changed", False) for e in self.events), "arrived": len(self.arrivals),
                "total_trains": len(session.env.agents), "simulation_steps": int(session.env._elapsed_steps),
                "total_arrival_delay": sum(delays) if delays else None, "delay_denominator": len(delays)}

    def snapshot(self, session, *, full=False) -> dict:
        """Project runtime data; live history is bounded, exports retain every event."""
        with self.lock:
            return {"operator_type": self.operator_type if self.operator_type == "human_dispatcher_team" else "mixed" if self.mixed else self.operator_type,
                    "owner": self.owner, "mixed": self.mixed,
                    "requires_approval": self.requires_approval, "awaiting_approval": self.awaiting_approval,
                    "approved_command_id": self.approved_command_id,
                    "profile": self.config.profile, "profile_version": PROFILE_VERSION, "mode": self.mode,
                    "config": self.config.model_dump(), "generation": self.generation, "logical_time": self.clock,
                    "status": self.status, "run_status": self.run_status, "abort_reason": self.abort_reason,
                    "arrival_reference_source": self.arrival_reference_source,
                    "pending": deepcopy(self.pending), "observation": deepcopy(self.observation),
                    "comparison": self.comparison.snapshot() if self.comparison is not None else None,
                    "elapsed_ms": self.elapsed_ms, "queue": deepcopy(self.queue), "effects": deepcopy(list(self.effects.values())),
                    "last_result": deepcopy(next((event for event in reversed(self.events) if event["kind"] == "result"), None)),
                    "last_effective": deepcopy(next((event for event in reversed(self.events) if event["kind"] == "directive_effective"), None)),
                    "summary": {"run_status": self.run_status, "simulation_result": self.simulation_result(session),
                                "policy": self._frozen_policy if self._frozen_metrics is not None else getattr(session, "policy", None),
                                "elapsed_ms": self._frozen_elapsed_ms if self._frozen_elapsed_ms is not None else self.elapsed_ms,
                                "metrics": self.metrics(session), "causal_claim": False},
                    "metrics": self.metrics(session), "events": deepcopy(self.events if full else self.events[-30:])}


def before_step(session) -> bool:
    """Inert for human sessions; one backend-owned pulse for synthetic runs."""
    runtime = getattr(session, "dispatcher", None)
    if runtime is None:
        return True
    try:
        return runtime.pulse(session)
    except Exception as exc:
        # Execution boundary: retain failed runs, then preserve the API error.
        runtime.invalidate(session, "run_error")
        runtime.status = "error"
        runtime.run_status = "error"
        runtime.abort_reason = f"{type(exc).__name__}: {exc}"
        raise


def after_step(session, dones) -> None:
    """Hook shared by Play, single-step and batch evaluation."""
    runtime = getattr(session, "dispatcher", None)
    if runtime:
        runtime.after_step(session, bool(dones.get("__all__")))


def export_run(session) -> dict:
    """Extend the existing study session folder with the operator timeline."""
    from app import __version__
    from app.core.study_paths import session_dir
    runtime = session.dispatcher
    payload = {"schema": "flatland-synthetic-dispatcher", "version": 1,
               "session_id": session.id, "app_version": __version__, **deepcopy(runtime.provenance),
               "simulation_result": runtime.simulation_result(session),
               "technical_result": "error" if runtime.run_status == "error" else "complete" if runtime.run_status == "finished" else "incomplete",
               "creation_config": getattr(session, "creation_config", None),
               "scenario_version": getattr(session, "scenario_version", None),
               "replan_execution": "synchronous-logical-boundary" if runtime.mode == "director" else "existing-controller",
               "seed": session.seed, "scenario": session.scenario_preset_id,
               "disturbances": session.disturbances,
               "policy": runtime._frozen_policy if runtime._frozen_metrics is not None else session.policy,
               "policy_at_start": runtime.initial_policy,
               "current_policy": session.policy, "measurement_frozen": runtime._frozen_metrics is not None,
               "arrival_reference": {"source": runtime.arrival_reference_source,
                                     "reference_steps": deepcopy(runtime.planned_arrivals),
                                     "actual_arrival_steps": deepcopy(runtime.arrivals)},
               "clock": "one logical pulse before each attempted Flatland step; Recommendation holds while pending",
               **runtime.snapshot(session, full=True)}
    folder = session_dir(session)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "dispatcher.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload
