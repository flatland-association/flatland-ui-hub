"""Paired native DLA takeover diagnostics; no training or planner baselines.

From backend/: python tools/evaluate_uc2_adviser.py --mode baseline --out FILE
Then use --mode lookahead on the same frozen case manifest. Both advisers are
independently replayed through PlanPolicy. Cases are development diagnostics.
"""
from __future__ import annotations

import argparse
import ast
import copy
import gc
import hashlib
import importlib.metadata
import json
import os
import platform
import resource
import math
import statistics
import subprocess
import sys
import tempfile
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
sys.path.insert(0, str(BACKEND))
for variable in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ.setdefault(variable, "1")
os.environ.setdefault("ONLINE_LEARNING_AUTOSTART", "0")
os.environ.setdefault("STUDY_TRAJECTORIES_ENABLED", "0")
os.environ.setdefault("MPLCONFIGDIR", str(Path(tempfile.gettempdir()) / "uc2-adviser-mpl"))

BASE = "a1b9c7b01d20064be9e6e37790717ecaeda82f8f"
DEFAULT_CASES = REPO / "docs/examples/uc2-rl-adviser/takeover-cases.json"
CASES_SHA256 = "7646f339cbb35e07ed01381cf832b29e7774f193580e1badd63d9d1202d16028"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def original(path: str) -> str:
    return subprocess.check_output(["git", "show", f"{BASE}:{path}"], cwd=REPO).decode()


def frozen_functions():
    """Load the declared BEFORE implementation even while the worktree changes."""
    from flatland.envs.rail_env import RailEnv
    from flatland.envs.rail_trainrun_data_structures import TrainrunDict, TrainrunWaypoint, Waypoint
    from app.utils.agent_compat import agent_direction, agent_position

    adviser = original("backend/app/core/proposal_agents/uc2_rl.py")
    api = original("backend/app/api/overrides.py")
    namespace = dict(copy=copy, Optional=Optional, RailEnv=RailEnv, TrainrunDict=TrainrunDict,
                     TrainrunWaypoint=TrainrunWaypoint, Waypoint=Waypoint,
                     agent_direction=agent_direction, agent_position=agent_position, POLICY_ID="uc2_rl")
    selected = []
    for source, names in [(adviser, {"rollout_trainruns"}), (api, {"_course_score", "_variant_metrics"})]:
        for node in ast.parse(source).body:
            if isinstance(node, ast.FunctionDef) and node.name in names:
                selected.append(ast.get_source_segment(source, node))
            if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "_NOT_ARRIVED_PENALTY" for t in node.targets):
                namespace["_NOT_ARRIVED_PENALTY"] = ast.literal_eval(node.value)
    exec(compile("\n\n".join(selected), f"git:{BASE}", "exec"), namespace)
    return namespace, {"adviser_sha256": digest(adviser.encode()), "api_sha256": digest(api.encode())}


def state_identity(env) -> dict:
    from app.utils.agent_compat import agent_direction, agent_position

    return {"step": int(env._elapsed_steps), "agents": [
        {"handle": int(a.handle), "state": a.state.name, "position": agent_position(a),
         "direction": agent_direction(a), "speed": float(a.speed_counter.speed),
         "malfunction": int(a.malfunction_handler.malfunction_down_counter),
         "arrival_time": None if getattr(a, "arrival_time", None) is None else int(a.arrival_time)}
        for a in env.agents]}


def takeover(case):
    from app.core.env_factory import create_env
    from app.policies.registry import create_runtime_policy

    env = create_env(scenario_preset_id=case["preset"], seed=case["seed"])
    assert int(env._max_episode_steps) == case["native_horizon"]
    driver = create_runtime_policy(case["driver"], env)
    while int(env._elapsed_steps) < case["takeover_step"]:
        driver.start_step()
        actions = driver.act_many(env.get_agent_handles(), {})
        driver.end_step()
        env.step(actions)
    assert digest(canonical(state_identity(env))) == case["source_state_sha256"], case["id"]
    return env


def course_identity(trainruns) -> str:
    return digest(canonical({str(h): [(int(w.scheduled_at), list(w.waypoint.position), int(w.waypoint.direction))
                                     for w in run] for h, run in sorted(trainruns.items())}))


def cache_counts() -> dict:
    from app.core.native_env_cache import _NATIVE_CACHE_METHODS

    return {f"{owner.__name__}.{name}": method.cache_info().currsize
            for owner, names in _NATIVE_CACHE_METHODS for name in names
            if (method := getattr(owner, name, None)) is not None and hasattr(method, "cache_info")}


def score_course(env, trainruns, frozen) -> dict:
    from app.api.overrides import proposal_arrival_reference, proposal_rank, _variant_metrics
    from app.core.scenario_runner import TrajectoryBranchRunner
    from app.policies.plan_policy import PlanPolicy, planned_arrival_steps

    now = int(env._elapsed_steps)
    horizon = int(env._max_episode_steps) - now
    started = time.perf_counter()
    result = TrajectoryBranchRunner(env, lambda: PlanPolicy(None, trainruns)).run_branch({}, max_steps=horizon)
    reference = proposal_arrival_reference(env)
    initial_reference = planned_arrival_steps(env)
    actual_lateness = 0
    arrivals = {}
    native_latest = {int(a.handle): getattr(a, "latest_arrival", None) for a in env.agents}
    for handle, outcome in result.agent_outcomes.items():
        arrival = outcome.get("arrival_step")
        if outcome.get("arrived") and arrival is None:
            arrival = getattr(env.agents[int(handle)], "arrival_time", None)
        arrivals[str(handle)] = None if arrival is None else int(arrival)
        if arrival is not None and native_latest[int(handle)] is not None:
            actual_lateness += max(0, int(arrival) - int(native_latest[int(handle)]))
    return {"completed": int(result.success_count), "total": int(result.total_agents),
            "rank": list(proposal_rank(result, reference, now, horizon)),
            "metrics": _variant_metrics(result, reference, now, horizon),
            "native_completed_lateness": int(actual_lateness),
            "historical_api_score": frozen["_course_score"](result, initial_reference),
            "historical_api_metrics": frozen["_variant_metrics"](result, initial_reference, now, horizon),
            "arrival_steps": arrivals, "replay_end_step": int(result.elapsed_steps),
            "deadlocks": int(result.kpis.get("deadlocks", 0)),
            "replay_seconds": round(time.perf_counter() - started, 6)}


def source_pins(cases) -> dict:
    from app.core.scenario_presets import get_preset
    from app.policies.learned import uc2_bundle, uc2_roam_bundle

    files = {uc2_bundle.CHECKPOINT, uc2_bundle.CHECKPOINT.with_suffix(".json"), uc2_roam_bundle.MANIFEST}
    files.update(uc2_roam_bundle.MANIFEST.parent / name for name in set(uc2_roam_bundle.INFRASTRUCTURE_FILES.values()))
    files.update(Path(get_preset(p)["path"]) for p in {c["preset"] for c in cases})
    runtime = ["app/policies/plan_policy.py", "app/core/scenario_runner.py", "app/core/native_env_cache.py",
               "app/policies/deadlock_avoidance_policy.py", "app/policies/learned/uc2_roam_policy.py",
               "app/policies/learned/uc2_observation.py", "app/policies/learned/learned_ppo_policy.py",
               "app/policies/learned/uc2_roam_bundle.py", "app/core/proposal_agents/uc2_rl.py",
               "app/api/overrides.py"]
    files.update(BACKEND / p for p in runtime)
    return {str(p.relative_to(BACKEND)): digest(p.read_bytes()) for p in sorted(files) if p.is_file()}


def summary(results) -> dict:
    out = {}
    for preset in ["all", "tutorial", "uc2-1", "uc2-2", "uc2-3", "uc2-4"]:
        selected = [r for r in results if preset == "all" or r["preset"] == preset]
        out[preset] = {"cases": len(selected), "solved": sum(r["best"]["completed"] == r["best"]["total"] for r in selected),
                       "completed": sum(r["best"]["completed"] for r in selected),
                       "native_completed_lateness": sum(r["best"]["native_completed_lateness"] for r in selected),
                       "api_lateness": sum(r["best"]["metrics"]["lateness"] for r in selected),
                       "generation_seconds": round(sum(r["generation_seconds"] for r in selected), 6),
                       "candidate_counts": dict(Counter(r["candidate_count"] for r in selected))}
    return out


def compare_reports(before: dict, after: dict) -> dict:
    """Compare identical frozen roots and the unchanged replay quality measure."""
    a = {r["id"]: r for r in before["results"]}
    b = {r["id"]: r for r in after["results"]}
    if set(a) != set(b) or before["cases_sha256"] != after["cases_sha256"]:
        raise ValueError("Paired reports have different frozen inputs")
    if before["source_files"] != after["source_files"]:
        raise ValueError("Runtime, models or scoring changed between paired runs")
    if any(a[i]["best"]["course_sha256"] != b[i]["candidates"][0]["course_sha256"] for i in a):
        raise ValueError("New greedy course differs from the historical BEFORE implementation")

    def latency(report):
        generation = sorted(r["generation_seconds"] for r in report["results"])
        preview = [r["generation_seconds"] + sum(c["replay_seconds"] for c in r["candidates"])
                   for r in report["results"]]
        return {"generation_median_seconds": statistics.median(generation),
                "generation_p95_nearest_rank_seconds": generation[math.ceil(.95 * len(generation)) - 1],
                "generation_max_seconds": max(generation),
                "generation_plus_all_candidate_replays_max_seconds": max(preview)}

    changes = []
    for case_id in a:
        old, new = a[case_id]["best"], b[case_id]["best"]
        comparison = (tuple(new["rank"]) > tuple(old["rank"])) - (tuple(new["rank"]) < tuple(old["rank"]))
        if comparison:
            changes.append({"id": case_id, "change": "improved" if comparison < 0 else "regressed",
                            "before_rank": old["rank"], "after_rank": new["rank"],
                            "selected_candidate_id": new["candidate_id"], "intervention": new["intervention"]})
    both_solved = [i for i in a if a[i]["best"]["completed"] == a[i]["best"]["total"]
                   and b[i]["best"]["completed"] == b[i]["best"]["total"]]
    return {"schema": "uc2-rl-adviser-paired-summary-v1",
            "evaluation_role": "reused_development_diagnostics_not_holdout",
            "source_commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO).decode().strip(),
            "cases_sha256": before["cases_sha256"], "cases": len(a),
            "source_runtime_and_models_identical": True, "greedy_exact_course_parity_cases": len(a),
            "all_recorded_source_files_match_current_worktree": all(
                digest((BACKEND / path).read_bytes()) == sha for path, sha in after["source_files"].items()),
            "improved": sum(c["change"] == "improved" for c in changes),
            "unchanged": len(a) - len(changes), "regressed": sum(c["change"] == "regressed" for c in changes),
            "both_solved_cases": len(both_solved),
            "native_lateness_both_solved_before": sum(a[i]["best"]["native_completed_lateness"] for i in both_solved),
            "native_lateness_both_solved_after": sum(b[i]["best"]["native_completed_lateness"] for i in both_solved),
            "before_summary": before["summary"], "after_summary": after["summary"],
            "before_latency": latency(before), "after_latency": latency(after), "changed_cases": changes,
            "still_incomplete": [i for i in b if b[i]["best"]["completed"] < b[i]["best"]["total"]],
            "source_unchanged_all_cases": all(r["source_state_unchanged"] for report in (before, after)
                                             for r in report["results"]),
            "native_lru_entries_after_cleanup_max": max(r["cleanup"]["native_lru_entries"]
                                                       for report in (before, after) for r in report["results"]),
            "temporary_override_sessions_after_cleanup_max": max(r["cleanup"]["temporary_override_sessions"]
                                                                for report in (before, after) for r in report["results"])}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("baseline", "lookahead", "compare"), required=True)
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--case-id", action="append", default=[])
    parser.add_argument("--before", type=Path)
    parser.add_argument("--after", type=Path)
    args = parser.parse_args()
    if args.mode == "compare":
        if not args.before or not args.after:
            parser.error("compare requires --before and --after")
        report = compare_reports(json.loads(args.before.read_text()), json.loads(args.after.read_text()))
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({k: report[k] for k in ("cases", "improved", "unchanged", "regressed", "both_solved_cases")}), flush=True)
        return
    raw = args.cases.read_bytes()
    if digest(raw) != CASES_SHA256:
        raise ValueError("Frozen takeover manifest changed")
    cases = json.loads(raw)["cases"]
    if args.case_id:
        cases = [c for c in cases if c["id"] in args.case_id]
    import torch
    torch.set_num_threads(1)
    from app.core.native_env_cache import clear_native_environment_caches
    from app.core.override_manager import override_manager
    from app.core.proposal_agents.uc2_rl import UC2RLProposalAgent
    frozen, base_pins = frozen_functions()
    report = {"schema": "uc2-rl-adviser-paired-results-v1", "evaluation_role": "reused_development_diagnostics_not_holdout",
              "mode": args.mode, "base_commit": BASE, "cases_sha256": digest(raw), "base_source": base_pins,
              "created_utc": datetime.now(timezone.utc).isoformat(),
              "software": {"python": platform.python_version(), "flatland": importlib.metadata.version("flatland-rl"),
                           "torch": torch.__version__, "threads": torch.get_num_threads()},
              "source_files": source_pins(cases), "results": []}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    for case in cases:
        env = takeover(case)
        before = digest(canonical(state_identity(env)))
        started = time.perf_counter()
        if args.mode == "baseline":
            runs = frozen["rollout_trainruns"](env)
            proposed = [("historical-greedy", runs, {"kind": "rl"})] if runs else []
        else:
            proposed = [(p.candidate_id, p.trainruns, p.intervention)
                        for p in UC2RLProposalAgent().propose_for(env, case["handle"])]
        generation_seconds = time.perf_counter() - started
        evaluated = []
        for candidate_id, trainruns, intervention in proposed:
            scored = score_course(env, trainruns, frozen)
            evaluated.append({"candidate_id": candidate_id, "intervention": intervention,
                              "course_sha256": course_identity(trainruns), **scored})
        if not evaluated:
            raise RuntimeError(f"No proposal for frozen active case {case['id']}")
        best = min(evaluated, key=lambda r: tuple(r["rank"]))
        record = {"id": case["id"], "preset": case["preset"], "handle": case["handle"],
                  "takeover_step": case["takeover_step"], "native_horizon": case["native_horizon"],
                  "source_state_unchanged": before == digest(canonical(state_identity(env))),
                  "generation_seconds": round(generation_seconds, 6), "candidate_count": len(evaluated),
                  "candidates": evaluated, "best": best}
        if not record["source_state_unchanged"]:
            raise RuntimeError(f"Live source changed: {case['id']}")
        del env, proposed
        clear_native_environment_caches()
        gc.collect()
        record["cleanup"] = {"native_lru_entries": sum(cache_counts().values()),
                             "temporary_override_sessions": len(override_manager._overrides),
                             "process_peak_rss_bytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss *
                             (1 if sys.platform == "darwin" else 1024)}
        report["results"].append(record)
        report["summary"] = summary(report["results"])
        args.out.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"id": case["id"], "candidates": len(evaluated), "rank": best["rank"],
                          "native_lateness": best["native_completed_lateness"],
                          "generation_seconds": round(generation_seconds, 3)}), flush=True)
    print(json.dumps(report["summary"], indent=2), flush=True)


if __name__ == "__main__":
    main()
