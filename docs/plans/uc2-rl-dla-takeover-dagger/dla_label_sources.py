"""Read-only diagnostic: who would be a good label source on DLA takeover states?

For each frozen takeover case (docs/examples/uc2-rl-adviser/takeover-cases.json):
  dla      - DLA keeps driving (the study's Plan column)
  student  - the shipped uc2_rl adviser best course (from after-lookahead.json)
  teacher  - greedy rollout of the per-scenario teacher checkpoint (UC2 maps only)
  pp       - best pp_replan course over its priority orders
All courses are replayed and ranked exactly like tools/evaluate_uc2_adviser.py.
Run from backend/:  python <this file> OUT.jsonl
"""
import json
import sys
import time
from pathlib import Path

BACKEND = Path.cwd()
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tools"))
import os
for v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ.setdefault(v, "1")
os.environ.setdefault("ONLINE_LEARNING_AUTOSTART", "0")
os.environ.setdefault("STUDY_TRAJECTORIES_ENABLED", "0")

import evaluate_uc2_adviser as E  # noqa: E402
import torch  # noqa: E402

torch.set_num_threads(1)
from app.api.overrides import proposal_arrival_reference, proposal_rank, _variant_metrics  # noqa: E402
from app.core.scenario_runner import TrajectoryBranchRunner  # noqa: E402
from app.core.native_env_cache import clear_native_environment_caches  # noqa: E402
from app.core.proposal_agents import uc2_rl  # noqa: E402
from app.core.proposal_agents.pp_replan import PPReplanAgent  # noqa: E402
from app.policies import registry  # noqa: E402
from app.policies.learned.uc2_roam_bundle import teacher_checkpoint  # noqa: E402
from lab.marl.uc2_user_commands import checkpoint_driver  # noqa: E402

frozen, _ = E.frozen_functions()
REPO = BACKEND.parent
cases = json.loads((REPO / "docs/examples/uc2-rl-adviser/takeover-cases.json").read_text())["cases"]
after = {r["id"]: r["best"] for r in json.loads((REPO / "docs/examples/uc2-rl-adviser/after-lookahead.json").read_text())["results"]}
out = open(sys.argv[1], "a")
done = set()
try:
    done = {json.loads(l)["id"] for l in open(sys.argv[1])}
except FileNotFoundError:
    pass

_orig = registry.create_runtime_policy


def teacher_rollout(env, preset):
    ckpt = teacher_checkpoint(preset)
    make = checkpoint_driver(Path(ckpt))
    registry.create_runtime_policy = lambda pid, e: make(e) if pid == "uc2_rl" else _orig(pid, e)
    try:
        return uc2_rl.rollout_trainruns(env)
    finally:
        registry.create_runtime_policy = _orig


def dla_score(env):
    now = int(env._elapsed_steps)
    horizon = int(env._max_episode_steps) - now
    res = TrajectoryBranchRunner(env, lambda: _orig("deadlock_avoidance", env)).run_branch({}, max_steps=horizon)
    ref = proposal_arrival_reference(env)
    return {"rank": list(proposal_rank(res, ref, now, horizon))}


for case in cases:
    if case["id"] in done:
        continue
    env = E.takeover(case)
    rec = {"id": case["id"], "preset": case["preset"], "step": case["takeover_step"], "handle": case["handle"],
           "student": after[case["id"]]["rank"]}
    try:
        rec["dla"] = dla_score(env)["rank"]
    except Exception as exc:
        rec["dla"] = f"error {exc!r}"[:200]
    if case["preset"] != "tutorial":
        try:
            runs = teacher_rollout(env, case["preset"])
            rec["teacher"] = E.score_course(env, runs, frozen)["rank"] if runs else None
        except Exception as exc:
            rec["teacher"] = f"error {exc!r}"[:200]
    t = time.perf_counter()
    try:
        pp = [E.score_course(env, p.trainruns, frozen)["rank"] for p in PPReplanAgent().propose(env) if p.trainruns]
        rec["pp"] = min(pp) if pp else None
        rec["pp_orders"] = len(pp)
    except Exception as exc:
        rec["pp"] = f"error {exc!r}"[:200]
    rec["pp_seconds"] = round(time.perf_counter() - t, 2)
    out.write(json.dumps(rec) + "\n")
    out.flush()
    print(json.dumps(rec), flush=True)
    del env
    clear_native_environment_caches()
