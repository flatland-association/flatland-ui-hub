"""Freeze second confirmation inputs only; no policy/teacher/outcome access."""
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
SEED = 202611131825


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def physical(case):
    preset = case["preset"]
    return preset, tuple(case.get("departure_offsets") or (0,) * (2 if preset == "tutorial" else 3))


def publish(path, value):
    if path.exists():
        raise FileExistsError(f"refusing to replace frozen file: {path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def main():
    manifest_path = HERE / "inputs/confirmation100-v2-cases.json"
    protocol_path = HERE / "confirmation100-v2-protocol.json"
    if manifest_path.exists() or protocol_path.exists():
        raise FileExistsError("second confirmation already frozen")
    exclusions = [ROOT / "docs/examples/uc2-rl/inputs/train105-cases.json",
                  HERE / "inputs/known125-cases.json", HERE / "inputs/confirmation84-cases.json"]
    excluded_hashes = {str(p.relative_to(ROOT)): digest(p) for p in exclusions}
    excluded = {physical(case) for p in exclusions for case in json.loads(p.read_text())["cases"]}
    assert len(excluded) == 309
    rng = random.Random(SEED)
    cases, per_map = [], {}
    for preset in PRESETS:
        count = 2 if preset == "tutorial" else 3
        maximum = 9 if preset == "tutorial" else 6
        available = [v for v in itertools.product(range(maximum + 1), repeat=count)
                     if (preset, v) not in excluded]
        assert len(available) == (51 if preset == "tutorial" else 278)
        selected = rng.sample(available, 20)
        if preset == "tutorial":
            assert all(any(value >= 7 for value in vector) for vector in selected)
        for index, vector in enumerate(selected):
            cases.append({"preset": preset, "seed": 0, "departure_offsets": list(vector),
                          "disturbance_ids": [], "disturbances": [], "horizon": None,
                          "case_id": f"uc2-roam-performance-confirmation-v2-{preset}-{index:03d}"})
        per_map[preset] = {"trains": count, "offset_range": [0, maximum],
                          "excluded_prior_vectors": sum(p == preset for p, _ in excluded),
                          "available_before_sampling": len(available), "sampled": 20,
                          "distribution_change": ("Range0..9; at least one coordinate>=7 because all49old0..6pairs are excluded" if preset == "tutorial" else "Same0..6coordinate domain; sampled without replacement after excluding all65prior vectors")}
    physicals = {physical(c) for c in cases}
    assert len(cases) == len(physicals) == 100 and not physicals & excluded
    fixture_names = ("scenario.pkl", "scenario.json", "generator.json", "config.json", "draw.json")
    fixtures = {f"backend/app/fixtures/plan-b/{p}/{n}": digest(ROOT / "backend/app/fixtures/plan-b" / p / n)
                for p in PRESETS for n in fixture_names}
    source_names = ("backend/lab/marl/evaluate_uc2_roam_runtime.py", "backend/lab/marl/pf_ch_episode.py",
                    "backend/app/policies/learned/uc2_roam_policy.py", "backend/app/policies/learned/uc2_roam_bundle.py",
                    "backend/app/policies/learned/roam_check.py", "backend/app/policies/learned/roam_joint_check.py")
    sources = {name: digest(ROOT / name) for name in source_names}
    bundle_file = ROOT / "backend/app/policies/learned/checkpoints/uc2_roam_specialists.json"
    bundle = json.loads(bundle_file.read_text())
    reference_models = {p: entry["sha256"] for p, entry in bundle["models"].items()}
    now = datetime.now(timezone.utc).isoformat()
    manifest = {"schema": "uc2-roam-performance-confirmation-v2-cases-v1", "split": "test",
                "created_at_utc": now, "sampling_seed": SEED,
                "scope": "100newinputs:20perUC2within0..6and20Tutorialpairs0..9withonecoordinate>=7; native horizons/faults/speeds unchanged",
                "cases": cases}
    assert excluded_hashes == {str(p.relative_to(ROOT)): digest(p) for p in exclusions}
    assert all(digest(ROOT / name) == h for name, h in fixtures.items())
    assert all(digest(ROOT / name) == h for name, h in sources.items())
    publish(manifest_path, manifest)
    protocol = {"schema": "uc2-roam-performance-confirmation-v2-protocol-v1", "created_at_utc": now,
                "manifest": "inputs/confirmation100-v2-cases.json", "manifest_sha256": digest(manifest_path),
                "generator": Path(__file__).name, "generator_sha256": digest(__file__), "sampling_seed": SEED,
                "fixture_order": list(PRESETS), "cases": 100, "train_missions": 280, "per_fixture": per_map,
                "algorithm": "One random.Random(seed), sample20fromlexicographicitertools.product(range(maximum+1),repeat=n) after input-only exclusions, sequentially in fixture_order",
                "operational_key": ["preset", "departure_offsets_empty_means_all_zero"],
                "excluded_manifest_sha256": excluded_hashes, "excluded_union_unique_cases": 309,
                "new_internal_duplicates": 0, "new_overlap_with_excluded_union": 0,
                "policy_outcomes_used_for_sampling": False, "confirmation_outcomes_opened": False,
                "training_or_rollouts_started_by_generator": False,
                "fixture_sha256": fixtures, "native_horizons_fault_schedules_speeds_preserved": True,
                "source_commit_at_input_freeze": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                "source_sha256_at_input_freeze": sources,
                "reference_bundle_manifest_sha256_at_input_freeze": digest(bundle_file),
                "reference_model_sha256_at_input_freeze": reference_models,
                "reference_identity_is_not_the_final_candidate_lock": True,
                "training_exclusion_requirement": "Exclude the20reserved0..6vectors for eachUC2map from any dense teacher/training collection. For UC2-1/2 this leaves323of343vectors each. Exclude all20newTutorialpairs as well.",
                "allowed_before_opening": "Use only prior309known/training inputs for candidate selection; final model/bundle/source/parameters/tests must be frozen separately before evaluating these100.",
                "allowed_after_opening": "Retain every outcome against the fixed PP method; no candidate tuning/selection from these100 while calling them fresh. Any later tuning makes this a development/regression set.",
                "distribution_limits": "UC2range remains0..6, conditional on unseen vectors. Tutorial deliberately extends to0..9; all selectedpairs have>=7, so report its20cases separately. Same five small maps/native schedules, no new-map or universal guarantee.",
                "previous84_status": "Opened outcomes are now known development evidence and remain immutable; this protocol never reads their outcome file."}
    publish(protocol_path, protocol)
    print(json.dumps({"manifest": str(manifest_path.relative_to(ROOT)), "sha256": digest(manifest_path),
                      "protocol_sha256": digest(protocol_path), "created_at_utc": now, "cases": 100,
                      "excluded_prior_unique_cases": len(excluded), "overlap": 0}))


if __name__ == "__main__":
    main()
