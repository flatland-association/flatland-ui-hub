"""Export a reviewed UC2 checkpoint without optimiser, RNG or absolute paths."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import torch

from app.policies.learned import uc2_bundle
from app.policies.learned.learned_ppo_policy import checkpoint_hidden_size, checkpoint_observation_size


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def export(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--evaluation", type=Path, required=True)
    parser.add_argument("--development-evaluation", type=Path)
    parser.add_argument("--fixture-hashes", type=Path, required=True)
    args = parser.parse_args(argv)
    source_hash = digest(args.checkpoint)
    source = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
    if source.get("meta", {}).get("observation_schema") != uc2_bundle.OBSERVATION_SCHEMA:
        raise ValueError("UC2 export requires the reviewed context313 schema")
    hidden_size = checkpoint_hidden_size(source)
    if checkpoint_observation_size(source) != uc2_bundle.OBS_SIZE:
        raise ValueError("UC2 export requires 313 model inputs")
    report = json.loads(args.evaluation.read_text())
    identities = [name for name, entry in report["checkpoints"].items() if entry["sha256"] == source_hash]
    if len(identities) != 1:
        raise ValueError("Evaluation must name exactly this frozen checkpoint")
    identity = identities[0]
    rows = [row for row in report["results"] if row["policy"] == identity]
    if (len(rows) != 5 or {row["case"]["preset"] for row in rows} != set(uc2_bundle.SCENARIOS)
            or not all(row["complete_mission"] and row["arrived"] == row["total"]
                       and row.get("planner_interventions", 0) == 0 for row in rows)):
        raise ValueError("Candidate must complete all five native missions without planner interventions")
    fixture_hashes = json.loads(args.fixture_hashes.read_text())
    fixtures = {scenario: fixture_hashes[f"app/fixtures/plan-b/{scenario}/scenario.pkl"]
                for scenario in uc2_bundle.SCENARIOS}
    for scenario, expected in fixtures.items():
        if digest(uc2_bundle._FIXTURES / scenario / "scenario.pkl") != expected:
            raise ValueError(f"Native fixture differs from the evaluation provenance: {scenario}")
    tensors = {name: tensor.detach().cpu().clone() for name, tensor in source["model"].items()}
    tensor_hash = hashlib.sha256()
    for name, tensor in sorted(tensors.items()):
        tensor_hash.update(name.encode())
        tensor_hash.update(str(tensor.dtype).encode())
        tensor_hash.update(str(tuple(tensor.shape)).encode())
        tensor_hash.update(tensor.contiguous().numpy().tobytes())
    meta = {
        "observation_schema": uc2_bundle.OBSERVATION_SCHEMA, "obs_size": uc2_bundle.OBS_SIZE,
        "hidden_size": hidden_size, "num_hidden_layers": 3, "kind": source["meta"].get("kind"),
        "source_checkpoint_sha256": source_hash, "model_tensor_sha256": tensor_hash.hexdigest(),
        "tensor_count": len(tensors), "parameter_count": sum(tensor.numel() for tensor in tensors.values()),
        "label": "UC2 RL (trained demos)",
        "scope": {"scenarios": list(uc2_bundle.SCENARIOS), "known_native_training_cases": 5,
                  "training_case_count": len(source["meta"].get("case_ids", [])),
                  "max_trains": 3, "native_horizons": {row["case"]["preset"]: row["horizon"] for row in rows}},
        "native_fixture_sha256": fixtures,
        "training_source_sha256": source["meta"].get("source_sha256", {}),
        "training_dataset_sha256": [entry["sha256"] for entry in source["meta"].get("datasets", [])],
        "training_hyperparameters": source["meta"].get("hyperparameters", {}),
        "epochs_completed": source["meta"].get("epochs_completed"),
        "validation": {"evaluation_sha256": digest(args.evaluation), "complete_missions": 5,
                       "trains": sum(row["total"] for row in rows), "arrived": sum(row["arrived"] for row in rows),
                       "lateness": sum(row["lateness"] for row in rows),
                       "scope": "Explicit native training fixtures; independent generalisation is measured separately"},
    }
    if args.development_evaluation:
        development = json.loads(args.development_evaluation.read_text())
        dev_ids = [name for name, entry in development["checkpoints"].items() if entry["sha256"] == source_hash]
        if len(dev_ids) != 1:
            raise ValueError("Development evaluation must name this exact frozen checkpoint")
        dev_rows = [row for row in development["results"] if row["policy"] == dev_ids[0]]
        if len(dev_rows) != 20 or not all(row["complete_mission"] for row in dev_rows):
            raise ValueError("Reviewed development evidence must complete the declared twenty-case gate")
        meta["validation"]["development"] = {
            "evaluation_sha256": digest(args.development_evaluation), "cases": len(dev_rows),
            "complete_missions": sum(row["complete_mission"] for row in dev_rows),
            "arrived": sum(row["arrived"] for row in dev_rows), "trains": sum(row["total"] for row in dev_rows),
            "lateness": sum(row["lateness"] for row in dev_rows),
            "scope": "Development cases reused for model selection; not a final holdout",
        }
    meta = json.loads(json.dumps(meta))
    if "/Users/" in json.dumps(meta) or "lab/runs" in json.dumps(meta) or "/private/" in json.dumps(meta):
        raise ValueError("Inference metadata must contain no machine-specific paths")
    target = uc2_bundle.CHECKPOINT
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".pt.tmp")
    torch.save({"model": tensors, "meta": meta}, temporary)
    temporary.replace(target)
    manifest = {**meta, "checkpoint_sha256": digest(target), "checkpoint_bytes": target.stat().st_size}
    sidecar = target.with_suffix(".json")
    temporary = sidecar.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(sidecar)
    if digest(args.checkpoint) != source_hash:
        raise RuntimeError("Source checkpoint changed during export")
    result = {"SOURCE_CHECKPOINT_SHA256": source_hash, "CHECKPOINT_SHA256": digest(target),
              "MANIFEST_SHA256": digest(sidecar), "checkpoint": str(target)}
    print(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    export()
