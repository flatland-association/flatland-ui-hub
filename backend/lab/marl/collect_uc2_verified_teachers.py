"""TRAIN-only PP/DLA teacher selection on native UC2-3, with honest provenance.

Existing PP trajectories remain the default. DLA can replace a case only after
native full-mission validation, successful live execution and lower lateness.
This is supervised teacher selection, never a runtime planner/DLA fallback.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile

import numpy as np
from flatland.envs.step_utils.states import TrainState

from app.core.native_env_cache import clear_native_environment_caches
from app.planners.plan_validation import validate_execution
from app.policies.goal_directed_policy import forget_env
from app.policies.registry import create_runtime_policy
from app.utils.agent_compat import agent_position
from lab.marl.collect_pp_demonstrations import (
    VERIFIED_DLA_SOURCE, VERIFIED_TEACHER_OWNER, VERIFIED_TEACHER_SCHEMA,
    canonical_teacher_action,
)
from lab.marl.pf_ch_episode import PFChCase, PFChEpisode


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024*1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def prefer_dla(pp_metrics: dict, dla_metrics: dict, proof: dict) -> bool:
    """Completion is mandatory; retain PP on a lateness tie."""
    return bool(proof.get("accepted") and pp_metrics.get("complete_mission")
                and dla_metrics.get("complete_mission")
                and dla_metrics["lateness"] < pp_metrics["lateness"])


def collect_dla_case(case: PFChCase) -> tuple[list[dict], dict]:
    if case.preset != "uc2-3" or case.disturbances or case.disturbance_ids:
        raise ValueError("DLA ablation supports native UC2-3 TRAIN cases only")
    episode = PFChEpisode(case, observation_schema="uc2-context-v1")
    probes = []
    try:
        def factory(fork):
            probes.append(fork)
            return create_runtime_policy("deadlock_avoidance", fork)
        validation = validate_execution(episode.env, factory)
        proof = validation.to_dict()
        proof_hash = hashlib.sha256(json.dumps(proof, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        for probe in probes:
            forget_env(probe)
        probes.clear()
        clear_native_environment_caches()
        if not validation.accepted:
            return [], {"case": case.to_dict(), "accepted": False, "reason": "native_proof_rejected",
                        "proof": proof, "proof_sha256": proof_hash, "metrics": episode.metrics()}
        policy = create_runtime_policy("deadlock_avoidance", episode.env)
        records = []
        while not episode.done:
            handles = [h for h in episode.handles if episode.env.agents[h].state != TrainState.DONE]
            features, masks = episode.observe(handles)
            policy.start_step()
            raw = policy.act_many(handles, episode.session.last_observations)
            actions = {}
            for index, handle in enumerate(handles):
                raw_action = int(getattr(raw[handle], "value", raw[handle]))
                action, conversion = canonical_teacher_action(raw_action,
                    on_map=agent_position(episode.env.agents[handle]) is not None, mask=masks[index])
                actions[handle] = action
                if np.count_nonzero(masks[index] >= .5) <= 1:
                    continue
                records.append({"schema": VERIFIED_TEACHER_SCHEMA, "owner": VERIFIED_TEACHER_OWNER,
                    "source": VERIFIED_DLA_SOURCE, "split": "train", "preset": case.preset,
                    "case_id": case.case_id, "observation_schema": "uc2-context-v1",
                    "step": episode.now, "handle": handle, "obs": features[index].tolist(),
                    "mask": masks[index].tolist(), "teacher_action": action, "applied_action": action,
                    "raw_teacher_action": raw_action, "action_conversion": conversion,
                    "teacher_executor": "dla", "teacher_mode": "native_current_state_heuristic",
                    "proof_sha256": proof_hash, "proof_scope": "native_full_mission",
                    "mission_verified": True, "weight": 1.0})
            episode.step(actions)
            policy.end_step()
        metrics = episode.metrics()
        accepted = bool(metrics["complete_mission"])
        return records if accepted else [], {"case": case.to_dict(), "accepted": accepted,
            "reason": "verified_native_live_mission" if accepted else "live_mission_failed",
            "proof": proof, "proof_sha256": proof_hash, "metrics": metrics,
            "samples": len(records) if accepted else 0}
    finally:
        for probe in probes:
            forget_env(probe)
        episode.close()


def _train_cases(paths: list[Path]) -> list[PFChCase]:
    cases = []
    for path in paths:
        content = json.loads(path.read_text())
        if not isinstance(content, dict) or content.get("split") != "train":
            raise ValueError("explicit TRAIN manifests required")
        cases.extend(PFChCase.from_dict(row) for row in content["cases"] if row["preset"] == "uc2-3")
    if not cases or len({case.case_id for case in cases}) != len(cases):
        raise ValueError("nonempty distinct UC2-3 TRAIN cases required")
    return cases


def collect(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cases", type=Path, action="append", required=True)
    parser.add_argument("--input-mixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    cases = _train_cases(args.cases)
    manifest_path = args.output.with_suffix(".manifest.json")
    dla_path = args.output.with_name(args.output.stem + ".dla-candidates.jsonl")
    for path in (args.output, manifest_path, dla_path):
        if path.exists():
            raise FileExistsError(path)
    input_manifest_path = args.input_mixture.with_suffix(".manifest.json")
    input_manifest = json.loads(input_manifest_path.read_text())
    if input_manifest.get("split") != "train":
        raise ValueError("input mixture must be TRAIN-only")
    pp_reports = {}
    for source in input_manifest["sources"]:
        report_path = Path(source["path"]).with_suffix(".manifest.json")
        report = json.loads(report_path.read_text())
        if report.get("split") != "train":
            raise ValueError("PP source report must be TRAIN-only")
        for row in report["cases"]:
            pp_reports[row["case"]["case_id"]] = row
    for case in cases:
        report = pp_reports.get(case.case_id)
        if not report or not report["accepted"] or report["case"]["preset"] != "uc2-3":
            raise ValueError(f"missing verified PP reference for {case.case_id}")
    root = Path(__file__).resolve().parents[2]
    dependencies = [Path(__file__), root/"lab/marl/collect_pp_demonstrations.py",
        root/"lab/marl/pf_ch_episode.py", root/"lab/marl/common.py",
        root/"app/policies/deadlock_avoidance_policy.py", root/"app/utils/deadlock_avoidance_walker.py",
        root/"app/planners/plan_validation.py", root/"app/policies/learned/uc2_observation.py"]
    hashes = {str(path.relative_to(root)): digest_file(path) for path in dependencies}
    replacements, reports, all_dla = {}, [], []
    for case in cases:
        rows, report = collect_dla_case(case)
        pp = pp_reports[case.case_id]["metrics"]
        choose = prefer_dla(pp, report["metrics"], report["proof"])
        report.update(pp_metrics=pp, selected_teacher=VERIFIED_DLA_SOURCE if choose else "native_strict_pp")
        reports.append(report)
        all_dla.extend(rows)
        if choose:
            replacements[case.case_id] = rows
        print(json.dumps({"case_id": case.case_id, "selected": report["selected_teacher"],
            "pp_lateness": pp["lateness"], "dla_lateness": report["metrics"]["lateness"],
            "dla_complete": report["metrics"]["complete_mission"]}), flush=True)
    if any(digest_file(root/path) != value for path, value in hashes.items()):
        raise RuntimeError("teacher dependency changed during collection")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with dla_path.open("x") as stream:
        for row in all_dla:
            stream.write(json.dumps(row, separators=(",", ":"), allow_nan=False)+"\n")
    counts, weights, source_counts, objective = Counter(), Counter(), Counter(), Counter()
    seen_replacements, selected_weight = set(), {}
    digest, input_digest = hashlib.sha256(), hashlib.sha256()
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=args.output.parent,
                prefix="."+args.output.name+".", delete=False) as outgoing:
            temporary = Path(outgoing.name)
            def write(row):
                raw = (json.dumps(row, separators=(",", ":"), allow_nan=False)+"\n").encode()
                outgoing.write(raw); digest.update(raw)
                source_counts[row["source"]] += 1
                counts[row["case_id"]] += 1
                weights[row["source"]] += float(row.get("weight", 1))
            with args.input_mixture.open("rb") as incoming:
                for raw in incoming:
                    input_digest.update(raw)
                    if not raw.strip():
                        continue
                    row = json.loads(raw)
                    if row.get("split") != "train" or row.get("observation_schema") != "uc2-context-v1":
                        raise ValueError("incompatible mixture row")
                    key = row["case_id"]
                    if key not in replacements:
                        write(row)
                    elif key not in seen_replacements:
                        seen_replacements.add(key)
                        selected_weight[key] = float(row.get("replay_multiplier", 1))
                        for replacement in replacements[key]:
                            changed = dict(replacement)
                            changed["weight"] *= selected_weight[key]
                            if "replay_multiplier" in row:
                                changed["replay_multiplier"] = row["replay_multiplier"]
                                changed["replay_source"] = row.get("replay_source", "native_exact5")
                            write(changed)
            if input_digest.hexdigest() != input_manifest["dataset_sha256"]:
                raise ValueError("input mixture hash changed")
            if seen_replacements != set(replacements):
                raise ValueError("selected case is absent from the input mixture")
        for case_id, pp in pp_reports.items():
            selected = next((item for item in reports if item["case"]["case_id"] == case_id), None)
            objective["pp_lateness"] += pp["metrics"]["lateness"]
            objective["selected_lateness"] += (selected["metrics"]["lateness"]
                if selected and selected["selected_teacher"] == VERIFIED_DLA_SOURCE else pp["metrics"]["lateness"])
        result = {"schema": "uc2-best-verified-teacher-mixture-v1", "split": "train",
            "observation_schema": "uc2-context-v1", "records": sum(counts.values()),
            "teacher_sources": dict(source_counts), "stored_weight_sums": dict(weights),
            "case_counts": dict(counts), "selected_dla_cases": sorted(replacements),
            "compared_cases": reports, "training_objective_totals": dict(objective),
            "input_mixture": str(args.input_mixture), "input_sha256": input_digest.hexdigest(),
            "dataset_sha256": digest.hexdigest(), "dla_candidate_file": str(dla_path),
            "dla_candidate_sha256": digest_file(dla_path), "source_sha256": hashes,
            "case_manifests": [{"path": str(path), "sha256": digest_file(path)} for path in args.cases],
            "selection": "Only UC2-3 TRAIN cases; verified full mission first, strictly lower lateness; PP wins ties",
            "runtime_fallback": False, "evaluation_denominators_unchanged": True}
        os.link(temporary, args.output)
        with manifest_path.open("x") as stream:
            stream.write(json.dumps(result, indent=2, allow_nan=False)+"\n")
        return result
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    collect()
