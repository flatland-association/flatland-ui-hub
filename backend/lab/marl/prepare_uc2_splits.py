"""Freeze disjoint UC2 timetable inputs without rolling out any policy."""
from __future__ import annotations

import argparse
import hashlib
import itertools
import json
import random
from pathlib import Path

from app.policies.learned.uc2_observation import SCENARIO_IDS
from lab.marl.pf_ch_episode import PFChCase, load_cases

TRAIN_COUNTS = {preset: 2 if preset == "tutorial" else 3 for preset in SCENARIO_IDS}
FIXTURE_NAMES = ("scenario.pkl", "scenario.json", "generator.json", "config.json", "draw.json")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def physical_key(case: PFChCase) -> tuple[str, tuple[int, ...]]:
    """Canonicalise the empty exact-fixture vector to explicit zero offsets."""
    return case.preset, tuple(case.departure_offsets or (0,) * TRAIN_COUNTS[case.preset])


def prepare(argv: list[str] | None = None) -> dict:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=2026111303)
    args = parser.parse_args(argv)
    root = args.output_dir
    root.mkdir(parents=True, exist_ok=True)
    exact_path = root / "exact5-cases.json"
    exact_hash = digest(exact_path)
    exact = load_cases(exact_path)
    if len(exact) != 5 or {case.preset for case in exact} != set(SCENARIO_IDS):
        raise ValueError("the five explicit exact-demo training fixtures are required")
    if any(any(physical_key(case)[1]) or case.seed != 0 or case.horizon is not None
           or case.disturbance_ids or case.disturbances for case in exact):
        raise ValueError("exact demos must preserve native fixture inputs")
    outputs = {"train100": root / "train100-cases.json", "train105": root / "train105-cases.json",
               "dev20": root / "dev20-cases.json", "final50": root / "final50-cases.json"}
    protocol_path = root / "split-protocol.json"
    if any(path.exists() for path in [*outputs.values(), protocol_path]):
        raise FileExistsError("refusing to replace frozen UC2 inputs")
    backend = Path(__file__).resolve().parents[2]
    fixture_hashes = {f"app/fixtures/plan-b/{preset}/{name}": digest(
        backend / "app/fixtures/plan-b" / preset / name)
        for preset in SCENARIO_IDS for name in FIXTURE_NAMES}
    combined = hashlib.sha256(json.dumps(fixture_hashes, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    rng = random.Random(args.seed)
    groups = {"train100": [], "dev20": [], "final50": []}
    specifications = (("train100", "train", 20), ("dev20", "validation", 4), ("final50", "test", 10))
    for preset in SCENARIO_IDS:
        offsets = [values for values in itertools.product(range(7), repeat=TRAIN_COUNTS[preset]) if any(values)]
        rng.shuffle(offsets)
        position = 0
        for name, role, count in specifications:
            for index, values in enumerate(offsets[position:position + count]):
                groups[name].append(PFChCase(preset=preset, seed=0, departure_offsets=values,
                                             case_id=f"uc2-{role}-{preset}-{index:03d}"))
            position += count
    groups["train105"] = [*exact, *groups["train100"]]
    independent = {"exact5": exact, **{name: groups[name] for name in ("train100", "dev20", "final50")}}
    keys = {name: {physical_key(case) for case in cases} for name, cases in independent.items()}
    overlaps = {f"{left}/{right}": len(keys[left] & keys[right])
                for left, right in itertools.combinations(independent, 2)}
    if any(overlaps.values()) or any(len(keys[name]) != len(cases) for name, cases in independent.items()):
        raise ValueError("UC2 splits overlap or contain duplicate operational inputs")
    if len({case.case_id for cases in independent.values() for case in cases}) != 175:
        raise ValueError("UC2 split case IDs must be unique")
    for name, path in outputs.items():
        role = "validation" if name == "dev20" else "test" if name == "final50" else "train"
        path.write_text(json.dumps({"schema": "uc2-learning-cases-v1", "split": role,
            "sampling_seed": args.seed, "fixture_combined_sha256": combined,
            "scope": "Fixed native horizons, speeds and scheduled faults; independent per-train departure offsets0..6",
            "cases": [case.to_dict() for case in groups[name]]}, indent=2) + "\n")
    if digest(exact_path) != exact_hash or any(digest(backend / name) != value for name, value in fixture_hashes.items()):
        raise RuntimeError("UC2 fixture input changed during preparation")
    protocol = {"schema": "uc2-fixed-input-protocol-v1", "sampling_seed": args.seed, "native_case_seed": 0,
        "generator_sha256": digest(Path(__file__)), "fixture_sha256": fixture_hashes,
        "fixture_combined_sha256": combined, "departure_offset_range": [0, 6],
        "sampling": "Uniform independent-coordinate vectors sampled without replacement; exact zero vectors reserved",
        "native_horizons_speeds_faults_preserved": True, "policy_outcomes_used": False,
        "final_outcomes_opened": False, "final_selection_allowed": False,
        "operational_key": ["preset", "departure_offsets_empty_means_all_zero"],
        "pairwise_operational_overlaps": overlaps,
        "train105_is_exact5_plus_train100": True,
        "manifests": {name: {"path": str(path), "sha256": digest(path), "cases": len(load_cases(path))}
                      for name, path in {"exact5": exact_path, **outputs}.items()}}
    protocol_path.write_text(json.dumps(protocol, indent=2) + "\n")
    print(json.dumps(protocol, indent=2), flush=True)
    return protocol


if __name__ == "__main__":
    prepare()
