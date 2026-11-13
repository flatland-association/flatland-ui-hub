"""Score completed UC2 BC snapshots on exact5 and dev20 only, never final50."""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import time
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path

from app.policies.learned.uc2_observation import OBSERVATION_SCHEMA, SCENARIO_IDS
from lab.marl.evaluate_pf_ch import evaluate

SPLITS = {"exact5": ("exact5-cases.json", "train", 5), "dev20": ("dev20-cases.json", "validation", 20)}
FIELDS = ("epoch", "split", "complete_missions", "cases", "arrived", "trains", "lateness", "steps",
          "observed_native_counter_increases", "native_on_map_positive_counter_steps", "technical_failures",
          "evaluation_seconds", "checkpoint_sha256", "sidecar_sha256", "manifest_sha256", "output")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path: Path, value: dict) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def completed_snapshot(directory: Path, epoch: int) -> tuple[Path, Path] | None:
    candidates = list(directory.glob(f"*-epoch-{epoch:05d}.pt"))
    if len(candidates) > 1:
        raise ValueError("use one UC2 recipe per snapshot directory")
    if not candidates:
        return None
    checkpoint = candidates[0]
    sidecar = checkpoint.with_suffix(".json")
    if not sidecar.is_file() or checkpoint.with_suffix(".pt.tmp").exists() or sidecar.with_suffix(".json.tmp").exists():
        return None
    meta = json.loads(sidecar.read_text())
    if (meta.get("epochs_completed") != epoch or not meta.get("snapshot")
            or meta.get("observation_schema") != OBSERVATION_SCHEMA):
        raise ValueError("UC2 snapshot metadata has an unexpected epoch/schema")
    return checkpoint, sidecar


def freeze_snapshot(checkpoint: Path, sidecar: Path, directory: Path) -> tuple[Path, str, str]:
    directory.mkdir(parents=True, exist_ok=True)
    weights_hash, meta_hash = digest(checkpoint), digest(sidecar)
    frozen = directory / checkpoint.name
    frozen_meta = frozen.with_suffix(".json")
    if frozen.exists() or frozen_meta.exists():
        if (not frozen.is_file() or not frozen_meta.is_file()
                or digest(frozen) != weights_hash or digest(frozen_meta) != meta_hash):
            raise ValueError("existing frozen UC2 checkpoint or sidecar differs from source")
        return frozen, weights_hash, meta_hash
    for source, target in ((checkpoint, frozen), (sidecar, frozen_meta)):
        temporary = target.with_suffix(target.suffix + ".tmp")
        shutil.copyfile(source, temporary)
        temporary.replace(target)
    if any(digest(path) != expected for path, expected in
           ((checkpoint, weights_hash), (sidecar, meta_hash), (frozen, weights_hash), (frozen_meta, meta_hash))):
        raise RuntimeError("UC2 checkpoint changed while freezing")
    return frozen, weights_hash, meta_hash


def load_monitor_inputs(directory: Path) -> tuple[dict[str, Path], dict[str, str]]:
    paths, hashes = {}, {}
    for name, (filename, role, count) in SPLITS.items():
        path = directory / filename
        hashes[name] = digest(path)
        payload = json.loads(path.read_text())
        rows = payload.get("cases", [])
        if payload.get("split") != role or len(rows) != count:
            raise ValueError(f"unexpected role/count for UC2 {name}")
        if {row.get("preset") for row in rows} != set(SCENARIO_IDS):
            raise ValueError(f"UC2 {name} must cover all five supported fixtures")
        if any(sum(row.get("preset") == preset for row in rows) != count // 5 for preset in SCENARIO_IDS):
            raise ValueError("UC2 monitor inputs require equal per-fixture coverage")
        paths[name] = path
    return paths, hashes


def score_report(report: dict, *, epoch: int, split: str, seconds: float, output: Path,
                 sidecar_sha256: str) -> dict:
    if len(report["summary"]) != 1 or len(report["checkpoints"]) != 1:
        raise ValueError("UC2 monitor accepts one neural checkpoint per evaluation")
    summary = next(iter(report["summary"].values()))
    checkpoint = next(iter(report["checkpoints"].values()))
    rows = report["results"]
    return {"epoch": epoch, "split": split,
        **{name: summary[name] for name in ("complete_missions", "cases", "arrived", "trains", "lateness",
                                           "technical_failures")},
        "steps": sum(row["steps"] for row in rows),
        "observed_native_counter_increases": sum(len(row.get("observed_malfunction_counter_increases", [])) for row in rows),
        "native_on_map_positive_counter_steps": sum(row.get("native_on_map_positive_counter_steps", 0) for row in rows),
        "by_preset": {preset: {"complete": sum(row["complete_mission"] for row in rows if row["case"]["preset"] == preset),
            "cases": sum(row["case"]["preset"] == preset for row in rows)} for preset in SCENARIO_IDS},
        "evaluation_seconds": round(seconds, 3), "checkpoint_sha256": checkpoint["sha256"],
        "sidecar_sha256": sidecar_sha256, "manifest_sha256": report["manifest_sha256"], "output": str(output),
        "finished_at_utc": datetime.now(UTC).isoformat()}


def monitor(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--snapshot-dir", type=Path, required=True)
    parser.add_argument("--epochs", type=int, nargs="+", required=True)
    parser.add_argument("--cases-dir", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--max-wait-minutes", type=float, default=12)
    parser.add_argument("--poll-seconds", type=float, default=5)
    args = parser.parse_args(argv)
    if (args.max_wait_minutes <= 0 or not 0 < args.poll_seconds <= 30
            or any(epoch <= 0 for epoch in args.epochs) or len(set(args.epochs)) != len(args.epochs)):
        raise ValueError("positive unique epochs/duration and poll interval <=30s required")
    cases, manifest_hashes = load_monitor_inputs(args.cases_dir or args.snapshot_dir.parent)
    output_dir = args.output_dir or args.snapshot_dir.with_name(args.snapshot_dir.name.removesuffix("-snapshots") + "-monitor")
    output_dir.mkdir(parents=True, exist_ok=True)
    state = {"schema": "uc2-candidate-monitor-v1", "state": "running", "requested_epochs": sorted(args.epochs),
        "started_at_utc": datetime.now(UTC).isoformat(), "completed_epochs": [], "scores": [], "errors": [],
        "manifests": {name: {"path": str(path), "sha256": manifest_hashes[name]} for name, path in cases.items()},
        "final_cases_evaluated": False}
    started = time.monotonic()
    deadline = started + args.max_wait_minutes * 60

    def record():
        state["elapsed_seconds"] = round(time.monotonic() - started, 3)
        atomic_json(output_dir / "monitor-status.json", state)
        atomic_json(output_dir / "monitor-scores.json", {"schema": state["schema"], "scores": state["scores"], "errors": state["errors"]})
        temporary = output_dir / "scores.tsv.tmp"
        temporary.write_text("\t".join(FIELDS) + "\n" + "".join(
            "\t".join(str(row[field]) for field in FIELDS) + "\n" for row in state["scores"]))
        temporary.replace(output_dir / "scores.tsv")

    pending = sorted(args.epochs)
    record()
    try:
        while pending and time.monotonic() < deadline:
            ready = [(epoch, completed_snapshot(args.snapshot_dir, epoch)) for epoch in pending]
            selected = next(((epoch, pair) for epoch, pair in ready if pair is not None), None)
            if selected is None:
                record()
                print(json.dumps({"waiting_for_epochs": pending, "elapsed_seconds": state["elapsed_seconds"]}), flush=True)
                time.sleep(min(args.poll_seconds, max(0, deadline - time.monotonic())))
                continue
            epoch, pair = selected
            checkpoint, weights_hash, meta_hash = freeze_snapshot(*pair, output_dir / "frozen")
            for split, manifest in cases.items():
                output = output_dir / f"epoch-{epoch:05d}-{split}.json"
                if output.exists():
                    report = json.loads(output.read_text())
                    seconds = sum(row.get("seconds", 0) for row in report["results"])
                else:
                    beginning = time.monotonic()
                    with output.with_suffix(".log").open("x") as stream, redirect_stdout(stream):
                        report = evaluate(["--cases", str(manifest), "--checkpoint", str(checkpoint),
                                           "--output", str(output), "--threads", "1"])
                    seconds = time.monotonic() - beginning
                row = score_report(report, epoch=epoch, split=split, seconds=seconds, output=output,
                                   sidecar_sha256=meta_hash)
                if row["checkpoint_sha256"] != weights_hash or row["manifest_sha256"] != manifest_hashes[split]:
                    raise ValueError("existing UC2 evidence uses different frozen inputs")
                if (digest(checkpoint) != weights_hash or digest(checkpoint.with_suffix(".json")) != meta_hash
                        or digest(manifest) != manifest_hashes[split]):
                    raise RuntimeError("UC2 evaluation input changed")
                state["scores"].append(row)
                record()
                print(json.dumps(row), flush=True)
            state["completed_epochs"].append(epoch)
            pending.remove(epoch)
            record()
    except Exception as error:
        state["state"] = "failed"
        state["errors"].append({"type": type(error).__name__, "message": str(error)})
        state["pending_epochs"] = pending
        record()
        raise
    state["state"] = "complete" if not pending else "wait_budget_reached"
    state["pending_epochs"] = pending
    record()
    return state


if __name__ == "__main__":
    monitor()
