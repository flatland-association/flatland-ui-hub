"""Collect pre-action native observations from fully served PP episodes.

Only completed missions become teacher data. Current-state PP validation does
not forecast future scripted incidents; the headless episode applies those
incidents during execution and independently checks the resulting mission.
Teacher actions pass through the deployed actor mask before execution.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from pathlib import Path
from typing import TYPE_CHECKING

import numpy as np
import torch
from flatland.envs.step_utils.states import TrainState

from app.planners.director_pp import candidate_schedules, candidate_trainruns
from app.planners.plan_validation import validate_schedules, validate_trainruns
from app.policies.goal_based_policies.infrastructure_graph import DecisionPointGraph
from app.policies.goal_based_policies.schedule import SchedulePlayer
from app.policies.learned.ecml_observation import OBSERVATION_SCHEMA
from app.policies.plan_policy import PlanPolicy
from app.utils.agent_compat import agent_position
from lab.marl.common import N_ACTIONS, load_model, masked_logits, observation_size

if TYPE_CHECKING:
    from lab.marl.pf_ch_episode import PFChCase

SCHEMA = "pf-ch-pp-v2"
TEACHER_OWNER = "pp_teacher"
TEACHER_SOURCE = "native_strict_pp"
VERIFIED_TEACHER_SCHEMA = "uc2-verified-teacher-v1"
VERIFIED_TEACHER_OWNER = "verified_teacher"
VERIFIED_DLA_SOURCE = "native_verified_dla"


def _malfunction_counts(env) -> dict[int, int]:
    return {int(agent.handle): int(getattr(agent.malfunction_handler, "malfunction_down_counter", 0) or 0)
            for agent in env.agents if agent.state != TrainState.DONE}


class TrainrunTeacher:
    """Adapt the existing resource-order-aware PlanPolicy to the teacher API."""

    def __init__(self, env, trainruns):
        self.policy = PlanPolicy(env, trainruns)
        self.policy.reset(env)

    def act_many(self, handles, observations=None):
        actions = self.policy.act_many(handles, observations or {})
        normalized = {}
        for handle, action in actions.items():
            value = getattr(action, "value", action)
            if value is None:
                raise ValueError(f"native teacher returned no action for train {handle}")
            normalized[int(handle)] = int(value)
        return normalized

    @property
    def off_plan_handles(self):
        return self.policy.off_plan_handles


class IncidentReplanningTeacher:
    """Repair observed faults, holding trains through an unplanned blockage."""

    def __init__(self, env, preset: str, player, *, max_orders: int, max_replans: int, executor: str):
        self.env = env
        self.preset = preset
        self.player = player
        self.max_orders = max_orders
        self.max_replans = max_replans
        self.executor = executor
        self.replan_attempts: list[dict] = []
        self.accepted_replans = 0
        self.hold_steps = 0
        self.off_plan_handles: list[int] = []
        self._last_counts = _malfunction_counts(env)
        self._holding = False
        self._retry_when_clear = False

    def _repair(self, changed: list[int], counts: dict[int, int], trigger: str) -> None:
        attempted = sum(event["reason"] != "replan_budget_exhausted" for event in self.replan_attempts)
        event = {"step": int(self.env._elapsed_steps), "observed_handles": changed, "trigger": trigger,
                 "malfunction_counts": {str(handle): count for handle, count in counts.items() if count > 0},
                 "accepted": False, "reason": "replan_budget_exhausted"}
        candidate = None
        if attempted < self.max_replans:
            candidate = create_teacher(self.env, preset=self.preset, max_orders=self.max_orders,
                                       executor=self.executor)
            if candidate is None:
                event["reason"] = "no_valid_repair"
        if candidate is not None:
            self.player, proof, order = candidate
            self.accepted_replans += 1
            self._holding = False
            self._retry_when_clear = False
            event.update(accepted=True, reason="verified", current_state_proof=proof, priority_order=order)
        else:
            self._holding = True
            self._retry_when_clear = any(count > 0 for count in counts.values())
            event["fallback"] = "hold_all_until_verified_repair"
        self.replan_attempts.append(event)

    def act_many(self, handles, observations=None) -> dict[int, int]:
        """Use only current counters and natively verified current-state repairs."""
        counts = _malfunction_counts(self.env)
        changed = [handle for handle, count in counts.items() if count > self._last_counts.get(handle, 0)]
        self._last_counts = counts
        if changed:
            self._repair(changed, counts, "counter_increase")
        elif self._retry_when_clear and not any(count > 0 for count in counts.values()):
            self._retry_when_clear = False
            self._repair([], counts, "counters_cleared")
        if self._holding:
            self.hold_steps += 1
            return {int(handle): 4 if agent_position(self.env.agents[handle]) is not None else 0
                    for handle in handles}
        actions = self.player.act_many(handles)
        self.off_plan_handles = sorted(set(self.off_plan_handles) | set(getattr(self.player, "off_plan_handles", ())))
        return actions


def create_teacher(env, *, preset: str, max_orders: int = 1,
                   replan_on_incidents: bool = False, max_replans: int = 4, executor: str = "schedules"):
    """Return a strict PP player, proof and priority order, optionally with recovery."""
    if executor not in ("schedules", "trainruns"):
        raise ValueError("teacher executor must be schedules or trainruns")
    if not 1 <= max_orders <= 4 or max_replans < 0:
        raise ValueError("max_orders must be 1..4 and max_replans nonnegative")
    player: TrainrunTeacher | IncidentReplanningTeacher | SchedulePlayer
    if executor == "trainruns":
        for order, trainruns in candidate_trainruns(env, max_orders=max_orders):
            proof = validate_trainruns(env, trainruns)
            if proof.accepted:
                player = TrainrunTeacher(env, trainruns)
                if replan_on_incidents:
                    player = IncidentReplanningTeacher(env, preset, player, max_orders=max_orders,
                                                      max_replans=max_replans, executor=executor)
                return player, proof.to_dict(), list(order)
        return None
    # Mid-edge train positions become graph boundaries through the existing
    # graph API; waits then remain exactly expressible by SchedulePlayer.
    current_cells = [position for agent in env.agents
                     if agent.state != TrainState.DONE and (position := agent_position(agent)) is not None]
    graph = DecisionPointGraph.from_env(env, scenario_preset_id=preset, extra_station_cells=current_cells)
    for order, schedules in candidate_schedules(env, graph, max_orders=max_orders):
        proof = validate_schedules(env, graph, schedules)
        if proof.accepted:
            player = SchedulePlayer(graph, env, schedules)
            if replan_on_incidents:
                player = IncidentReplanningTeacher(env, preset, player, max_orders=max_orders,
                                                  max_replans=max_replans, executor=executor)
            return player, proof.to_dict(), list(order)
    return None


def canonical_teacher_action(action: int, *, on_map: bool, mask: np.ndarray) -> tuple[int, str]:
    """Express off-grid holds and forced steps through the actor action mask."""
    if not on_map and action == 4 and mask[4] < 0.5 and mask[0] >= 0.5:
        return 0, "off_grid_stop_as_noop"
    valid = np.flatnonzero(mask >= 0.5)
    if len(valid) == 1 and action != int(valid[0]):
        return int(valid[0]), "forced_single_action"
    if not 0 <= action < N_ACTIONS or mask[action] < 0.5:
        raise ValueError(f"teacher action {action} is excluded by the native mask")
    return action, "identity"


def safe_student_hesitation(student_action: int, teacher_action: int, *, on_map: bool,
                            stopped: bool, mask: np.ndarray) -> bool:
    """Allow a physical hold only when the teacher proposes a permitted move."""
    if (teacher_action not in (1, 2, 3) or student_action == teacher_action
            or not 0 <= student_action < N_ACTIONS or mask[teacher_action] < 0.5
            or mask[student_action] < 0.5):
        return False
    return (student_action == 4 and on_map) or (student_action == 0 and (not on_map or stopped))


def collect_case(case: PFChCase, *, split: str = "train", max_orders: int = 1,
                 replan_on_incidents: bool = False, max_replans: int = 4,
                 executor: str = "schedules", observation_schema: str = OBSERVATION_SCHEMA,
                 student_checkpoint: Path | None = None, student_hold_budget: int = 12,
                 seed: int = 0) -> tuple[list[dict], dict]:
    """Keep teacher labels after verified missions, with optional bounded hesitation."""
    from lab.marl.pf_ch_episode import PFChEpisode

    if student_hold_budget < 0:
        raise ValueError("student hold budget must be nonnegative")
    if student_checkpoint is not None and executor != "trainruns":
        raise ValueError("student hesitation collection requires the trainruns teacher executor")
    student = None
    student_info = None
    if student_checkpoint is not None:
        payload = torch.load(student_checkpoint, map_location="cpu", weights_only=False)
        if payload.get("meta", {}).get("observation_schema") != observation_schema:
            raise ValueError("student checkpoint observation schema differs from collection")
        student = load_model(student_checkpoint).eval()
        if student.trunk[0].in_features != observation_size(observation_schema):
            raise ValueError("student checkpoint input width differs from collection")
        student_info = {"checkpoint": str(student_checkpoint), "sha256": hashlib.sha256(student_checkpoint.read_bytes()).hexdigest(),
                        "mode": "bounded_student_hesitation_correction", "hold_budget": student_hold_budget,
                        "seed": seed}
    rng = random.Random(seed)
    episode = PFChEpisode(case, observation_schema=observation_schema)
    records = []
    held_actions, held_steps, disagreements = 0, 0, 0
    normalization_counts: dict[str, int] = {}
    try:
        actual_schema = getattr(episode.builder, "schema", OBSERVATION_SCHEMA)
        if actual_schema != observation_schema or episode.builder.OBSERVATION_DIM != observation_size(actual_schema):
            raise ValueError("episode builder does not match requested observation schema")
        teacher = create_teacher(episode.env, preset=case.preset, max_orders=max_orders,
                                 replan_on_incidents=replan_on_incidents, max_replans=max_replans, executor=executor)
        if teacher is None:
            return [], {"case": case.to_dict(), "accepted": False, "reason": "no_valid_teacher",
                        "student_guidance": student_info}
        player, proof, order = teacher
        while not episode.done:
            handles = [h for h in episode.handles if episode.env.agents[h].state != TrainState.DONE]
            features, masks = episode.observe(handles)
            raw_actions = player.act_many(handles)
            teacher_actions, action_conversions = {}, {}
            for handle, mask in zip(handles, masks, strict=True):
                action, conversion = canonical_teacher_action(
                    int(raw_actions[handle]), on_map=agent_position(episode.env.agents[handle]) is not None, mask=mask,
                )
                teacher_actions[handle], action_conversions[handle] = action, conversion
                normalization_counts[conversion] = normalization_counts.get(conversion, 0) + 1
            actions = dict(teacher_actions)
            off_plan_handles = list(getattr(player, "off_plan_handles", ()))
            if student is not None and off_plan_handles:
                return [], {"case": case.to_dict(), "accepted": False, "reason": "teacher_left_plan",
                            "metrics": episode.metrics(), "off_plan_handles": off_plan_handles,
                            "student_guidance": student_info}
            proposed = None
            if student is not None:
                with torch.no_grad():
                    logits, _ = student(torch.from_numpy(features))
                    proposed = masked_logits(logits, torch.from_numpy(masks)).argmax(dim=-1).tolist()
            step = int(episode.env._elapsed_steps)
            frame_records, candidates = [], []
            for index, (handle, obs, mask) in enumerate(zip(handles, features, masks, strict=True)):
                if int(np.count_nonzero(mask >= 0.5)) <= 1:
                    continue
                raw_action = int(raw_actions[handle])
                agent = episode.env.agents[handle]
                on_map = agent_position(agent) is not None
                action, conversion = teacher_actions[handle], action_conversions[handle]
                row = {
                    "schema": SCHEMA, "observation_schema": observation_schema,
                    "owner": TEACHER_OWNER, "source": TEACHER_SOURCE,
                    "case_id": case.case_id, "split": split, "step": step, "handle": int(handle),
                    "obs": obs.tolist(), "mask": mask.tolist(), "teacher_action": action,
                    "raw_teacher_action": raw_action, "action_conversion": conversion, "weight": 1.0,
                    "applied_action": action, "action_owner": TEACHER_OWNER,
                    "teacher_mode": "observed_incident_replanning" if replan_on_incidents else "static",
                    "replan_generation": getattr(player, "accepted_replans", 0), "teacher_executor": executor,
                }
                if proposed is not None:
                    student_action = int(proposed[index])
                    disagreement = student_action != action
                    disagreements += int(disagreement)
                    row.update(student_action=student_action, applied_action=action,
                               collection_mode="bounded_student_hesitation_correction", action_owner=TEACHER_OWNER,
                               weight=4.0 if disagreement else 1.0)
                    if safe_student_hesitation(student_action, action, on_map=on_map,
                                               stopped=agent.state == TrainState.STOPPED, mask=mask):
                        candidates.append(row)
                frame_records.append(row)
            if candidates and held_actions < student_hold_budget:
                # One selected train-step per physical frame bounds both
                # total interventions and added global frames by the budget.
                chosen = rng.choice(candidates)
                actions[chosen["handle"]] = chosen["student_action"]
                chosen.update(applied_action=chosen["student_action"], action_owner="student_hesitation")
                held_actions += 1
                held_steps += 1
            records.extend(frame_records)
            episode.step(actions)
        metrics = episode.metrics()
        off_plan_handles = list(getattr(player, "off_plan_handles", ()))
        accepted = bool(metrics["complete_mission"]) and not off_plan_handles
        if student_info is not None:
            student_info.update(hold_actions=held_actions, hold_steps=held_steps, disagreements=disagreements)
        report = {"case": case.to_dict(), "accepted": accepted, "metrics": metrics,
                  "priority_order": order, "current_state_proof": proof,
                  "samples": len(records) if accepted else 0,
                  "replan_attempts": getattr(player, "replan_attempts", []),
                  "teacher_hold_steps": getattr(player, "hold_steps", 0), "teacher_executor": executor,
                  "observation_schema": observation_schema, "off_plan_handles": off_plan_handles,
                  "student_guidance": student_info, "action_normalizations": normalization_counts}
        return records if accepted else [], report
    finally:
        episode.close()


def load_demonstrations(paths: list[Path], *, split: str = "train") -> list[dict]:
    """Load strict PP or proven native UC2-3 DLA records, retaining their provenance."""
    records = []
    dataset_schema = None
    for path in paths:
        with Path(path).open(encoding="utf-8") as stream:
            for number, raw in enumerate(stream, 1):
                if not raw.strip():
                    continue
                row = json.loads(raw)
                pp_origin = (row.get("schema") == SCHEMA and row.get("owner") == TEACHER_OWNER
                             and row.get("source") == TEACHER_SOURCE)
                proof_hash = row.get("proof_sha256")
                dla_origin = (row.get("schema") == VERIFIED_TEACHER_SCHEMA
                    and row.get("owner") == VERIFIED_TEACHER_OWNER
                    and row.get("source") == VERIFIED_DLA_SOURCE
                    and row.get("teacher_executor") == "dla" and row.get("preset") == "uc2-3"
                    and row.get("observation_schema") == "uc2-context-v1"
                    and row.get("split") == "train" and row.get("mission_verified") is True
                    and row.get("proof_scope") == "native_full_mission"
                    and isinstance(proof_hash, str) and len(proof_hash) == 64
                    and all(char in "0123456789abcdef" for char in proof_hash)
                    and row.get("applied_action") == row.get("teacher_action"))
                if (not (pp_origin or dla_origin) or row.get("split") != split
                        or not row.get("case_id")):
                    raise ValueError(f"{path}:{number}: invalid teacher provenance or split")
                row_schema = row.get("observation_schema")
                if row_schema not in (OBSERVATION_SCHEMA, "pf-ch-context-v1", "pf-ch-relative-v1", "uc2-context-v1"):
                    raise ValueError(f"{path}:{number}: unsupported demonstration observation schema")
                size = observation_size(row_schema)
                if dataset_schema is not None and row_schema != dataset_schema:
                    raise ValueError(f"{path}:{number}: mixed observation schemas")
                dataset_schema = row_schema
                obs = np.asarray(row["obs"], dtype=np.float32)
                mask = np.asarray(row["mask"], dtype=np.float32)
                action = row["teacher_action"]
                applied = row.get("applied_action")
                weight = float(row.get("weight", 1.0))
                if (obs.shape != (size,) or mask.shape != (N_ACTIONS,)
                        or not np.isfinite(obs).all() or not np.isfinite(mask).all()
                        or not np.isin(mask, (0, 1)).all() or type(action) is not int
                        or not 0 <= action < N_ACTIONS or mask[action] < 0.5
                        or type(applied) is not int or not 0 <= applied < N_ACTIONS or mask[applied] < 0.5
                        or not math.isfinite(weight) or weight <= 0):
                    raise ValueError(f"{path}:{number}: malformed or masked teacher sample")
                records.append(row)
    if not records:
        raise ValueError("no validated teacher demonstration records")
    return records


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, help="explicit case manifest: JSON list or {cases: [...]} ")
    parser.add_argument("--scenario", action="append", help="PF-CH preset; repeatable if no manifest")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--split", default="train", choices=("train", "validation", "test"))
    parser.add_argument("--max-orders", type=int, default=1, choices=range(1, 5))
    parser.add_argument("--replan-on-incidents", action="store_true")
    parser.add_argument("--max-replans", type=int, default=4)
    parser.add_argument("--teacher-executor", choices=("schedules", "trainruns"), default="schedules")
    parser.add_argument("--observation-schema", choices=(OBSERVATION_SCHEMA, "pf-ch-context-v1", "pf-ch-relative-v1", "uc2-context-v1"),
                        default=OBSERVATION_SCHEMA)
    parser.add_argument("--student-checkpoint", type=Path)
    parser.add_argument("--student-hold-budget", type=int, default=12)
    parser.add_argument("--seed", type=int, default=0)
    return parser


def collect(argv: list[str] | None = None) -> dict:
    """Write the JSONL dataset and a sibling manifest including failed cases."""
    from lab.marl.pf_ch_episode import PFChCase

    args = build_parser().parse_args(argv)
    if args.cases and args.scenario:
        raise ValueError("choose --cases or --scenario")
    if args.output.exists() or args.output.with_suffix(".manifest.json").exists():
        raise FileExistsError(f"refusing to overwrite dataset {args.output}")
    if args.cases:
        content = json.loads(args.cases.read_text(encoding="utf-8"))
        if isinstance(content, dict) and content.get("split", args.split) != args.split:
            raise ValueError("case manifest split differs from --split; refusing to relabel reserved cases")
        values = content["cases"] if isinstance(content, dict) else content
        cases = [PFChCase.from_dict(value) for value in values]
    else:
        cases = [PFChCase(preset=preset, case_id=f"{args.split}-{preset}-0")
                 for preset in (args.scenario or ["pf-ch-corridor-stops"])]
    if not cases or len({case.case_id for case in cases}) != len(cases):
        raise ValueError("cases must have unique identifiers")
    source_root = Path(__file__).resolve().parents[2]
    source_paths = [Path(__file__), source_root / "app/policies/plan_policy.py",
                    source_root / "app/policies/learned/ecml_observation.py"]
    if args.observation_schema in ("pf-ch-context-v1", "pf-ch-relative-v1", "uc2-context-v1"):
        source_paths.append(source_root / "app/policies/learned/pf_ch_observation.py")
    if args.observation_schema == "pf-ch-relative-v1":
        source_paths.append(source_root / "app/policies/learned/pf_ch_relative_observation.py")
    if args.observation_schema == "uc2-context-v1":
        source_paths.append(source_root / "app/policies/learned/uc2_observation.py")
    source_hashes = {str(path.relative_to(source_root)): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in source_paths}
    all_records, reports = [], []
    for case in cases:
        records, report = collect_case(case, split=args.split, max_orders=args.max_orders,
                                       replan_on_incidents=args.replan_on_incidents, max_replans=args.max_replans,
                                       executor=args.teacher_executor, observation_schema=args.observation_schema,
                                       student_checkpoint=args.student_checkpoint, student_hold_budget=args.student_hold_budget,
                                       seed=args.seed)
        all_records.extend(records)
        reports.append(report)
        print(json.dumps({"case_id": case.case_id, "accepted": report["accepted"], "samples": len(records)}),
              flush=True)
    body = "".join(json.dumps(record, separators=(",", ":")) + "\n" for record in all_records)
    manifest = {"schema": SCHEMA, "observation_schema": args.observation_schema,
                "teacher_executor": args.teacher_executor, "replan_on_incidents": args.replan_on_incidents,
                "collection_mode": "bounded_student_hesitation_correction" if args.student_checkpoint else "expert",
                "student_checkpoint": str(args.student_checkpoint) if args.student_checkpoint else None,
                "owner": TEACHER_OWNER, "source": TEACHER_SOURCE,
                "split": args.split, "records": len(all_records), "cases": reports, "source_sha256": source_hashes,
                "dataset_sha256": hashlib.sha256(body.encode("utf-8")).hexdigest()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(body, encoding="utf-8")
    args.output.with_suffix(".manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    if not all_records:
        raise ValueError(f"no valid teacher episodes; see {args.output.with_suffix('.manifest.json')}")
    return manifest


if __name__ == "__main__":
    collect()
