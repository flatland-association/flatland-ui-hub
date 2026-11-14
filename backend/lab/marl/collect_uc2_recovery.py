"""Collect DAgger data for UC2 user-command recovery (docs/plans/uc2-rl-user-command-recovery.md).

Per map, the driver (current specialist or a candidate) runs the *training*
command sets on the study timetable and on a sample of known systematic
timetables. For every failed, effective episode a verified correction chain is
searched (lab.marl.uc2_user_commands.find_corrections). Output per map:

  <out>/<map>.npz   label_obs/label_mask/label_action (verified corrections),
                    prior_obs/prior_mask (multi-choice states the driver handled
                    in completed episodes, after the first command; subsampled)
  <out>/<map>.json  manifest: inputs, counts, labelled and unlabelled failures
  <out>/<map>.episodes.pkl  per-episode results; an interrupted run resumes from it

The held-out suite (docs/examples/uc2-user-command-recovery/heldout-cases.json)
is never read here.

Since the per-infrastructure layout (docs/plans/uc2-rl-per-infrastructure.md) the four
UC2 scenarios share one model: a further round should collect with that model and refit
it on all four scenarios' labels (or refit the pinned teachers, then re-distil).

Usage (from backend/):
  python -m lab.marl.collect_uc2_recovery --out DIR [--maps uc2-1 ...] [--checkpoint MAP=PATH ...]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import pickle
import random
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
SYSTEMATIC = ROOT / "docs/examples/uc2-roam-performance/inputs/systematic1472-v3-cases.json"
PRIOR_KEEP = 0.25

_checkpoints: dict[str, str] = {}


def shipped_checkpoint(preset: str) -> Path:
    from app.policies.learned import uc2_roam_bundle
    return uc2_roam_bundle.checkpoint_for_scenario(preset)


def base_cases(preset: str, n_systematic: int, seed: int):
    """The study timetable plus a fixed sample of known systematic timetables."""
    from lab.marl.pf_ch_episode import PFChCase, load_cases
    known = [c for c in load_cases(SYSTEMATIC) if c.preset == preset and any(c.departure_offsets)]
    random.Random(f"{seed}:{preset}").shuffle(known)
    return [PFChCase(preset)] + known[:n_systematic]


def _init(checkpoints: dict[str, str]) -> None:
    os.environ.setdefault("ONLINE_LEARNING_AUTOSTART", "0")
    os.environ.setdefault("STUDY_TRAJECTORIES_ENABLED", "0")
    import torch
    torch.set_num_threads(1)
    _checkpoints.update(checkpoints)


def _job(job: dict) -> dict:
    from lab.marl import uc2_user_commands as U
    from lab.marl.pf_ch_episode import PFChCase

    case = PFChCase.from_dict(job["case"])
    driver = U.checkpoint_driver(Path(_checkpoints[case.preset]))
    commands = U.commands_from_json(job["commands"])
    rng = random.Random(job["key"])
    first = min(c.step for c in commands)
    result, records = U.run_episode(case, driver, commands, record=True)
    out = {"key": job["key"], "preset": case.preset, "case_id": case.case_id,
           "commands": job["commands"], "effective": result["effective"], "solved": result["solved"],
           "labels": [], "prior": []}
    if result["solved"]:
        out["prior"] = [r for r in records if r["step"] >= first and rng.random() < PRIOR_KEEP]
    elif result["effective"]:
        found = U.find_corrections(case, driver, commands)
        if found is not None:
            fixes = found["corrections"]
            for r in found["records"]:
                key = (r["step"], r["handle"])
                if key in fixes:
                    out["labels"].append({**r, "action": int(fixes[key])})
                elif r["step"] >= first and rng.random() < PRIOR_KEEP:
                    out["prior"].append(r)
            out["fixed_lateness"] = found["result"]["lateness"]
            out["corrections"] = [[s, h, a] for (s, h), a in sorted(fixes.items())]
    return out


def collect(maps, checkpoints, out_dir: Path, n_systematic: int, seed: int, workers: int) -> None:
    from lab.marl import uc2_user_commands as U

    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    inputs = {}
    for preset in maps:
        bases = base_cases(preset, n_systematic, seed)
        inputs[preset] = [b.case_id for b in bases]
        for b in bases:
            nominal, _ = U.run_episode(b, U.checkpoint_driver(Path(checkpoints[preset])))
            for k, commands in enumerate(U.training_command_sets(preset, nominal["trains"], nominal["steps"])):
                jobs.append({"key": f"{b.case_id}:{k}", "case": b.to_dict(),
                             "commands": U.commands_to_json(commands)})
    started = time.time()
    results = {p: [] for p in maps}
    for preset in maps:  # resume: episodes already written by an interrupted run
        stream = out_dir / f"{preset}.episodes.pkl"
        if stream.exists():
            with stream.open("rb") as f:
                while True:
                    try:
                        results[preset].append(pickle.load(f))
                    except EOFError:
                        break
    done = {r["key"] for rows in results.values() for r in rows}
    todo = [j for j in jobs if j["key"] not in done]
    print(f"{len(jobs)} training episodes on {', '.join(maps)}; {len(done)} already collected", flush=True)
    streams = {p: (out_dir / f"{p}.episodes.pkl").open("ab") for p in maps}
    try:
        with mp.get_context("spawn").Pool(workers, initializer=_init, initargs=(checkpoints,),
                                          maxtasksperchild=40) as pool:
            for n, res in enumerate(pool.imap_unordered(_job, todo, chunksize=1), 1):
                results[res["preset"]].append(res)
                pickle.dump(res, streams[res["preset"]])
                streams[res["preset"]].flush()
                if n % 200 == 0:
                    print(f"  {n}/{len(todo)} in {time.time() - started:.0f}s", flush=True)
    finally:
        for f in streams.values():
            f.close()
    for preset, rows in results.items():
        rows.sort(key=lambda r: r["key"])
        labels = [lab for r in rows for lab in r["labels"]]
        prior = [p for r in rows for p in r["prior"]]
        width = len((labels or prior)[0]["obs"])
        np.savez_compressed(
            out_dir / f"{preset}.npz",
            label_obs=np.array([r["obs"] for r in labels], dtype=np.float32).reshape(-1, width),
            label_mask=np.array([r["mask"] for r in labels], dtype=np.float32).reshape(-1, 5),
            label_action=np.array([r["action"] for r in labels], dtype=np.int64),
            prior_obs=np.array([r["obs"] for r in prior], dtype=np.float32).reshape(-1, width),
            prior_mask=np.array([r["mask"] for r in prior], dtype=np.float32).reshape(-1, 5))
        ckpt = Path(checkpoints[preset])
        manifest = {
            "schema": "uc2-user-command-recovery-collection-v1", "preset": preset,
            "driver_checkpoint": ckpt.name, "driver_sha256": hashlib.sha256(ckpt.read_bytes()).hexdigest(),
            "base_cases": inputs[preset], "seed": seed, "episodes": len(rows),
            "effective": sum(r["effective"] for r in rows), "solved": sum(r["solved"] for r in rows),
            "failed_effective": sum(r["effective"] and not r["solved"] for r in rows),
            "labelled_episodes": sum(bool(r["labels"]) for r in rows),
            "labels": len(labels), "prior_states": len(prior),
            "labelled": [{"key": r["key"], "corrections": r["corrections"], "lateness": r["fixed_lateness"]}
                         for r in rows if r["labels"]],
            "unlabelled_failures": [r["key"] for r in rows if r["effective"] and not r["solved"] and not r["labels"]],
            "elapsed_seconds": round(time.time() - started),
        }
        (out_dir / f"{preset}.json").write_text(json.dumps(manifest, indent=1))
        print(f"{preset}: {manifest['episodes']} episodes, {manifest['failed_effective']} failed, "
              f"{manifest['labelled_episodes']} labelled ({manifest['labels']} labels), "
              f"{manifest['prior_states']} prior states", flush=True)


def main() -> None:
    from lab.marl.uc2_user_commands import UC2_MAPS

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--maps", nargs="*", default=list(UC2_MAPS))
    parser.add_argument("--checkpoint", action="append", default=[], help="MAP=PATH driver (default: shipped)")
    parser.add_argument("--systematic", type=int, default=5, help="known systematic timetables per map")
    parser.add_argument("--seed", type=int, default=20261114)
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    checkpoints = {p: str(shipped_checkpoint(p)) for p in args.maps}
    checkpoints.update(dict(item.split("=", 1) for item in args.checkpoint))
    collect(args.maps, checkpoints, args.out, args.systematic, args.seed, args.workers)


if __name__ == "__main__":
    main()
