"""Freeze unseen inputs and assemble casewise PP comparisons without rollouts.

Only standard-library JSON/hash operations are performed. Run from any cwd.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import itertools
import json
from pathlib import Path
import random
import subprocess

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
PRESETS = ("uc2-1", "uc2-2", "uc2-3", "uc2-4", "tutorial")
FIXTURE_FILES = ("scenario.pkl", "scenario.json", "generator.json", "config.json", "draw.json")


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value, *, frozen=False):
    path = Path(path)
    if frozen and path.exists():
        raise FileExistsError(f"refusing to replace frozen input: {path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def physical(case):
    preset = case["preset"]
    return preset, tuple(case.get("departure_offsets") or (0,) * (2 if preset == "tutorial" else 3))


def freeze_confirmation(seed):
    target = HERE / "inputs/confirmation84-cases.json"
    protocol_path = HERE / "confirmation84-protocol.json"
    if target.exists() or protocol_path.exists():
        raise FileExistsError("confirmation inputs/protocol already exist")
    excluded = [ROOT / "docs/examples/uc2-rl/inputs/train105-cases.json",
                ROOT / "docs/examples/uc2-roam/inputs/dev20-cases.json",
                ROOT / "docs/examples/uc2-roam/inputs/final50-cases.json",
                ROOT / "docs/examples/uc2-roam/inputs/confirmation50-cases.json"]
    initial_hashes = {str(p.relative_to(ROOT)): digest(p) for p in excluded}
    old = {physical(c) for p in excluded for c in read(p)["cases"]}
    assert len(old) == 225
    rng = random.Random(seed)
    cases, counts = [], {}
    for preset in PRESETS:
        n = 2 if preset == "tutorial" else 3
        all_vectors = list(itertools.product(range(7), repeat=n))
        available = [v for v in all_vectors if (preset, v) not in old]
        count = len(available) if preset == "tutorial" else 20
        assert len(available) == (4 if preset == "tutorial" else 298)
        selected = rng.sample(available, count)
        counts[preset] = {"trains": n, "excluded_vectors": len(all_vectors) - len(available),
                          "remaining_before_sampling": len(available), "selected": count}
        for i, offsets in enumerate(selected):
            cases.append({"preset": preset, "seed": 0, "departure_offsets": list(offsets),
                          "disturbance_ids": [], "disturbances": [], "horizon": None,
                          "case_id": f"uc2-roam-performance-confirmation-{preset}-{i:03d}"})
    keys = {physical(c) for c in cases}
    assert len(cases) == len(keys) == 84 and not keys & old
    fixture_hashes = {f"backend/app/fixtures/plan-b/{p}/{name}": digest(
        ROOT / "backend/app/fixtures/plan-b" / p / name) for p in PRESETS for name in FIXTURE_FILES}
    sources = ["backend/lab/marl/roam_check.py", "backend/lab/marl/evaluate_uc2_roam.py",
               "backend/lab/marl/pf_ch_episode.py", "backend/app/policies/learned/learned_ppo_policy.py",
               "backend/app/policies/learned/uc2_observation.py"]
    source_hashes = {p: digest(ROOT / p) for p in sources}
    checkpoint = ROOT / "backend/app/policies/learned/checkpoints/uc2_demo_ppo.pt"
    checkpoint_hash = digest(checkpoint)
    assert checkpoint_hash == "01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668"
    created = datetime.now(timezone.utc).isoformat()
    manifest = {"schema": "uc2-roam-performance-confirmation-cases-v1", "split": "test",
                "created_at_utc": created, "sampling_seed": seed,
                "scope": "84 unseen native timetable variants:20perUC2 and all4remaining tutorial, offsets0..6",
                "cases": cases}
    assert initial_hashes == {str(p.relative_to(ROOT)): digest(p) for p in excluded}
    assert all(digest(ROOT / p) == h for p, h in fixture_hashes.items())
    assert source_hashes == {p: digest(ROOT / p) for p in sources}
    write(target, manifest, frozen=True)
    protocol = {"schema": "uc2-roam-performance-confirmation-protocol-v1", "created_at_utc": created,
                "manifest": "inputs/confirmation84-cases.json", "manifest_sha256": digest(target),
                "sampling_seed": seed, "cases": 84, "fixture_order": list(PRESETS),
                "per_fixture": counts, "departure_offset_range": [0, 6],
                "algorithm": "random.Random(seed).sample over lexicographic itertools.product(range(7),repeat=traincount) after exclusion; all4remaining tutorial vectors included",
                "operational_key": ["preset", "departure_offsets_empty_means_all_zero"],
                "excluded_manifest_sha256": initial_hashes, "excluded_union_unique_cases": 225,
                "new_internal_duplicates": 0, "new_overlap_with_excluded_union": 0,
                "policy_outcomes_used_for_sampling": False, "confirmation_outcomes_opened": False,
                "training_or_evaluation_performed_by_generator": False,
                "native_horizons_faults_speeds_preserved": True, "fixture_sha256": fixture_hashes,
                "checkpoint_sha256": checkpoint_hash,
                "source_commit_at_input_freeze": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "source_sha256_at_input_freeze": source_hashes,
                "generator_sha256": digest(__file__),
                "required_before_outcome_opening": "Lock final candidate variant/parameters/source/test hashes using only known cases. Source at input freeze is recorded, not a claim that no further known-case development occurs.",
                "allowed_after_outcome_opening": "Report every case against the frozen PP method; no selection/tuning from these84outcomes. Any subsequent tuned run makes this a known regression set.",
                "limitations": "Same five small maps/fixed fault schedules; tutorial contributes4rather than20cases because the0..6space is nearly exhausted. Not a new-map generalization claim."}
    write(protocol_path, protocol, frozen=True)
    print(json.dumps({"manifest": str(target.relative_to(ROOT)), "sha256": digest(target), "cases": len(cases), "protocol_sha256": digest(protocol_path)}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    freeze = sub.add_parser("freeze-confirmation")
    freeze.add_argument("--seed", type=int, default=202611131810)
    args = parser.parse_args()
    if args.command == "freeze-confirmation":
        freeze_confirmation(args.seed)


if __name__ == "__main__":
    main()
