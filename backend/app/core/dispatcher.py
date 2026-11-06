"""Deterministic operator strategies on the existing HMI commands.

One session-owned runtime advances only from the simulation driver. A decision
pulse precedes a Flatland step; Recommendation holds that step while a response
is pending. Browser reads never advance either clock.
"""
from __future__ import annotations

import json
from contextvars import ContextVar
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from threading import RLock
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

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

    @model_validator(mode="after")
    def valid_order(self):
        if len(set(self.priority)) != len(self.priority) or any(h < 0 for h in self.priority):
            raise ValueError("Train priority must contain unique non-negative handles")
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
        "dispatcher": DispatcherConfig(profile="goal-switch", switch_at=12,
                                       initial=Directive(**DIRECTOR_STRATEGY_PRESETS[2]["weights"]),
                                       switched=Directive(**DIRECTOR_STRATEGY_PRESETS[0]["weights"])).model_dump(),
        "open_at_step": 1, "play_speed_level": 3,
    },
}


def identity(value) -> str:
    """Stable semantic reference; elapsed time alone never expires a choice."""
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:20]


def alternative_identity(option: dict) -> str:
    """Bind the offered action/order; changing scores alone does not expire it."""
    return identity({key: option.get(key) for key in ("id", "priority", "passOrder")})


def require_human(session) -> None:
    """Reject competing manual actuation without an explicit handover."""
    runtime = getattr(session, "dispatcher", None)
    if runtime and runtime.owner == "agent" and ORIGIN.get() == "human":
        raise HTTPException(409, {"reason": "dispatcher_owns_role", "action": "take_over_first"})


class DispatcherRuntime:
    """A single pending decision with generation and command deduplication."""

    def __init__(self, session, config: DispatcherConfig, mode: str):
        if mode not in PROFILES[config.profile]["modes"]:
            raise ValueError(f"Profile {config.profile} is not supported in {mode}")
        if any(h >= len(session.env.agents) for h in config.priority):
            raise ValueError("Train priority refers to a train outside this session")
        self.config, self.mode = config, mode
        self.session_id = session.id
        from app.policies.plan_policy import planned_arrival_steps
        self.planned_arrivals = planned_arrival_steps(session.env)
        self.owner = "agent"
        self.generation = 0
        self.clock = 0
        self.status = "paused"
        self.lock = RLock()
        self.pending = None
        self.observation = None
        self.events: list[dict] = []
        self.results: dict[str, dict] = {}
        self.answered: set[str] = set()
        self.opportunity_ids: set[str] = set()
        self.directives: set[str] = set()
        self.effective: set[str] = set()
        self.arrivals: dict[int, int] = {}
        self.mixed = False
        self.run_status = "ready"
        self.abort_reason = None
        self.event(session, "configured", source="system", config=config.model_dump(), mode=mode)
        if config.profile == "goal-switch":
            self.event(session, "goal_change_scheduled", due=config.switch_at, weights=config.switched.model_dump())

    def event(self, session, kind: str, source="synthetic_dispatcher", **data) -> dict:
        """Append an immutable event with both clocks and its actual origin."""
        row = {"seq": len(self.events), "kind": kind, "source": source,
               "generation": self.generation, "logical_time": self.clock,
               "simulation_time": int(session.env._elapsed_steps), **deepcopy(data)}
        self.events.append(row)
        return row

    def invalidate(self, session, reason: str, *, human=False) -> None:
        """Invalidate immediately; a later hand-back starts from observation."""
        with self.lock:
            self.generation += 1
            if self.pending:
                self.finish(session, self.pending, "cancelled", reason)
            self.pending = None
            if human:
                self.owner = "human"
                self.mixed = True
                self.status = "human_control"
            else:
                self.status = "stopped"
            self.event(session, reason, source="human" if human else "system")

    def hand_back(self, session) -> None:
        """Explicit fresh delegation, with no resurrection of cancelled work."""
        with self.lock:
            if self.run_status in ("finished", "error", "aborted"):
                raise HTTPException(409, "Start a new run before delegating again")
            self.generation += 1
            self.owner, self.status = "agent", "paused"
            self.pending = None
            self.answered.clear()
            self.directives.clear()
            self.event(session, "hand_back", source="human")

    def observe(self, session) -> dict:
        """Only operator-visible HMI data enters selection."""
        if self.mode == "director":
            from app.policies.goal_directed_policy import env_weights
            return {"mode": self.mode, "weights": list(env_weights(session.env)), "open_decisions": 0}
        from app.api.hmi import get_contentions
        from app.core.contention_strategies import contention_strategies
        groups = get_contentions(session.id).get("groups") or []
        if not groups:
            self.answered.clear()
            return {"mode": self.mode, "open_decisions": 0, "alternatives": []}
        group = groups[0]
        handles = [int(h) for h in group["handles"]]
        order = [h for h in self.config.priority if h in handles]
        priority_available = bool(order)
        order += sorted(h for h in handles if h not in order)
        payload = contention_strategies(session.id, session, order if self.config.profile == "priority" else None)
        # No trajectories or hidden policy valuations: the same scored options
        # the public contention-strategies endpoint presents to the operator.
        alternatives = [{k: s.get(k) for k in ("id", "priority", "metrics", "passOrder")}
                        for s in payload.get("strategies", [])]
        return {"mode": self.mode, "open_decisions": len(groups), "handles": handles,
                "situation": identity({"handles": sorted(handles), "window": group.get("window")}),
                "preferred": payload.get("recommended"), "alternatives": alternatives,
                "priority_available": priority_available}

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
                "situation": obs["situation"], "option": alternative_identity(option), "handles": obs["handles"]}, rule, fallback

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
            token = ORIGIN.set("synthetic_dispatcher")
            try:
                if command["kind"] == "strategy":
                    from app.api.hmi import StrategyApplyRequest, post_contention_strategy
                    result = post_contention_strategy(session.id, StrategyApplyRequest(
                        strategy=command["strategy"], priority=command["priority"], mode=self.mode))
                    self.answered.add(command["situation"])
                else:
                    from app.api.sessions import DirectorWeightsRequest, set_director_weights_for_session
                    result = set_director_weights_for_session(session.id, DirectorWeightsRequest(**command["weights"], plan=True))
                    self.directives.add(command["phase"])
                    if not result.get("replanned") or str((result.get("plan") or {}).get("source", "")).startswith("avoidance"):
                        self.status = "error"
                        self.run_status = "error"
                        self.abort_reason = "director_plan_unavailable"
                        return self.finish(session, decision, "unsupported", "director_plan_unavailable", response=result)
                    # Controller uptake is checked after act_many / env.step,
                    # separately from acceptance of the weights command.
                self.status = "executed"
                return self.finish(session, decision, "executed", "accepted", response=result,
                                   response_ticks=self.clock - decision["observed_at"])
            except HTTPException as exc:
                self.status = "rejected"
                return self.finish(session, decision, "rejected", "domain_rejected", detail=exc.detail)
            finally:
                ORIGIN.reset(token)

    def pulse(self, session) -> bool:
        """Return whether Flatland may advance on this logical decision pulse."""
        with self.lock:
            if self.owner != "agent" or self.run_status in ("error", "aborted", "finished"):
                return True
            self.run_status = "running"
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
                   "allowed_commands": ["directive" if self.mode == "director" else "strategy"],
                   "history": history, **obs}
            self.observation = obs
            if not self.pending:
                command, rule, fallback = self.choose(obs)
                if obs.get("alternatives"):
                    self.opportunity_ids.add(obs["situation"])
                if command and command["kind"] == "directive":
                    self.opportunity_ids.add("directive:" + command["phase"])
                if command:
                    self.pending = {"session_id": session.id, "command_id": f"g{self.generation}-d{len(self.events)}",
                                    "generation": self.generation, "command": command,
                                    "observed_at": self.clock,
                                    "due": self.clock + (self.config.delay if self.config.profile == "delayed" else 0),
                                    "reason": {"rule": rule, "fallback": fallback}}
                    self.status = "planned"
                    self.event(session, "planned", observation={"session_id": session.id, "generation": self.generation,
                               "logical_time": self.clock, "simulation_time": int(session.env._elapsed_steps), **obs}, decision=self.pending)
                elif self.status != "waiting":
                    self.status = "waiting"
                    self.event(session, "waiting", observation=obs, rule=rule)
            if self.pending and self.clock >= self.pending["due"]:
                self.execute(session, self.pending, obs)
                self.pending = None
            return self.run_status != "error" and not (self.mode == "recommendation" and self.pending)

    def after_step(self, session, done: bool) -> None:
        """Evaluator records arrivals and independently checks plan uptake."""
        for handle, agent in enumerate(session.env.agents):
            if getattr(agent.state, "name", "") == "DONE":
                self.arrivals.setdefault(handle, int(session.env._elapsed_steps))
        if self.mode == "director":
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
                               weights=weights, plan_source=info.get("source"))
        if done:
            self.invalidate(session, "episode_end")
            self.run_status = "finished"

    def metrics(self, session) -> dict:
        """Count terminal commands and evaluate arrivals against the original timetable."""
        reference = self.planned_arrivals
        delays = [max(0, arrival - reference[h]) for h, arrival in self.arrivals.items() if h in reference]
        results = list(self.results.values())
        responses = [r["response_ticks"] for r in results if r.get("status") == "executed"]
        return {"opportunities": len(self.opportunity_ids),
                "planned": len([e for e in self.events if e["kind"] == "planned"]),
                **{status: sum(r["status"] == status for r in results)
                   for status in ("executed", "stale", "rejected", "cancelled", "unsupported")},
                "response_ticks": responses, "mean_response_ticks": sum(responses) / len(responses) if responses else None,
                "effective_directives": len(self.effective),
                "effective_goal_changes": sum(e["kind"] == "directive_effective" and e.get("phase") == "switched" for e in self.events), "arrived": len(self.arrivals),
                "total_trains": len(session.env.agents), "simulation_steps": int(session.env._elapsed_steps),
                "total_arrival_delay": sum(delays) if delays else None, "delay_denominator": len(delays)}

    def snapshot(self, session, *, full=False) -> dict:
        """Project runtime data; live history is bounded, exports retain every event."""
        with self.lock:
            return {"operator_type": "mixed" if self.mixed else "synthetic_dispatcher", "owner": self.owner,
                    "profile": self.config.profile, "profile_version": PROFILE_VERSION, "mode": self.mode,
                    "config": self.config.model_dump(), "generation": self.generation, "logical_time": self.clock,
                    "status": self.status, "run_status": self.run_status, "abort_reason": self.abort_reason,
                    "pending": deepcopy(self.pending), "observation": deepcopy(self.observation),
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
    from importlib.metadata import version

    from app import __version__
    from app.core.study_paths import session_dir
    runtime = session.dispatcher
    backend = Path(__file__).resolve().parents[1]
    code = sha256()
    for path in sorted(backend.rglob("*.py")):
        code.update(str(path.relative_to(backend)).encode())
        code.update(path.read_bytes())
    all_arrived = len(runtime.arrivals) == len(session.env.agents)
    horizon = int(session.env._elapsed_steps) >= int(session.env._max_episode_steps)
    payload = {"schema": "flatland-synthetic-dispatcher", "version": 1,
               "session_id": session.id, "app_version": __version__, "code_version": code.hexdigest(),
               "simulation_result": "all_arrived" if all_arrived else "horizon" if horizon else "unfinished",
               "technical_result": "error" if runtime.run_status == "error" else "complete" if runtime.run_status == "finished" else "incomplete",
               "creation_config": getattr(session, "creation_config", None),
               "scenario_version": getattr(session, "scenario_version", None),
               "controller_version": code.hexdigest(),
               "replan_execution": "synchronous-logical-boundary" if runtime.mode == "director" else "existing-controller",
               "controller_models": {p.name: sha256(p.read_bytes()).hexdigest() for p in sorted((backend.parent / "models" / "goal_directed").glob("*.ckpt"))}, "flatland_version": version("flatland-rl"),
               "seed": session.seed, "scenario": session.scenario_preset_id,
               "disturbances": session.disturbances, "policy": session.policy,
               "clock": "one logical pulse before each attempted Flatland step; Recommendation holds while pending",
               **runtime.snapshot(session, full=True)}
    folder = session_dir(session)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "dispatcher.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload
