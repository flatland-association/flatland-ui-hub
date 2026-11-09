"""A frozen, native Director candidate for the explicitly prepared demo.

No browser read plans or releases a directive. The one candidate uses the same
residual search, splice and mission/execution gate as normal Director adoption.
Its checked player snapshot is retained so Commit never searches again.
"""
from __future__ import annotations

import pickle
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4

from fastapi import HTTPException

from app.core.director_objectives import DIRECTOR_STRATEGY_PRESETS

HOLD_PHASES = {"waiting", "preparing", "ready", "unavailable"}


def _witness(session) -> tuple:
    """Bind current physical state, complete plan and authoritative controls."""
    from app.core.stops import served_stops
    from app.policies.goal_based_policies.step0_cache import fingerprint
    from app.policies.goal_directed_policy import env_weights, plan_info, plan_player, plan_schedules

    env = session.env
    player, schedules = plan_player(env), plan_schedules(env)
    info = plan_info(env)
    snapshot = player.snapshot() if player else None
    random = getattr(env, "np_random", None)
    random_state = (random.get_state() if hasattr(random, "get_state")
                    else getattr(getattr(random, "bit_generator", None), "state", None))
    random_digest = sha256(pickle.dumps(random_state)).hexdigest()
    against = repr((snapshot, schedules, info, session.control_revision, session.policy,
                    session.dispatcher.generation, int(getattr(env, "num_resets", 0) or 0),
                    [sorted(served_stops(env, h)) for h in range(len(env.agents))],
                    random_digest))
    digest = fingerprint(env, env_weights(env), "dispatcher-comparison", against=against)
    return env, player, schedules, digest


class DirectorComparison:
    def __init__(self, session, decision: dict):
        from app.policies.goal_directed_policy import env_weights, plan_paths

        self.decision = deepcopy(decision)
        self.witness = _witness(session)
        self.prepared = None
        self.plan = None
        self.resume_witness = None
        self.resume_allowed = False
        weights = dict(zip(("punctuality", "connections", "stability"), env_weights(session.env)))
        self.data = {"phase": "waiting", "session_id": session.id,
                     "command_id": decision["command_id"], "generation": decision["generation"],
                     "step": int(session.env._elapsed_steps), "token": None,
                     # Initial-plan scores are not a same-state baseline for a
                     # residual candidate. Do not manufacture forecast deltas.
                     "current": {"weights": weights, "paths": deepcopy(plan_paths(session.env)),
                                 "utilities": None, "reported": None},
                     "alternative": None, "validation": None, "reason": None}

    @property
    def held(self) -> bool:
        return self.data["phase"] in HOLD_PHASES

    def snapshot(self) -> dict:
        return deepcopy(self.data)

    def _matches(self, session, command_id: str, generation: int) -> bool:
        runtime = session.dispatcher
        return (session.id == self.data["session_id"] and command_id == self.data["command_id"]
                and generation == self.data["generation"] == runtime.generation
                and runtime.owner == "agent" and runtime.run_status not in {"finished", "aborted", "error"}
                and runtime.mode == "director" and runtime.comparison is self)

    def current(self, session) -> bool:
        if not self._matches(session, self.data["command_id"], self.data["generation"]):
            return False
        if session.dispatcher.pending != self.decision:
            return False
        now = _witness(session)
        return all(a is b for a, b in zip(now[:3], self.witness[:3])) and now[3] == self.witness[3]

    def cancel(self, session, reason: str) -> None:
        """Cancellation is immediate even while a read-only fork is computing."""
        runtime = session.dispatcher
        with runtime.lock:
            self.resume_allowed = False
            if self.data["phase"] in {"committed", "cancelled"}:
                return
            self.data.update(phase="cancelled", token=None, reason=reason)
            self.prepared = self.plan = None
            pending = runtime.pending
            if pending and pending["command_id"] == self.data["command_id"]:
                runtime.finish(session, pending, "cancelled", reason)
                runtime.directives.add(pending["command"]["phase"])
                runtime.pending = None
                runtime.approved_command_id = None
            runtime.event(session, "comparison_cancelled", source="system", reason=reason,
                          command_id=self.data["command_id"])

    def prepare(self, session, command_id: str, generation: int) -> None:
        from app.api.sessions import _DIRECTOR_PROGRESS, _divergence, _progress
        from app.policies.goal_based_policies.ensemble import DirectorWeights
        from app.policies.goal_based_policies.replan import residual_plan
        from app.policies.goal_based_policies.schedule import SchedulePlayer
        from app.policies.goal_based_policies.search import _reported
        from app.policies.goal_directed_policy import _prepare_replan_candidate, loaded_models

        runtime = session.dispatcher
        with runtime.lock:
            if not self._matches(session, command_id, generation):
                raise HTTPException(409, "Comparison ownership, command or generation changed")
            if self.data["phase"] == "ready" and self.current(session):
                return
            if self.data["phase"] != "waiting":
                raise HTTPException(409, "No matching comparison waiting for preparation")
            if not self.current(session):
                self.cancel(session, "stale_snapshot")
                raise HTTPException(409, "The comparison snapshot changed")
            self.data["phase"] = "preparing"
            runtime.event(session, "comparison_preparing", command_id=command_id)
            env, player, old, _ = self.witness
            models = loaded_models()
            target = self.decision["command"]["weights"]
            preset = next((p for p in DIRECTOR_STRATEGY_PRESETS if p["weights"] == target), None)
            if player is None or old is None or models is None or preset is None:
                self.data.update(phase="unavailable", reason="native_candidate_unavailable")
                return
            # No mutable object from the live player/plan is passed into search.
            fork = deepcopy(env)
            fork_player = SchedulePlayer(player.graph, fork)
            fork_player.restore(deepcopy(player.snapshot()))
            old_copy = deepcopy(old)
        _progress(session.id, phase="strategies", done=0, total=1, current=preset["id"])
        try:
            plan = residual_plan(fork, player.graph, DirectorWeights(**target), *models,
                                 player=fork_player, schedules=old_copy, reason="weights change")
            prepared = _prepare_replan_candidate(fork, fork_player, old_copy, plan, False)
            paths = prepared["paths"]
            reroutes, holds = {}, []
            for handle in sorted(paths):
                current_path = (self.data["current"]["paths"] or {}).get(handle)
                diff = _divergence(current_path, paths[handle])
                if diff and diff["kind"] == "reroute":
                    reroutes[str(handle)] = {"branch": diff["branch"], "points": diff["points"]}
                elif diff:
                    holds.append({"handle": handle, "row": diff["row"], "col": diff["col"], "steps": diff["steps"]})
            validation = prepared["event"].get("validation")
            alternative = {**deepcopy(preset), "paths": deepcopy(paths),
                           "divergence": {"reroutes": reroutes, "holds": holds},
                           "plan": {"source": plan.source, "weighted": plan.score.weighted,
                                    "utilities": dict(plan.score.breakdown["utilities"]),
                                    "reported": _reported(plan.score.breakdown),
                                    "changed": list(prepared["event"].get("changed") or []),
                                    "considered": dict(plan.considered or {})}}
            with runtime.lock:
                if self.data["phase"] != "preparing" or not self.current(session):
                    self.cancel(session, "preparation_cancelled_or_stale")
                    return
                self.data.update(alternative=alternative, validation=validation)
                if not prepared["committed"] or not validation or not validation.get("accepted"):
                    self.data.update(phase="unavailable", reason="native_execution_rejected")
                elif not reroutes and not holds:
                    self.data.update(phase="unavailable", reason="no_drawable_change")
                elif prepared["snapshot"] == fork_player.snapshot():
                    self.data.update(phase="unavailable", reason="unchanged_plan")
                else:
                    self.prepared, self.plan = prepared, plan
                    self.data.update(phase="ready", token=uuid4().hex)
                runtime.event(session, "comparison_" + self.data["phase"], command_id=command_id,
                              step=self.data["step"], validation=validation, reason=self.data["reason"])
                _progress(session.id, done=1)
        except Exception as exc:  # noqa: BLE001 — any failed native proof leaves the candidate unavailable.
            with runtime.lock:
                if self.data["phase"] == "preparing":
                    self.data.update(phase="unavailable", reason=f"native_preparation_failed: {type(exc).__name__}")
                    runtime.event(session, "comparison_unavailable", command_id=command_id, reason=self.data["reason"])
        finally:
            _DIRECTOR_PROGRESS.pop(session.id, None)

    def commit(self, session, command_id: str, generation: int, token: str) -> None:
        from app.api.sessions import _invalidate_scenario_forecasts
        from app.core.dispatcher import AXES, ORIGIN
        from app.policies.goal_based_policies.schedule import SchedulePlayer
        from app.policies.goal_directed_policy import (
            adopt_prepared_replan,
            env_weights,
            plan_info,
            plan_paths,
        )

        runtime = session.dispatcher
        with runtime.lock:
            if not self._matches(session, command_id, generation):
                raise HTTPException(409, "Comparison ownership, command or generation changed")
            if self.data["phase"] == "committed" and token == self.data["token"]:
                return
            if self.data["phase"] != "ready" or not token or token != self.data["token"]:
                raise HTTPException(409, "No matching checked comparison token")
            if not self.current(session):
                self.cancel(session, "stale_snapshot")
                raise HTTPException(409, "The comparison snapshot changed")
            env, player, old, _ = self.witness
            prepared = self.prepared
            if prepared is None or not prepared["committed"] or not prepared["event"]["validation"]["accepted"]:
                raise HTTPException(409, "No native execution proof")
            # Reconstruct drawable paths from the exact checked player before
            # any live write; never adopt a candidate other than the preview.
            candidate = SchedulePlayer(player.graph, env)
            candidate.restore(deepcopy(prepared["snapshot"]))
            actual_paths = {int(s.handle): candidate.future_path(int(s.handle)) for s in old}
            if actual_paths != self.data["alternative"]["paths"]:
                self.cancel(session, "candidate_identity_changed")
                raise HTTPException(409, "The checked candidate changed")
            target = self.decision["command"]["weights"]
            previous = list(env_weights(env))
            details = {"observed_before": runtime.observed_metrics(session), "previous_weights": previous}
            origin = ORIGIN.set(runtime.command_origin)
            try:
                try:
                    adopt_prepared_replan(env, player, old, self.plan, prepared, tuple(target[axis] for axis in AXES))
                except Exception as exc:
                    self.data.update(phase="unavailable", token=None, reason="native_adoption_failed")
                    raise HTTPException(409, "The checked native plan could not be installed") from exc
                _invalidate_scenario_forecasts(session.id)
                response = {"session_id": session.id, "weights": deepcopy(target), "replanned": True,
                            "plan": deepcopy(plan_info(env)), "paths": deepcopy(plan_paths(env))}
                runtime.directives.add(self.decision["command"]["phase"])
                runtime.status = "executed"
                runtime.finish(session, self.decision, "executed", "accepted", response=response,
                               response_ticks=runtime.clock - self.decision["observed_at"], **details)
                runtime.pending = None
                runtime.approved_command_id = None
                self.data["phase"] = "committed"
                runtime.event(session, "comparison_committed", command_id=command_id, step=self.data["step"])
                runtime.after_step(session, False)
                self.resume_witness = _witness(session)
                self.resume_allowed = True
            finally:
                ORIGIN.reset(origin)

    def validate_resume(self, session, token: str, *, consume: bool = False) -> None:
        """A delayed automatic Play cannot undo an explicit human interruption.

        This one-use capability is separate from the retained Commit receipt.
        Legacy manual Play has no token and keeps its normal meaning.
        """
        runtime = session.dispatcher
        with runtime.lock:
            if (not self._matches(session, self.data["command_id"], self.data["generation"])
                    or self.data["phase"] != "committed" or not self.resume_allowed
                    or token != self.data["token"] or self.resume_witness is None):
                raise HTTPException(409, "The automatic comparison resume was cancelled or used")
            now = _witness(session)
            if (not all(a is b for a, b in zip(now[:3], self.resume_witness[:3]))
                    or now[3] != self.resume_witness[3]):
                raise HTTPException(409, "The committed comparison state changed before resume")
            if consume:
                self.resume_allowed = False
                runtime.event(session, "comparison_resumed", command_id=self.data["command_id"])


def cancel_comparison(session, reason: str) -> None:
    runtime = getattr(session, "dispatcher", None)
    comparison = getattr(runtime, "comparison", None)
    if comparison is not None:
        comparison.cancel(session, reason)
