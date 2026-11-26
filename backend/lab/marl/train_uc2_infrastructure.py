"""Distil the four UC2 scenario specialists into one scenario-blind UC2-track model.

See docs/plans/uc2-rl-per-infrastructure.md. Teachers are the current per-scenario
checkpoints (pinned by path). Teacher data:
  * every multi-choice decision of each teacher on its scenario's known
    systematic timetables (all 343 per scenario), and
  * off-plan states from user-command collection dirs (prior_obs), relabelled
    with the teacher of that scenario.
The student never reads the scenario one-hot: it is zeroed in training and the
checkpoint declares ``blind_inputs`` so the runtime zeroes it as well.

Loss = CE(teacher action) + kl * KL(teacher || student) + margin * argmax hinge,
on sampled batches or (``--full-batch``, for a final polish) on every state.
Every ``--eval-every`` updates, disagreement with the teacher is measured on all
known-timetable states; at zero, the candidate is saved and gates G2/G1 run on
every UC2 scenario. The held-out user-command suite (G3) is run separately with
lab.marl.evaluate_uc2_user_commands.

Usage (from backend/):
  python -m lab.marl.train_uc2_infrastructure --out DIR [--perturbed DIR] [--teacher uc2-1=PATH ...]
"""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import multiprocessing as mp
import os
import pickle
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from lab.marl.train_uc2_recovery import SYSTEMATIC, _gate_init, gates, sha, tensor_sha

UC2_TRACK = ("uc2-1", "uc2-2", "uc2-3", "uc2-4")

_teachers: dict[str, str] = {}


def _init(teachers):
    _gate_init()
    _teachers.update(teachers)


def _teacher_episode(case_dict):
    from lab.marl import uc2_user_commands as U
    from lab.marl.pf_ch_episode import PFChCase
    case = PFChCase.from_dict(case_dict)
    result, records = U.run_episode(case, U.checkpoint_driver(Path(_teachers[case.preset])), record=True)
    return case.preset, bool(result["complete_mission"]), [(r["obs"], r["mask"]) for r in records]


def teacher_states(teachers: dict[str, str], cache: Path | None, workers: int):
    """{scenario: (obs, mask)} of every multi-choice teacher decision on its known timetables."""
    if cache and cache.exists():
        return pickle.loads(cache.read_bytes())
    from lab.marl.pf_ch_episode import load_cases
    cases = [c.to_dict() for c in load_cases(SYSTEMATIC) if c.preset in teachers]
    out = {p: ([], []) for p in teachers}
    with mp.get_context("spawn").Pool(workers, initializer=_init, initargs=(teachers,), maxtasksperchild=60) as pool:
        for preset, complete, rows in pool.imap_unordered(_teacher_episode, cases, chunksize=4):
            if not complete:
                raise RuntimeError(f"teacher {preset} does not complete a known timetable")
            out[preset][0].extend(o for o, _ in rows)
            out[preset][1].extend(m for _, m in rows)
    out = {p: (np.asarray(o, dtype=np.float32), np.asarray(m, dtype=np.float32)) for p, (o, m) in out.items()}
    if cache:
        cache.write_bytes(pickle.dumps(out))
    return out


def main() -> None:
    from app.policies.learned import uc2_bundle
    from app.policies.learned.uc2_observation import SCENARIO_IDS, SCENARIO_OFFSET
    from app.policies.learned.uc2_roam_bundle import teacher_checkpoint
    from lab.marl import uc2_user_commands as U
    from lab.marl.common import load_model, masked_logits
    from lab.marl.pf_ch_episode import PFChCase

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--teacher", action="append", default=[],
                        help="SCENARIO=PATH (default: the pinned uc2_roam_teacher_*.pt checkpoints)")
    parser.add_argument("--perturbed", type=Path, action="append", default=[], help="collection dir, repeatable")
    parser.add_argument("--teacher-cache", type=Path)
    parser.add_argument("--base", type=Path, default=uc2_bundle.CHECKPOINT)
    parser.add_argument("--init", type=Path, help="continue from an earlier student checkpoint (polish phase)")
    parser.add_argument("--hidden", type=int, default=256, choices=(128, 256, 384))
    parser.add_argument("--steps", type=int, default=30000)
    parser.add_argument("--batch", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--kl", type=float, default=1.0)
    parser.add_argument("--margin", type=float, default=5.0)
    parser.add_argument("--eval-every", type=int, default=1000)
    parser.add_argument("--standardize", action="store_true",
                        help="train on per-feature standardised inputs; the scaling is folded into the first layer on save")
    parser.add_argument("--gap-cap", type=float, default=1.0,
                        help="largest logit margin the hinge demands; small values only ask for the right argmax")
    parser.add_argument("--gate-below", type=int, default=0,
                        help="also run gates on a new best candidate with at most this many known disagreements")
    parser.add_argument("--full-batch", action="store_true", help="exact gradient over all states per update")
    parser.add_argument("--balanced", action="store_true", help="draw the random part of each batch equally per scenario")
    parser.add_argument("--hard-fraction", type=float, default=0.5,
                        help="share of each batch drawn from states the student gets wrong or holds with a thin margin")
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--threads", type=int, default=4, help="Torch CPU threads for the fit")
    args = parser.parse_args()
    _gate_init()
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    args.out.mkdir(parents=True, exist_ok=True)
    teachers = {p: str(teacher_checkpoint(p)) for p in UC2_TRACK}
    teachers.update(dict(item.split("=", 1) for item in args.teacher))
    blind = [SCENARIO_OFFSET, SCENARIO_OFFSET + len(SCENARIO_IDS)]

    started = time.time()
    nominal = teacher_states(teachers, args.teacher_cache, args.workers)
    parts = []  # (scenario, obs, mask, is_nominal)
    for p in UC2_TRACK:
        parts.append((p, *nominal[p], True))
        for d in args.perturbed:
            data = np.load(d / f"{p}.npz")
            parts.append((p, data["prior_obs"], data["prior_mask"], False))
            if len(data["label_obs"]):
                parts.append((p, data["label_obs"], data["label_mask"], False))
    xs, ms, logits, scen, nom = [], [], [], [], []
    for p, obs, mask, is_nominal in parts:
        teacher = load_model(Path(teachers[p])).eval()
        x = torch.from_numpy(obs)
        with torch.no_grad():
            z = masked_logits(teacher(x)[0], torch.from_numpy(mask))
        x = x.clone()
        x[:, blind[0]:blind[1]] = 0
        xs.append(x); ms.append(torch.from_numpy(mask)); logits.append(z)
        scen.append(torch.full((len(x),), UC2_TRACK.index(p))); nom.append(torch.full((len(x),), is_nominal))
    x, m, zt = torch.cat(xs), torch.cat(ms), torch.cat(logits)
    scen, nom = torch.cat(scen), torch.cat(nom).bool()
    del xs, ms, logits
    mu = torch.zeros(x.shape[1])
    sd = torch.ones(x.shape[1])
    if args.standardize:  # fine timing differences (~1/horizon) need well-conditioned inputs
        mu = x.mean(0)
        sd = x.std(0)
        sd[sd < 1e-6] = 1.0
        x.sub_(mu).div_(sd)
    pt = zt.softmax(-1)
    yt = zt.argmax(-1)
    gap = (.5 * (zt.gather(1, yt[:, None]) - zt)).clamp(min(.05, args.gap_cap), args.gap_cap)
    others = m >= .5
    others.scatter_(1, yt[:, None], False)
    print(f"{len(x)} states ({int(nom.sum())} known-timetable), teachers {[Path(t).name for t in teachers.values()]}, "
          f"{time.time() - started:.0f}s", flush=True)

    # an --init checkpoint may be widened to --hidden; load_model keeps its function exactly
    model = load_model(args.init or args.base, hidden_size=args.hidden).train()
    with torch.no_grad():  # same function on standardised inputs: W x + b == (W sd) x~ + (b + W mu)
        first = model.trunk[0]
        first.bias.add_(first.weight @ mu)
        first.weight.mul_(sd)
    opt = torch.optim.Adam(model.parameters(), lr=args.lr)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, args.steps, eta_min=args.lr / 20)
    history, selected = [], None
    hard = torch.empty(0, dtype=torch.long)
    best_gated = float("inf")

    def losses(net, ix):
        """(CE + kl * KL, argmax-margin hinge) on the states ``ix``."""
        z = net(x[ix])[0]
        zm = masked_logits(z, m[ix])
        ce = F.cross_entropy(zm, yt[ix]) + args.kl * F.kl_div(zm.log_softmax(-1), pt[ix], reduction="batchmean")
        lead = z.gather(1, yt[ix][:, None]) - z
        hinge = (gap[ix] - lead).clamp(min=0).masked_fill(~others[ix], 0).max(-1).values.mean()
        return ce, hinge
    by_scenario = [torch.where(scen == i)[0] for i in range(len(UC2_TRACK))]
    for step in range(1, args.steps + 1):
        n_hard = int(args.hard_fraction * args.batch) if len(hard) else 0
        if args.balanced:
            per = (args.batch - n_hard) // len(UC2_TRACK)
            ix = torch.cat([g[torch.randint(len(g), (per,))] for g in by_scenario])
        else:
            ix = torch.randint(len(x), (args.batch - n_hard,))
        if n_hard:
            ix = torch.cat([ix, hard[torch.randint(len(hard), (n_hard,))]])
        opt.zero_grad()
        if args.full_batch:  # exact gradient over every state, accumulated in chunks
            ce = hinge = 0.0
            for chunk in torch.arange(len(x)).split(65536):
                c, h = losses(model, chunk)
                # the hinge is summed over states and spread over the current violators only,
                # so a handful of wrong states is not drowned by hundreds of thousands of easy ones
                (len(chunk) / len(x) * c + args.margin * h * len(chunk) / max(1, len(hard))).backward()
                ce += float(c) * len(chunk) / len(x)
                hinge += float(h) * len(chunk) / len(x)
        else:
            ce, hinge = losses(model, ix)
            (ce + args.margin * hinge).backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1)
        opt.step()
        sched.step()
        if step % args.eval_every and step != args.steps:
            continue
        model.eval()
        with torch.no_grad():
            full = torch.cat([model(xc)[0] for xc in x.split(65536)])
            pred = masked_logits(full, m).argmax(-1)
            thin = ((gap - (full.gather(1, yt[:, None]) - full)).masked_fill(~others, -1).max(-1).values > 0)
        model.train()
        wrong = pred != yt
        hard = torch.where(wrong | thin)[0]
        entry = {"step": step, "ce": round(float(ce), 5), "hinge": round(float(hinge), 5),
                 "known_disagreements": {p: int((wrong & nom & (scen == i)).sum()) for i, p in enumerate(UC2_TRACK)},
                 "offplan_disagreements": {p: int((wrong & ~nom & (scen == i)).sum()) for i, p in enumerate(UC2_TRACK)},
                 "hard_pool": int(len(hard)), "elapsed_seconds": round(time.time() - started)}
        print(f"  {entry}", flush=True)
        total = sum(entry["known_disagreements"].values())
        if total == 0 or step == args.steps or (total <= args.gate_below and total < best_gated):
            best_gated = min(best_gated, total)
            state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            # fold the standardisation back: the shipped model reads raw observations
            state["trunk.0.weight"] = state["trunk.0.weight"] / sd
            state["trunk.0.bias"] = state["trunk.0.bias"] - state["trunk.0.weight"] @ mu
            folded = load_model(args.init or args.base, hidden_size=args.hidden).eval()
            folded.load_state_dict(state)
            with torch.no_grad():
                raw_pred = torch.cat([masked_logits(folded(xc * sd + mu)[0], mc).argmax(-1)
                                      for xc, mc in zip(x.split(65536), m.split(65536))])
            entry["folded_known_disagreements"] = int(((raw_pred != yt) & nom).sum())
            print(f"    folded model on raw inputs: {entry['folded_known_disagreements']} known disagreements", flush=True)
            path = args.out / f"uc2-track-h{args.hidden}-s{args.seed}-step{step}.pt"
            meta = {
                "kind": "scenario-blind-infrastructure-model",
                "observation_schema": "uc2-context-v1", "obs_size": 313, "hidden_size": args.hidden,
                "num_hidden_layers": 3, "infrastructure": "uc2-track", "scenarios": list(UC2_TRACK),
                "blind_inputs": [blind],
                "base_checkpoint_sha256": sha(args.base), "model_tensor_sha256": tensor_sha(state),
                "init_checkpoint_sha256": sha(args.init) if args.init else None,
                "epochs_completed": int(step * args.batch / len(x)), "training_samples": len(x),
                "teacher_sha256": {p: sha(t) for p, t in teachers.items()},
                "training_dataset_sha256": [sha(d / f"{p}.npz") for d in args.perturbed for p in UC2_TRACK],
                "training_source_sha256": {n: sha(Path(__file__).parents[2] / n) for n in (
                    "lab/marl/train_uc2_infrastructure.py", "lab/marl/uc2_user_commands.py")},
                "training_hyperparameters": {"optimizer": "Adam", "lr": args.lr, "schedule": "cosine",
                                             "gradient_updates": step, "batch": args.batch, "kl": args.kl,
                                             "margin": args.margin, "hidden": args.hidden, "seed": args.seed,
                                             "hard_fraction": args.hard_fraction, "balanced": args.balanced,
                                             "full_batch": args.full_batch, "standardize": args.standardize,
                                             "gap_cap": args.gap_cap},
                "training_software": {n: importlib.metadata.version(n) for n in ("torch", "numpy", "flatland-rl")},
                "teacher_sources": ["uc2_scenario_specialists"],
                "teacher_source_counts": {"known_timetable_states": int(nom.sum()), "offplan_states": int((~nom).sum())},
                "training_method": "Distillation of the four UC2 scenario specialists into one model that does not read "
                                   "the scenario one-hot (CE + KL + argmax margin).",
                "correction_provenance": None,
                "experience_estimator_ready": False,
            }
            torch.save({"model": state, "meta": meta}, path)
            entry["checkpoint"] = path.name
            entry["gates"] = {}
            ok = True
            for p in UC2_TRACK:
                base_study, _ = U.run_episode(PFChCase(p), U.checkpoint_driver(Path(teachers[p])))
                g = gates(p, path, base_study, args.workers)
                entry["gates"][p] = g
                passed = g["G2"]["pass"] and g.get("G1", {}).get("pass", False)
                ok &= passed
                print(f"    {p}: G2 {g['G2']['pass']} G1 {g.get('G1', {}).get('pass')} "
                      f"(regrets {len(g.get('G1', {}).get('lateness_regrets', {}))}, "
                      f"incomplete {len(g.get('G1', {}).get('incomplete', []))})", flush=True)
                if not passed and total == 0:
                    break  # a zero-disagreement candidate failing is a bug worth stopping on
            history.append(entry)
            if ok:
                selected = path.name
                break
            print(f"    totals: regrets {sum(len(g.get('G1', {}).get('lateness_regrets', {})) for g in entry['gates'].values())}, "
                  f"lateness {sum(g.get('G1', {}).get('lateness', 0) for g in entry['gates'].values())}", flush=True)
            continue
        history.append(entry)
    report = {"schema": "uc2-per-infrastructure-fit-v1", "teachers": {p: Path(t).name for p, t in teachers.items()},
              "teacher_sha256": {p: sha(t) for p, t in teachers.items()}, "base": Path(args.base).name,
              "states": len(x), "known_states": int(nom.sum()), "selected": selected, "history": history,
              "elapsed_seconds": round(time.time() - started)}
    (args.out / "uc2-track-fit.json").write_text(json.dumps(report, indent=1))
    print(f"selected {selected}", flush=True)


if __name__ == "__main__":
    main()
