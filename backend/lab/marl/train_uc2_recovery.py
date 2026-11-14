"""Fit one UC2 specialist on verified user-command corrections (DAgger), keeping its prior.

Loss = CE(verified corrections) + kl * KL(frozen base || candidate) + margin * hinge on
multi-choice states the base already handles: completed perturbed episodes from
collection and every known systematic timetable of the map. The hinge keeps each
prior argmax ahead of its alternatives; gates run only once no nominal decision flips. Starts from the base weights;
the architecture, observation schema and runtime are unchanged.

Every ``--eval-every`` updates a candidate is saved in the shipped export format
and, once it fits the labels, checked against:
  G2  the study timetable without commands: complete, lateness <= base;
  G1  every known systematic timetable of the map: complete, lateness <= PP casewise.
The first candidate passing both is selected. The held-out user-command suite
(G3) is run separately with lab.marl.evaluate_uc2_user_commands.

Since the per-infrastructure layout (docs/plans/uc2-rl-per-infrastructure.md) the four
UC2 scenarios share one model: a further round should collect with that model and refit
it on all four scenarios' labels (or refit the pinned teachers, then re-distil).

Usage (from backend/):
  python -m lab.marl.train_uc2_recovery --map uc2-2 --data DIR [--data DIR2] --out DIR
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import multiprocessing as mp
import os
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

ROOT = Path(__file__).resolve().parents[3]
SYSTEMATIC = ROOT / "docs/examples/uc2-roam-performance/inputs/systematic1472-v3-cases.json"
PP_REFERENCE = ROOT / "docs/examples/uc2-roam-performance/pp-reference-systematic1472-v3.json"


def sha(path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def tensor_sha(state: dict) -> str:
    digest = hashlib.sha256()
    for key, tensor in sorted(state.items()):
        digest.update(key.encode())
        digest.update(str(tensor.dtype).encode())
        digest.update(str(tuple(tensor.shape)).encode())
        digest.update(tensor.contiguous().numpy().tobytes())
    return digest.hexdigest()


def _gate_init():
    os.environ.setdefault("ONLINE_LEARNING_AUTOSTART", "0")
    os.environ.setdefault("STUDY_TRAJECTORIES_ENABLED", "0")
    torch.set_num_threads(1)


def _gate_case(job):
    from lab.marl import uc2_user_commands as U
    from lab.marl.pf_ch_episode import PFChCase
    case_dict, ckpt = job
    result, _ = U.run_episode(PFChCase.from_dict(case_dict), U.checkpoint_driver(Path(ckpt)))
    return case_dict["case_id"], result


def run_cases(cases, ckpt: Path, workers: int) -> dict:
    jobs = [(c.to_dict(), str(ckpt)) for c in cases]
    with mp.get_context("spawn").Pool(workers, initializer=_gate_init, maxtasksperchild=60) as pool:
        return dict(pool.imap_unordered(_gate_case, jobs, chunksize=4))


def gates(preset: str, ckpt: Path, base_study: dict, workers: int) -> dict:
    from lab.marl import uc2_user_commands as U
    from lab.marl.pf_ch_episode import PFChCase, load_cases

    study, _ = U.run_episode(PFChCase(preset), U.checkpoint_driver(ckpt))
    g2 = study["complete_mission"] and study["lateness"] <= base_study["lateness"]
    report = {"G2": {"pass": bool(g2), "lateness": study["lateness"], "base_lateness": base_study["lateness"],
                     "complete": study["complete_mission"]}}
    if not g2:
        return report
    cases = [c for c in load_cases(SYSTEMATIC) if c.preset == preset]
    pp = {r["case_id"]: r for r in json.loads(PP_REFERENCE.read_text())["records"]}
    results = run_cases(cases, ckpt, workers)
    incomplete = [cid for cid, r in results.items() if not r["complete_mission"]]
    regrets = {cid: r["lateness"] - pp[cid]["lateness"] for cid, r in results.items()
               if r["lateness"] > pp[cid]["lateness"]}
    report["G1"] = {"pass": not incomplete and not regrets, "cases": len(results),
                    "lateness": sum(r["lateness"] for r in results.values()),
                    "pp_lateness": sum(pp[c]["lateness"] for c in results),
                    "incomplete": incomplete, "lateness_regrets": regrets}
    return report


def nominal_prior(preset: str, base: Path, n: int, seed: int):
    """Multi-choice states of the base specialist on known systematic timetables (no commands)."""
    from lab.marl import uc2_user_commands as U
    from lab.marl.pf_ch_episode import PFChCase, load_cases
    cases = [c for c in load_cases(SYSTEMATIC) if c.preset == preset]
    random.Random(f"prior:{seed}:{preset}").shuffle(cases)
    obs, masks = [], []
    for case in [PFChCase(preset)] + cases[:n]:
        _, records = U.run_episode(case, U.checkpoint_driver(base), record=True)
        obs += [r["obs"] for r in records]
        masks += [r["mask"] for r in records]
    return np.array(obs, dtype=np.float32), np.array(masks, dtype=np.float32)


def main() -> None:
    from app.policies.learned.uc2_roam_bundle import checkpoint_for_scenario
    from lab.marl.common import load_model, masked_logits
    from lab.marl import uc2_user_commands as U
    from lab.marl.pf_ch_episode import PFChCase

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--map", required=True, choices=U.UC2_MAPS)
    parser.add_argument("--data", type=Path, action="append", required=True, help="collection dir, repeatable")
    parser.add_argument("--base", type=Path, help="base specialist (default: shipped)")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--kl", type=float, default=10.0)
    parser.add_argument("--label-weight", type=float, default=1.0)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--steps", type=int, default=800)
    parser.add_argument("--eval-every", type=int, default=100)
    parser.add_argument("--min-fit", type=float, default=0.9, help="label accuracy before gates run")
    parser.add_argument("--nominal-cases", type=int, default=400, help="known timetables for the prior (all by default)")
    parser.add_argument("--margin", type=float, default=1.0, help="weight of the prior argmax-margin hinge")
    parser.add_argument("--prior-batch", type=int, default=60000, help="prior states per update (all by default)")
    parser.add_argument("--conflict-radius", type=float, default=0.05,
                        help="drop a correction whose nearest known-timetable state is closer and has another action")
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    _gate_init()
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    base = args.base or checkpoint_for_scenario(args.map)
    args.out.mkdir(parents=True, exist_ok=True)

    datasets = [d / f"{args.map}.npz" for d in args.data]
    loaded = [np.load(p) for p in datasets]
    xl = torch.from_numpy(np.concatenate([d["label_obs"] for d in loaded]))
    ml = torch.from_numpy(np.concatenate([d["label_mask"] for d in loaded]))
    yl = torch.from_numpy(np.concatenate([d["label_action"] for d in loaded]))
    nominal_obs, nominal_mask = nominal_prior(args.map, base, args.nominal_cases, args.seed)
    xp = torch.from_numpy(np.concatenate([d["prior_obs"] for d in loaded] + [nominal_obs]))
    nominal = torch.zeros(len(xp), dtype=torch.bool)
    nominal[len(xp) - len(nominal_obs):] = True
    mp_ = torch.from_numpy(np.concatenate([d["prior_mask"] for d in loaded] + [nominal_mask]))
    frozen = load_model(base).eval()
    with torch.no_grad():
        nominal_action = masked_logits(frozen(torch.from_numpy(nominal_obs))[0],
                                       torch.from_numpy(nominal_mask)).argmax(-1)
    xn = torch.from_numpy(nominal_obs)
    distance, index = torch.cdist(xl, xn).min(1)
    conflict = (distance < args.conflict_radius) & (nominal_action[index] != yl)
    # Identical observations cannot carry two actions: the user-command state is
    # indistinguishable from a known timetable state where the base action is right.
    dropped = int(conflict.sum())
    xl, ml, yl = xl[~conflict], ml[~conflict], yl[~conflict]
    if not len(yl):
        raise SystemExit(f"{args.map}: no distinguishable verified corrections to learn from ({dropped} conflicting)")
    with torch.no_grad():
        prior_logits = masked_logits(frozen(xp)[0], mp_)
        prior_p = prior_logits.softmax(-1)
        prior_argmax = prior_logits.argmax(-1)
        # keep every prior decision ahead of its alternatives by (part of) its original gap
        prior_gap = (.5 * (prior_logits.gather(1, prior_argmax[:, None]) - prior_logits)).clamp(.05, 1.)
        others = mp_ >= .5
        others.scatter_(1, prior_argmax[:, None], False)
        base_label_fit = float((masked_logits(frozen(xl)[0], ml).argmax(-1) == yl).float().mean())
    print(f"{args.map}: {len(yl)} labels kept, {dropped} dropped as indistinguishable from known timetables "
          f"(base fits {base_label_fit:.2f}), {len(xp)} prior states", flush=True)

    base_study, _ = U.run_episode(PFChCase(args.map), U.checkpoint_driver(base))
    model = load_model(base).train()
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    base_meta = torch.load(base, map_location="cpu", weights_only=False).get("meta", {})
    history, selected = [], None
    started = time.time()
    for step in range(1, args.steps + 1):
        ix = torch.randint(len(xp), (args.prior_batch,))
        z = model(xp[ix])[0]
        logp = masked_logits(z, mp_[ix]).log_softmax(-1)
        kl = F.kl_div(logp, prior_p[ix], reduction="batchmean")
        lead = z.gather(1, prior_argmax[ix][:, None]) - z
        hinge = (prior_gap[ix] - lead).clamp(min=0).masked_fill(~others[ix], 0).max(-1).values.mean()
        ce = F.cross_entropy(masked_logits(model(xl)[0], ml), yl)
        loss = args.label_weight * ce + args.kl * kl + args.margin * hinge
        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
        opt.step()
        if step % args.eval_every and step != args.steps:
            continue
        model.eval()
        with torch.no_grad():
            fit = float((masked_logits(model(xl)[0], ml).argmax(-1) == yl).float().mean())
            flipped = masked_logits(model(xp)[0], mp_).argmax(-1) != prior_argmax
            flips, nominal_flips = int(flipped.sum()), int(flipped[nominal].sum())
        model.train()
        entry = {"step": step, "ce": round(float(ce), 4), "kl": round(float(kl), 5), "label_fit": round(fit, 3),
                 "hinge": round(float(hinge), 5), "prior_flips": flips, "nominal_flips": nominal_flips,
                 "prior_states": len(xp), "nominal_states": int(nominal.sum())}
        print(f"  step {step}: {entry}", flush=True)
        if (fit >= args.min_fit and nominal_flips == 0) or step == args.steps:
            state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            path = args.out / f"{args.map}-kl{args.kl:g}-s{args.seed}-step{step}.pt"
            meta = {
                "kind": "verified-teacher-bc-infrastructure-specialist",
                "observation_schema": "uc2-context-v1", "obs_size": 313,
                "hidden_size": int(base_meta.get("hidden_size", 128)), "num_hidden_layers": 3,
                "infrastructure": args.map, "base_checkpoint_sha256": sha(base),
                "model_tensor_sha256": tensor_sha(state), "epochs_completed": step,
                "training_samples": len(xl) + len(xp),
                "training_dataset_sha256": [sha(p) for p in datasets],
                "training_source_sha256": {n: sha(Path(__file__).parents[2] / n) for n in (
                    "lab/marl/train_uc2_recovery.py", "lab/marl/collect_uc2_recovery.py",
                    "lab/marl/uc2_user_commands.py")},
                "training_hyperparameters": {"optimizer": "Adam", "lr": args.lr, "gradient_updates": step,
                                             "prior_kl": args.kl, "correction_ce": args.label_weight,
                                             "prior_margin": args.margin, "prior_batch": args.prior_batch,
                                             "nominal_cases": args.nominal_cases, "seed": args.seed},
                "training_software": {n: importlib.metadata.version(n) for n in ("torch", "numpy", "flatland-rl")},
                "teacher_sources": ["verified_user_command_correction", "frozen_base_specialist_prior"],
                "teacher_source_counts": {"verified_user_command_correction": len(xl),
                                          "frozen_base_specialist_prior": len(xp)},
                "training_method": "DAgger on user-command perturbations: CE on verified one-step corrections "
                                   "(the whole commanded episode completes) plus KL to the frozen base specialist.",
                "correction_provenance": "lab.marl.uc2_user_commands.find_corrections",
                "experience_estimator_ready": False,
            }
            torch.save({"model": state, "meta": meta}, path)
            entry["checkpoint"] = path.name
            entry["gates"] = gates(args.map, path, base_study, args.workers)
            print(f"    gates: G2 {entry['gates']['G2']['pass']} "
                  f"G1 {entry['gates'].get('G1', {}).get('pass')} "
                  f"(regrets {len(entry['gates'].get('G1', {}).get('lateness_regrets', {}))}, "
                  f"incomplete {len(entry['gates'].get('G1', {}).get('incomplete', []))})", flush=True)
            if entry["gates"]["G2"]["pass"] and entry["gates"].get("G1", {}).get("pass"):
                selected = path.name
                history.append(entry)
                break
        history.append(entry)
    report = {"schema": "uc2-user-command-recovery-fit-v1", "map": args.map, "base": base.name,
              "base_sha256": sha(base), "labels": len(yl), "labels_dropped_conflicting": dropped, "base_label_fit": base_label_fit,
              "prior_states": len(xp), "data": [str(p) for p in datasets], "selected": selected,
              "history": history, "elapsed_seconds": round(time.time() - started)}
    (args.out / f"{args.map}-fit.json").write_text(json.dumps(report, indent=1))
    print(f"{args.map}: selected {selected}", flush=True)


if __name__ == "__main__":
    main()
