"""Held-out user-command suite (gate G3 of docs/plans/uc2-rl-user-command-recovery.md).

Runs every frozen held-out case with the shipped ``uc2_rl`` runtime or with
explicit per-map checkpoints, in the live order (model -> ROAM -> user
overrides), and writes casewise results plus a summary.

Usage (from backend/):
  python -m lab.marl.evaluate_uc2_user_commands --out results.json
  python -m lab.marl.evaluate_uc2_user_commands --checkpoint uc2-1=path.pt --maps uc2-1 --out r.json
  python -m lab.marl.evaluate_uc2_user_commands --compare current.json candidate.json
"""
from __future__ import annotations

import argparse
import collections
import json
import multiprocessing as mp
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
HELDOUT = ROOT / "docs/examples/uc2-user-command-recovery/heldout-cases.json"

_checkpoints: dict[str, str] = {}


def _init(checkpoints: dict[str, str]) -> None:
    os.environ.setdefault("ONLINE_LEARNING_AUTOSTART", "0")
    os.environ.setdefault("STUDY_TRAJECTORIES_ENABLED", "0")
    import torch
    torch.set_num_threads(1)
    _checkpoints.update(checkpoints)


def _run(case: dict) -> dict:
    from lab.marl import uc2_user_commands as U
    from lab.marl.pf_ch_episode import PFChCase

    ckpt = _checkpoints.get(case["preset"])
    driver = U.checkpoint_driver(Path(ckpt)) if ckpt else U.runtime_driver
    result, _ = U.run_episode(PFChCase(case["preset"]), driver, U.commands_from_json(case["commands"]))
    result.pop("corrections_applied", None)
    return {"id": case["id"], "preset": case["preset"], "solvable": case["solvable"],
            "checkpoint": ckpt or "runtime", **result}


def evaluate(cases: list[dict], checkpoints: dict[str, str], workers: int = 3) -> list[dict]:
    with mp.get_context("spawn").Pool(workers, initializer=_init, initargs=(checkpoints,),
                                      maxtasksperchild=50) as pool:
        out = list(pool.imap_unordered(_run, cases, chunksize=4))
    return sorted(out, key=lambda r: r["id"])


def summarize(results: list[dict]) -> dict:
    by = collections.defaultdict(lambda: collections.Counter())
    for r in results:
        for key in (r["preset"], "all"):
            by[key]["cases"] += 1
            by[key]["solvable"] += r["solvable"]
            by[key]["solved_solvable"] += r["solvable"] and r["solved"]
            by[key]["solved"] += r["solved"]
            by[key]["lateness_solved"] += r["lateness"] if r["solved"] else 0
    return {k: dict(v) for k, v in sorted(by.items())}


def compare(current: list[dict], candidate: list[dict]) -> dict:
    a = {r["id"]: r for r in current}
    b = {r["id"]: r for r in candidate}
    common = sorted(set(a) & set(b))
    fixed = [i for i in common if a[i]["solvable"] and not a[i]["solved"] and b[i]["solved"]]
    broken = [i for i in common if a[i]["solved"] and not b[i]["solved"]]
    both = [i for i in common if a[i]["solved"] and b[i]["solved"]]
    return {"cases": len(common), "fixed": len(fixed), "newly_failing": broken,
            "both_solved": len(both),
            "lateness_both_current": sum(a[i]["lateness"] for i in both),
            "lateness_both_candidate": sum(b[i]["lateness"] for i in both)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--checkpoint", action="append", default=[], help="MAP=PATH, repeatable")
    parser.add_argument("--maps", nargs="*", help="limit to these maps")
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("CURRENT", "CANDIDATE"))
    args = parser.parse_args()
    if args.compare:
        current, candidate = (json.loads(p.read_text())["results"] for p in args.compare)
        print(json.dumps(compare(current, candidate), indent=1))
        return
    cases = json.loads(HELDOUT.read_text())["cases"]
    if args.maps:
        cases = [c for c in cases if c["preset"] in args.maps]
    checkpoints = dict(item.split("=", 1) for item in args.checkpoint)
    results = evaluate(cases, checkpoints, args.workers)
    report = {"schema": "uc2-user-command-heldout-results-v1", "checkpoints": checkpoints or "runtime",
              "summary": summarize(results), "results": results}
    print(json.dumps(report["summary"], indent=1))
    if args.out:
        args.out.write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
