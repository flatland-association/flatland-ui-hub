"""Disjoint fixed UC2 inputs and development-only immutable snapshot monitoring."""
import hashlib
import itertools
import json
from pathlib import Path

import pytest

from app.policies.learned.uc2_observation import OBSERVATION_SCHEMA, SCENARIO_IDS
from lab.marl import monitor_uc2_candidates as monitor
from lab.marl.pf_ch_episode import PFChCase, load_cases
from lab.marl.prepare_uc2_splits import physical_key, prepare


def _prepare(directory):
    directory.mkdir(parents=True, exist_ok=True)
    exact = directory / "exact5-cases.json"
    exact.write_text(json.dumps({"split": "train", "cases": [
        {"preset": preset, "case_id": f"exact-{preset}"} for preset in SCENARIO_IDS]}))
    return prepare(["--output-dir", str(directory), "--seed", "42"])


def _snapshot(directory, epoch=1):
    directory.mkdir(parents=True, exist_ok=True)
    checkpoint = directory / f"candidate-epoch-{epoch:05d}.pt"
    checkpoint.write_bytes(b"owned-test-snapshot")
    checkpoint.with_suffix(".json").write_text(json.dumps({"snapshot": True, "epochs_completed": epoch,
        "observation_schema": OBSERVATION_SCHEMA}))
    return checkpoint


def test_fixed_splits_are_disjoint_without_modifying_native_fault_speed_horizon(tmp_path):
    protocol = _prepare(tmp_path)
    assert protocol["native_case_seed"] == 0
    assert protocol["policy_outcomes_used"] is False and protocol["final_outcomes_opened"] is False
    assert len(protocol["fixture_sha256"]) == 25
    assert not any(protocol["pairwise_operational_overlaps"].values())
    groups = {name: load_cases(Path(meta["path"])) for name, meta in protocol["manifests"].items()}
    assert {name: len(rows) for name, rows in groups.items()} == {
        "exact5": 5, "train100": 100, "train105": 105, "dev20": 20, "final50": 50}
    independent = ("exact5", "train100", "dev20", "final50")
    for left, right in itertools.combinations(independent, 2):
        assert not {physical_key(case) for case in groups[left]} & {physical_key(case) for case in groups[right]}
    for name in ("train100", "dev20", "final50"):
        for case in groups[name]:
            assert case.seed == 0 and case.horizon is None and not case.disturbances and not case.disturbance_ids
            assert all(0 <= offset <= 6 for offset in case.departure_offsets)
            assert any(case.departure_offsets)
    assert physical_key(PFChCase("tutorial")) == physical_key(PFChCase("tutorial", departure_offsets=(0, 0)))
    assert len({physical_key(case) for name in independent for case in groups[name]
                if case.preset == "tutorial"}) == 35
    for name, meta in protocol["manifests"].items():
        assert hashlib.sha256(Path(meta["path"]).read_bytes()).hexdigest() == meta["sha256"]
    with pytest.raises(FileExistsError):
        prepare(["--output-dir", str(tmp_path)])


def test_atomic_snapshot_requires_both_files_and_freezes_both_hashes(tmp_path):
    snapshots = tmp_path / "snapshots"
    checkpoint = _snapshot(snapshots)
    sidecar = checkpoint.with_suffix(".json")
    saved_meta = sidecar.read_text()
    sidecar.unlink()
    assert monitor.completed_snapshot(snapshots, 1) is None
    sidecar.write_text(saved_meta)
    temporary = checkpoint.with_suffix(".pt.tmp")
    temporary.touch()
    assert monitor.completed_snapshot(snapshots, 1) is None
    temporary.unlink()
    assert monitor.completed_snapshot(snapshots, 1) == (checkpoint, sidecar)
    frozen, weight_hash, meta_hash = monitor.freeze_snapshot(checkpoint, sidecar, tmp_path / "frozen")
    assert frozen.read_bytes() == checkpoint.read_bytes()
    assert weight_hash == monitor.digest(checkpoint) and meta_hash == monitor.digest(sidecar)
    sidecar.write_text(saved_meta + "\n")
    with pytest.raises(ValueError, match="differs"):
        monitor.freeze_snapshot(checkpoint, sidecar, tmp_path / "frozen")


def test_monitor_opens_only_exact5_and_dev20_inputs_and_rejects_reserved_roles(tmp_path):
    _prepare(tmp_path)
    (tmp_path / "final50-cases.json").write_text("must never be opened by a candidate monitor")
    paths, hashes = monitor.load_monitor_inputs(tmp_path)
    assert set(paths) == set(hashes) == {"exact5", "dev20"}
    dev = paths["dev20"]
    payload = json.loads(dev.read_text())
    payload["split"] = "test"
    dev.write_text(json.dumps(payload))
    with pytest.raises(ValueError, match="role/count"):
        monitor.load_monitor_inputs(tmp_path)


def test_monitor_evaluates_owned_snapshot_serially_and_preserves_native_fault_metrics(tmp_path, monkeypatch):
    cases = tmp_path / "cases"
    _prepare(cases)
    (cases / "final50-cases.json").write_text("must never be opened")
    snapshots = tmp_path / "snapshots"
    source = _snapshot(snapshots)
    calls = []

    def fake_evaluate(argv):
        args = dict(zip(argv[::2], argv[1::2], strict=True))
        manifest = Path(args["--cases"])
        checkpoint = Path(args["--checkpoint"])
        output = Path(args["--output"])
        assert args["--threads"] == "1" and checkpoint != source
        assert manifest.name in ("exact5-cases.json", "dev20-cases.json")
        calls.append(manifest.name)
        values = json.loads(manifest.read_text())["cases"]
        rows = [{"case": row, "complete_mission": False, "steps": 17,
                 "observed_malfunction_counter_increases": [{"handle": 0, "step": 12}],
                 "native_on_map_positive_counter_steps": 3} for row in values]
        report = {"summary": {"ckpt:owned": {"complete_missions": 0, "cases": len(rows),
            "arrived": 1, "trains": 3, "lateness": 9, "technical_failures": 1}},
            "checkpoints": {"ckpt:owned": {"sha256": monitor.digest(checkpoint)}},
            "manifest_sha256": monitor.digest(manifest), "results": rows}
        output.write_text(json.dumps(report))
        return report

    monkeypatch.setattr(monitor, "evaluate", fake_evaluate)
    state = monitor.monitor(["--snapshot-dir", str(snapshots), "--epochs", "1", "--cases-dir", str(cases),
                             "--output-dir", str(tmp_path / "monitor"), "--max-wait-minutes", "1"])
    assert state["state"] == "complete" and state["completed_epochs"] == [1]
    assert state["final_cases_evaluated"] is False
    assert calls == ["exact5-cases.json", "dev20-cases.json"]
    for score in state["scores"]:
        count = 5 if score["split"] == "exact5" else 20
        assert score["steps"] == 17 * count and score["technical_failures"] == 1
        assert score["observed_native_counter_increases"] == count
        assert score["native_on_map_positive_counter_steps"] == count * 3
        assert score["sidecar_sha256"] == monitor.digest(source.with_suffix(".json"))
    assert (tmp_path / "monitor/scores.tsv").is_file()
