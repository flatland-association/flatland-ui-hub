"""Fine-tune a learned policy on the human's interventions — HG-DAgger style.

docs/plans/marl-lab-plan.md, step 3. Reads every
`lab/runs/<session>/interventions.jsonl` (step 2, app/core/intervention_log.py)
and keeps the lines a human made (`owner == "human"`; system holds are
dropped). Each line is a (state, AI action, human action) triple. The loss:

    cross-entropy(masked logits(obs), human_action)              HG-DAgger
  + kl_weight * KL(base policy || new policy) on rollout states  keep the rest

The second term is a distillation to the starting policy on states it visits
itself, so the network learns the corrections without forgetting how to drive
everywhere else (a few dozen overrides would otherwise overwrite it).

Prints how often the greedy policy picks the human's action before and after,
on all human lines and on the ones where the AI disagreed, and how many
rollout states changed their greedy action.

Run from backend/:

    python -m lab.marl.finetune_interventions --name corrected
    python -m lab.marl.finetune_interventions --name corrected-2 --base lab/checkpoints/corrected.pt \\
        --scenario pf-ch-corridor --epochs 300
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn.functional as F

from app.core.intervention_log import runs_dir
from lab.marl.common import (
    DEFAULT_CHECKPOINT,
    N_ACTIONS,
    OBS_SIZE,
    load_model,
    make_env,
    make_obs_builder,
    masked_logits,
    observe,
    pick_device,
    save_checkpoint,
    seed_everything,
)


def load_interventions(root: Path) -> tuple[list[dict], dict[str, int]]:
    """Human lines usable for training, and a count of what was skipped why."""
    kept: list[dict] = []
    skipped = {"not_human": 0, "malformed": 0, "action_not_allowed": 0}
    for path in sorted(Path(root).glob("*/interventions.jsonl")):
        for raw in path.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            try:
                line = json.loads(raw)
            except ValueError:
                skipped["malformed"] += 1
                continue
            if line.get("owner") != "human":
                skipped["not_human"] += 1
                continue
            obs, mask, action = line.get("obs"), line.get("mask"), line.get("human_action")
            if (not isinstance(obs, list) or len(obs) != OBS_SIZE or not isinstance(mask, list)
                    or len(mask) != N_ACTIONS or not isinstance(action, int) or not 0 <= action < N_ACTIONS):
                skipped["malformed"] += 1
                continue
            if mask[action] < 0.5:
                # e.g. a STOP requested off the grid; the network can never pick it.
                skipped["action_not_allowed"] += 1
                continue
            kept.append(line)
    return kept, skipped


def rollout_states(model, scenarios: list[str], n_states: int, rng: random.Random,
                   max_episodes: int = 50) -> tuple[np.ndarray, np.ndarray]:
    """States the base policy visits itself (greedy), where a train has a choice."""
    feats, masks = [], []
    total = 0
    for episode in range(max_episodes):
        if total >= n_states:
            break
        env = make_env(scenarios[episode % len(scenarios)], rng)
        builder = make_obs_builder(env)
        handles = list(env.get_agent_handles())
        limit = int(getattr(env, "_max_episode_steps", 0) or 500)
        for _ in range(limit):
            features, mask = observe(builder, handles)
            with torch.no_grad():
                logits, _ = model(torch.from_numpy(features))
                actions = masked_logits(logits, torch.from_numpy(mask)).argmax(dim=-1)
            choice = mask.sum(axis=1) > 1
            feats.append(features[choice])
            masks.append(mask[choice])
            total += int(choice.sum())
            _, _, dones, _ = env.step({h: int(actions[i]) for i, h in enumerate(handles)})
            if dones.get("__all__") or total >= n_states:
                break
    if not feats:
        return np.zeros((0, OBS_SIZE), np.float32), np.zeros((0, N_ACTIONS), np.float32)
    return np.concatenate(feats)[:n_states], np.concatenate(masks)[:n_states]


def _greedy(model, obs: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    with torch.no_grad():
        logits, _ = model(obs)
        return masked_logits(logits, mask).argmax(dim=-1)


def agreement(model, obs, mask, human, disagreed) -> dict:
    """How often the greedy policy picks the human's action."""
    picks = _greedy(model, obs, mask)
    hit = (picks == human).float()
    out = {"all": round(float(hit.mean()), 4), "n": int(hit.numel())}
    if disagreed.any():
        out["where_ai_disagreed"] = round(float(hit[disagreed].mean()), 4)
        out["n_disagreed"] = int(disagreed.sum())
    return out


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--name", required=True, help="output: lab/checkpoints/<name>.pt, hub id lab:<name>")
    p.add_argument("--base", type=Path, default=DEFAULT_CHECKPOINT, help="policy to start from (and stay close to)")
    p.add_argument("--runs", type=Path, default=None, help="runs dir (default: MARL_LAB_RUNS_DIR or lab/runs)")
    p.add_argument("--scenario", action="append",
                   help="scenarios for the rollout states of the KL term (repeatable, default gen:30x30:5:*)")
    p.add_argument("--rollout-states", type=int, default=4096)
    p.add_argument("--epochs", type=int, default=200)
    p.add_argument("--lr", type=float, default=1e-4)
    p.add_argument("--kl-weight", type=float, default=1.0)
    p.add_argument("--kl-batch", type=int, default=512)
    p.add_argument("--device", default="auto", help="auto | cuda | mps | cpu")
    p.add_argument("--seed", type=int, default=0)
    return p


def finetune(argv: Optional[list[str]] = None) -> dict:
    args = build_parser().parse_args(argv)
    rng = seed_everything(args.seed)
    device = pick_device(args.device)
    root = args.runs or runs_dir()

    lines, skipped = load_interventions(root)
    print(f"{len(lines)} human interventions from {root} (skipped {skipped})")
    if not lines:
        raise SystemExit("nothing to learn from: no human interventions found")

    base = load_model(args.base).eval()
    model = load_model(args.base).to(device)
    scenarios = args.scenario or ["gen:30x30:5:*"]
    ref_obs_np, ref_mask_np = rollout_states(base, scenarios, args.rollout_states, rng)
    print(f"{len(ref_obs_np)} rollout states from {scenarios} for the KL term")

    h_obs = torch.tensor([ln["obs"] for ln in lines], dtype=torch.float32)
    h_mask = torch.tensor([ln["mask"] for ln in lines], dtype=torch.float32)
    h_act = torch.tensor([ln["human_action"] for ln in lines], dtype=torch.long)
    disagreed = torch.tensor([not ln.get("agreed", False) for ln in lines])
    ref_obs = torch.from_numpy(ref_obs_np)
    ref_mask = torch.from_numpy(ref_mask_np)
    with torch.no_grad():
        ref_logits, _ = base(ref_obs)
        ref_logp = F.log_softmax(masked_logits(ref_logits, ref_mask), dim=-1)
    base_greedy = ref_logp.argmax(dim=-1)

    before = agreement(base, h_obs, h_mask, h_act, disagreed)
    print(f"before: agrees with the human on {before}")

    h_obs_d, h_mask_d, h_act_d = h_obs.to(device), h_mask.to(device), h_act.to(device)
    ref_obs_d, ref_mask_d, ref_logp_d = ref_obs.to(device), ref_mask.to(device), ref_logp.to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    model.train()
    for epoch in range(1, args.epochs + 1):
        logits, _ = model(h_obs_d)
        ce = F.cross_entropy(masked_logits(logits, h_mask_d), h_act_d)
        kl = torch.zeros((), device=device)
        if len(ref_obs_d):
            idx = torch.randint(len(ref_obs_d), (min(args.kl_batch, len(ref_obs_d)),), device=device)
            r_logits, _ = model(ref_obs_d[idx])
            logp = F.log_softmax(masked_logits(r_logits, ref_mask_d[idx]), dim=-1)
            p_ref = ref_logp_d[idx].exp()
            kl = (p_ref * (ref_logp_d[idx] - logp)).sum(dim=-1).mean()
        loss = ce + args.kl_weight * kl
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        if epoch == 1 or epoch % max(1, args.epochs // 5) == 0 or epoch == args.epochs:
            print(f"epoch {epoch:>4}  ce {ce.item():.4f}  kl {kl.item():.5f}")
    model.eval()
    model_cpu = model.to("cpu")

    after = agreement(model_cpu, h_obs, h_mask, h_act, disagreed)
    changed = (
        float((_greedy(model_cpu, ref_obs, ref_mask) != base_greedy).float().mean()) if len(ref_obs) else 0.0
    )
    print(f"after:  agrees with the human on {after}")
    print(f"greedy action changed on {changed:.1%} of the base policy's own rollout states")

    meta = {
        "kind": "hg-dagger",
        "base": str(args.base),
        "runs": str(root),
        "interventions": len(lines),
        "skipped": skipped,
        "scenarios": scenarios,
        "hyperparameters": {"epochs": args.epochs, "lr": args.lr, "kl_weight": args.kl_weight,
                            "rollout_states": len(ref_obs_np), "seed": args.seed},
        "agreement_before": before,
        "agreement_after": after,
        "rollout_greedy_changed": round(changed, 4),
    }
    out = save_checkpoint(args.name, model_cpu, meta)
    print(f"saved {out} (hub policy lab:{args.name})")
    return {"checkpoint": out, "before": before, "after": after, "changed": changed}


def main() -> None:
    finetune()


if __name__ == "__main__":
    main()
