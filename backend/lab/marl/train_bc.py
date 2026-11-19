"""Train the native shared actor on explicit PP teacher data with masked CE.

Dataset splits and teacher provenance are checked before training. The saved
checkpoint uses the existing lab registry format; teacher labels never enter
the human-intervention log or its loader.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from app.policies.learned.lab_checkpoints import checkpoint_path
from lab.marl.collect_pp_demonstrations import load_demonstrations
from lab.marl.common import load_model, masked_logits, pick_device, save_checkpoint, seed_everything


def demonstration_tensors(records: list[dict]) -> tuple[torch.Tensor, ...]:
    """Return CPU features, masks, labels and positive sample weights."""
    return (
        torch.tensor(np.asarray([row["obs"] for row in records]), dtype=torch.float32),
        torch.tensor(np.asarray([row["mask"] for row in records]), dtype=torch.float32),
        torch.tensor([row["teacher_action"] for row in records], dtype=torch.long),
        torch.tensor([row.get("weight", 1.0) for row in records], dtype=torch.float32),
    )


def imitation_loss(model, observations, masks, actions, weights, focal_gamma: float = 0.0) -> torch.Tensor:
    """Masked weighted CE, optionally focusing on hard examples."""
    logits, _ = model(observations)
    losses = F.cross_entropy(masked_logits(logits, masks), actions, reduction="none")
    if focal_gamma:
        probability_error = (-torch.expm1(-losses)).clamp_min(torch.finfo(losses.dtype).tiny)
        losses = probability_error.pow(focal_gamma) * losses
    return (losses * weights).sum() / weights.sum()


def decision_sample_weights(observations: torch.Tensor, weights: torch.Tensor,
                            decision_weight: float = 1.0) -> torch.Tensor:
    """Scale sample weights at ready-to-depart and at-call states."""
    critical = (observations[:, 4] > .5) | (observations[:, 33] > 1.0 - 1e-6)
    return weights * torch.where(critical, decision_weight, 1.0)


def teacher_agreement(model, observations, masks, actions) -> dict:
    """Report overall and per-action agreement without claiming rollout success."""
    with torch.no_grad():
        # Bound hidden activations on larger teacher corpora; only the boolean
        # correctness vector is needed for the unchanged aggregate reductions.
        correct_parts = [
            masked_logits(model(observations[start:start + 8192])[0], masks[start:start + 8192])
            .argmax(dim=-1) == actions[start:start + 8192]
            for start in range(0, len(observations), 8192)
        ]
        correct = torch.cat(correct_parts) if correct_parts else torch.empty_like(actions, dtype=torch.bool)
    phases = {'ready': observations[:, 4] > .5,
              'ready_go': (observations[:, 4] > .5) & (actions == 2),
              'at_call': observations[:, 33] > 1.0 - 1e-6}
    return {"all": float(correct.float().mean()), "by_action": {
        str(action): float(correct[actions == action].float().mean())
        for action in actions.unique().tolist()
    }, "by_phase": {name: float(correct[selection].float().mean())
                      for name, selection in phases.items() if selection.any()}}



def _numeric_observation_key(observation, mask_bytes: bytes):
    """Pack Python numeric equality without rounding source float64 values.

    Zero has one representation so -0.0 and 0.0 still share the tuple key's
    equality. Rare integers not exactly representable in float64 retain their
    original value; normal normalized observation vectors use only bytes.
    """
    values = np.array(observation, dtype="<f8", copy=True)
    values[values == 0] = 0.0
    key = values.tobytes() + mask_bytes
    if np.any(np.abs(values) >= 2 ** 53):
        precise_integers = tuple((index, int(value)) for index, value in enumerate(observation)
                                 if isinstance(value, (int, np.integer)) and int(values[index]) != int(value))
        if precise_integers:
            return key, precise_integers
    return key


def observation_conflict_counts(records: list[dict]) -> tuple[int, int]:
    """Count rounded/exact contradictory labels with compact numeric keys."""
    rounded_actions, exact_actions = {}, {}
    for row in records:
        mask_bytes = np.asarray(row["mask"], dtype=np.uint8).tobytes()
        rounded_key = _numeric_observation_key(np.round(row["obs"], 5), mask_bytes)
        exact_key = _numeric_observation_key(row["obs"], mask_bytes)
        action_bit = 1 << row["teacher_action"]
        rounded_actions[rounded_key] = rounded_actions.get(rounded_key, 0) | action_bit
        exact_actions[exact_key] = exact_actions.get(exact_key, 0) | action_bit
    return (sum(bool(bits & (bits - 1)) for bits in rounded_actions.values()),
            sum(bool(bits & (bits - 1)) for bits in exact_actions.values()))



def save_training_snapshot(model, metadata: dict, directory: Path, name: str, epoch: int) -> Path:
    """Export owned CPU weights without moving the model or its optimiser.

    These checkpoints are inference snapshots for development selection. The
    ordinary final checkpoint still carries the optimiser and its old format.
    """
    stem = checkpoint_path(name).stem  # the normal checkpoint-name validation
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{stem}-epoch-{epoch:05d}.pt"
    # JSON primitives keep even TorchVersion metadata portable/weights-only loadable.
    meta = json.loads(json.dumps({**metadata, "observation_schema": model.observation_schema,
                                 "obs_size": model.trunk[0].in_features, "hidden_size": model.trunk[0].out_features,
                                 "num_hidden_layers": 3, "epochs_completed": epoch,
                                 "snapshot": True}))
    payload = {"model": {key: value.detach().cpu().clone()
                         for key, value in model.state_dict().items()}, "meta": meta}
    temporary = path.with_suffix(".pt.tmp")
    torch.save(payload, temporary)
    temporary.replace(path)
    sidecar = path.with_suffix(".json")
    temporary_sidecar = sidecar.with_suffix(".json.tmp")
    temporary_sidecar.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    temporary_sidecar.replace(sidecar)
    return path


def teacher_provenance(records: list[dict]) -> dict:
    """Keep old PP metadata stable and name every source in mixed supervision."""
    sources = sorted({row["source"] for row in records})
    return {"kind": "pp-bc" if sources == ["native_strict_pp"] else "verified-teacher-bc",
            "teacher_source": sources[0] if len(sources) == 1 else "mixed_verified_teachers",
            "teacher_sources": sources,
            "teacher_owners": sorted({row["owner"] for row in records}),
            "teacher_source_counts": {source: sum(row["source"] == source for row in records)
                                      for source in sources}}


def train(argv: list[str] | None = None) -> dict:
    """Fit a BC actor and save its provenance, seed and optimiser state."""
    args = build_parser().parse_args(argv)
    if args.epochs <= 0 or args.minibatch <= 0 or args.lr <= 0 or args.kl_weight < 0 or args.focal_gamma < 0 or args.decision_weight < 1:
        raise ValueError("positive epochs/minibatch/lr, nonnegative KL/focal gamma and decision weight >= 1 required")
    if args.threads < 1 or any(not math.isfinite(value) for value in (args.lr, args.kl_weight, args.focal_gamma, args.decision_weight)):
        raise ValueError('positive threads and finite training coefficients required')
    if args.hidden_size not in (None, 128, 256, 384):
        raise ValueError("hidden size must be 128, 256 or 384")
    if args.save_every < 0 or bool(args.snapshot_dir) != (args.save_every > 0):
        raise ValueError("use a positive --save-every together with --snapshot-dir, or omit both")
    torch.set_num_threads(args.threads)
    seed_everything(args.seed)
    records = load_demonstrations(args.dataset)
    observations, masks, actions, weights = demonstration_tensors(records)
    if args.balance_actions:
        counts = torch.bincount(actions, minlength=masks.shape[1]).float().clamp_min(1)
        weights = weights * (len(actions) / (len(actions.unique()) * counts[actions])).clamp(0.25, 4.0)
    source_root = Path(__file__).resolve().parents[2]
    source_paths = [Path(__file__), source_root / "lab/marl/collect_pp_demonstrations.py", source_root / "lab/marl/common.py",
                    source_root / "app/policies/learned/ecml_observation.py",
                    source_root / "app/policies/learned/learned_ppo_policy.py"]
    if records[0]["observation_schema"] in ("pf-ch-context-v1", "pf-ch-relative-v1", "uc2-context-v1"):
        source_paths.append(source_root / "app/policies/learned/pf_ch_observation.py")
    if records[0]["observation_schema"] == "pf-ch-relative-v1":
        source_paths.append(source_root / "app/policies/learned/pf_ch_relative_observation.py")
    if records[0]["observation_schema"] == "uc2-context-v1":
        source_paths.append(source_root / "app/policies/learned/uc2_observation.py")
    source_hashes = {str(path.relative_to(source_root)): hashlib.sha256(path.read_bytes()).hexdigest()
                     for path in source_paths}
    weights = decision_sample_weights(observations, weights, args.decision_weight)
    device = pick_device(args.device)
    schema = records[0]["observation_schema"]
    model = load_model(args.base, obs_size=observations.shape[1], observation_schema=schema,
                       hidden_size=args.hidden_size).to(device)
    observations, masks, actions, weights = (value.to(device) for value in (observations, masks, actions, weights))
    before = teacher_agreement(model, observations, masks, actions)
    sample_count = len(records)
    case_ids = sorted({row["case_id"] for row in records})
    rounded_conflicts, exact_conflicts = observation_conflict_counts(records)
    metadata = {
        **teacher_provenance(records), "base": str(args.base) if args.base else None,
        "base_sha256": hashlib.sha256(args.base.read_bytes()).hexdigest() if args.base else None,
        "source_sha256": source_hashes, "software": {"torch": str(torch.__version__), "numpy": str(np.__version__)},
        "split": "train", "samples": sample_count,
        "teacher_executors": sorted({row.get("teacher_executor", "schedules") for row in records}),
        "teacher_modes": sorted({row.get("teacher_mode", "static") for row in records}),
        "case_ids": case_ids, "observation_schema": schema, "hidden_size": model.trunk[0].out_features,
        "num_hidden_layers": 3,
        "action_counts": {str(action): int((actions == action).sum()) for action in actions.unique().tolist()},
        "sample_weight_range": [float(weights.min()), float(weights.max())],
        "datasets": [{"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                     for path in args.dataset],
        "hyperparameters": {"epochs": args.epochs, "minibatch": args.minibatch, "lr": args.lr,
                            "kl_weight": args.kl_weight, "balance_actions": args.balance_actions,
                            "seed": args.seed, "focal_gamma": args.focal_gamma, "decision_weight": args.decision_weight,
                            "hidden_size": model.trunk[0].out_features},
        "agreement_before": before, "agreement_after": before,
        "conflicting_observation_keys": rounded_conflicts,
        "conflicting_exact_observation_keys": exact_conflicts,
    }
    # Tensors and metadata now own everything needed for fitting; release the
    # larger Python rows before optimisation; conflict keys were already freed.
    del records
    reference_logp = None
    if args.kl_weight:
        with torch.no_grad():
            reference_logits, _ = model(observations)
            reference_logp = F.log_softmax(masked_logits(reference_logits, masks), dim=-1)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    model.train()
    for epoch in range(1, args.epochs + 1):
        permutation = torch.randperm(sample_count, device=device)
        loss_sum = 0.0
        for indices in permutation.split(args.minibatch):
            loss = imitation_loss(model, observations[indices], masks[indices], actions[indices], weights[indices], args.focal_gamma)
            if reference_logp is not None:
                logits, _ = model(observations[indices])
                logp = F.log_softmax(masked_logits(logits, masks[indices]), dim=-1)
                reference = reference_logp[indices]
                loss = loss + args.kl_weight * (reference.exp() * (reference - logp)).sum(dim=-1).mean()
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            loss_sum += float(loss.detach()) * len(indices)
        if epoch == 1 or epoch % max(1, args.epochs // 10) == 0 or epoch == args.epochs:
            print(json.dumps({"epoch": epoch, "loss": loss_sum / sample_count,
                              "agreement": teacher_agreement(model, observations, masks, actions)}), flush=True)
        if args.snapshot_dir and (epoch % args.save_every == 0 or epoch == args.epochs):
            snapshot_meta = {**metadata, "agreement_after": teacher_agreement(model, observations, masks, actions)}
            snapshot = save_training_snapshot(model, snapshot_meta, args.snapshot_dir, args.name, epoch)
            print(json.dumps({"snapshot": str(snapshot), "epoch": epoch}), flush=True)
    model.eval()
    after = teacher_agreement(model, observations, masks, actions)
    metadata["agreement_after"] = after
    path = save_checkpoint(args.name, model.to("cpu"), metadata, optimizer=optimizer)
    print(json.dumps({"checkpoint": str(path), "agreement": after}), flush=True)
    return {"checkpoint": path, "before": before, "after": after, "meta": metadata}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", action="append", required=True, type=Path)
    parser.add_argument("--name", required=True)
    parser.add_argument("--base", type=Path)
    parser.add_argument("--hidden-size", type=int, choices=(128, 256, 384),
                        help="preserve checkpoint width by default; widening preserves its initial function")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--minibatch", type=int, default=512)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--kl-weight", type=float, default=0.0)
    parser.add_argument("--focal-gamma", type=float, default=0.0)
    parser.add_argument("--decision-weight", type=float, default=1.0, help="extra weight for departures and at-call states")
    parser.add_argument("--balance-actions", action="store_true")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--threads", type=int, default=1)
    parser.add_argument("--save-every", type=int, default=0, help="snapshot interval in epochs; requires --snapshot-dir")
    parser.add_argument("--snapshot-dir", type=Path, help="archive periodic inference models outside the policy picker")
    return parser


if __name__ == "__main__":
    train()
