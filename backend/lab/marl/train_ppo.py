"""Train the lab's learned policy with PPO — docs/plans/marl-lab-plan.md, step 3.

Standard PPO (clipped surrogate, GAE, value and entropy terms) with **shared
parameters**: one network for all trains, the same `ActorCritic` and the same
FastTreeObs (36 features + 5-action mask) as the hub's learned policy, so the
result loads there as the policy `lab:<name>`.

Run from backend/:

    python -m lab.marl.train_ppo --name small --scenario "gen:30x30:5:*" --iterations 200
    python -m lab.marl.train_ppo --name ecml-ch --from app/policies/learned/checkpoints/ecml2026_ppo.pt \\
        --scenario pf-ch-wn-wal-conflict --scenario "gen:36x24:7:*" --lr 1e-4

Scenarios are preset ids or generated networks "gen:<W>x<H>:<trains>:<seed>";
seed "*" draws a new network per episode. Each episode picks one scenario at
random. `--device auto` takes cuda, then mps, then cpu.

Writes, next to each other in backend/lab/checkpoints/ (gitignored):

    <name>.pt    {"model": state_dict, "optimizer": ..., "meta": {...}}
    <name>.json  the meta, read by the registry without torch
    <name>.csv   one row per iteration: arrival rate, return, losses

## Reward shaping

Flatland's own reward is not used; the trainer computes one per train and
step from the env state, so it is visible here in one place:

- **arrival**: +1.0 the step a train reaches its target, minus
  0.01 per step of delay past `latest_arrival`, capped at 0.5. Arriving late
  is still clearly better than not arriving.
- **progress**: +0.01 per cell the train's shortest-path distance to its
  target shrinks (−0.01 when it grows). Potential-based, so it speeds up
  learning without changing which policy is best (Ng et al. 1999, γ≈1).
- **time**: −0.002 per step while a train is on the way (not waiting for its
  departure, not done), so standing still is never free.
- **not arrived**: −0.5 when the episode ends with the train short of its
  target — this is what a deadlock costs.

## Decisions and steps

A train *decides* in a step when its mask allows more than one action (on
the grid that is almost every step; WAITING trains only DO_NOTHING). Only
decisions become PPO samples. Rewards of steps without a decision are added to
the train's last decision. The end of the episode (target or step limit) is
treated as terminal; the value is not bootstrapped over the step limit.

Rollouts run on the CPU (a batch is one step's trains, too small for a GPU);
the PPO update runs on `--device`.
"""
from __future__ import annotations

import argparse
import csv
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torch.nn.functional as F
from flatland.envs.step_utils.states import TrainState

from app.policies.learned.lab_checkpoints import checkpoint_path
from lab.marl.common import (
    ActorCritic,
    load_model,
    make_env,
    make_obs_builder,
    masked_logits,
    observe,
    pick_device,
    save_checkpoint,
    seed_everything,
)

# Reward shaping — see the module docstring.
ARRIVAL_BONUS = 1.0
LATE_PENALTY_PER_STEP = 0.01
LATE_PENALTY_CAP = 0.5
PROGRESS_PER_CELL = 0.01
TIME_COST = 0.002
NOT_ARRIVED_PENALTY = 0.5


@dataclass
class Batch:
    obs: list = field(default_factory=list)
    mask: list = field(default_factory=list)
    action: list = field(default_factory=list)
    logp: list = field(default_factory=list)
    value: list = field(default_factory=list)
    advantage: list = field(default_factory=list)
    ret: list = field(default_factory=list)


@dataclass
class EpisodeStats:
    trains: int = 0
    arrived: int = 0
    returns: list = field(default_factory=list)
    steps: int = 0


def _distance(env, dist_map, handle: int) -> Optional[float]:
    agent = env.agents[handle]
    if agent.state == TrainState.DONE:
        return 0.0
    position = agent.position if agent.position is not None else agent.initial_position
    direction = agent.direction if agent.position is not None else agent.initial_direction
    if position is None or direction is None:
        return None
    value = float(dist_map[handle, position[0], position[1], int(direction)])
    return value if math.isfinite(value) else None


def _on_the_way(agent) -> bool:
    return agent.state not in (TrainState.WAITING, TrainState.DONE)


def run_episode(model: ActorCritic, scenario: str, rng, gamma: float, lam: float,
                batch: Batch, stats: EpisodeStats) -> None:
    """Play one episode with the stochastic policy and append its decisions,
    with GAE advantages, to `batch`."""
    env = make_env(scenario, rng)
    builder = make_obs_builder(env)
    handles = list(env.get_agent_handles())
    dist_map = env.distance_map.get()
    limit = int(getattr(env, "_max_episode_steps", 0) or 500)

    # Per train: its decisions in order, each [obs, mask, action, logp, value, reward].
    trajectories: dict[int, list[list]] = {h: [] for h in handles}
    episode_return = {h: 0.0 for h in handles}
    arrived = {h: False for h in handles}
    distance = {h: _distance(env, dist_map, h) for h in handles}

    for step in range(1, limit + 1):
        active = [h for h in handles if not arrived[h]]
        if not active:
            break
        features, mask = observe(builder, active)
        deciding = mask.sum(axis=1) > 1
        actions = {h: 0 for h in handles}
        if deciding.any():
            idx = np.flatnonzero(deciding)
            with torch.no_grad():
                obs_t = torch.from_numpy(features[idx])
                mask_t = torch.from_numpy(mask[idx])
                logits, values = model(obs_t)
                dist = torch.distributions.Categorical(logits=masked_logits(logits, mask_t))
                sampled = dist.sample()
                logps = dist.log_prob(sampled)
            for j, i in enumerate(idx):
                h = active[i]
                actions[h] = int(sampled[j])
                trajectories[h].append([features[i], mask[i], int(sampled[j]),
                                        float(logps[j]), float(values[j]), 0.0])

        env.step(actions)

        for h in active:
            agent = env.agents[h]
            reward = 0.0
            if agent.state == TrainState.DONE:
                arrived[h] = True
                latest = getattr(agent, "latest_arrival", None)
                late = max(0, step - int(latest)) if latest is not None else 0
                reward += ARRIVAL_BONUS - min(LATE_PENALTY_CAP, LATE_PENALTY_PER_STEP * late)
            new_distance = _distance(env, dist_map, h)
            if distance[h] is not None and new_distance is not None:
                reward += PROGRESS_PER_CELL * max(-1.0, min(1.0, distance[h] - new_distance))
            distance[h] = new_distance
            if _on_the_way(agent) and not arrived[h]:
                reward -= TIME_COST
            if trajectories[h]:
                trajectories[h][-1][5] += reward
            episode_return[h] += reward

    for h in handles:
        if not arrived[h]:
            if trajectories[h]:
                trajectories[h][-1][5] -= NOT_ARRIVED_PENALTY
            episode_return[h] -= NOT_ARRIVED_PENALTY

    # GAE per train; the last decision of each train is terminal.
    for h in handles:
        traj = trajectories[h]
        advantage = 0.0
        next_value = 0.0
        out = []
        for obs, msk, action, logp, value, reward in reversed(traj):
            delta = reward + gamma * next_value - value
            advantage = delta + gamma * lam * advantage
            out.append((obs, msk, action, logp, value, advantage, advantage + value))
            next_value = value
        for obs, msk, action, logp, value, adv, ret in reversed(out):
            batch.obs.append(obs)
            batch.mask.append(msk)
            batch.action.append(action)
            batch.logp.append(logp)
            batch.value.append(value)
            batch.advantage.append(adv)
            batch.ret.append(ret)

    stats.trains += len(handles)
    stats.arrived += sum(arrived.values())
    stats.returns.extend(episode_return.values())
    stats.steps += step


def ppo_update(model: ActorCritic, optimizer, batch: Batch, device, *, epochs: int,
               minibatch: int, clip: float, value_coef: float, entropy_coef: float,
               max_grad_norm: float) -> dict:
    obs = torch.from_numpy(np.stack(batch.obs)).to(device)
    mask = torch.from_numpy(np.stack(batch.mask)).to(device)
    action = torch.tensor(batch.action, dtype=torch.long, device=device)
    old_logp = torch.tensor(batch.logp, dtype=torch.float32, device=device)
    adv = torch.tensor(batch.advantage, dtype=torch.float32, device=device)
    ret = torch.tensor(batch.ret, dtype=torch.float32, device=device)
    adv = (adv - adv.mean()) / (adv.std() + 1e-8)

    n = obs.shape[0]
    sums = {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0, "approx_kl": 0.0, "clip_frac": 0.0}
    updates = 0
    model.train()
    for _ in range(epochs):
        order = torch.randperm(n, device=device)
        for start in range(0, n, minibatch):
            mb = order[start:start + minibatch]
            logits, values = model(obs[mb])
            dist = torch.distributions.Categorical(logits=masked_logits(logits, mask[mb]))
            logp = dist.log_prob(action[mb])
            ratio = torch.exp(logp - old_logp[mb])
            surrogate = torch.min(ratio * adv[mb], torch.clamp(ratio, 1 - clip, 1 + clip) * adv[mb])
            policy_loss = -surrogate.mean()
            value_loss = F.mse_loss(values, ret[mb])
            entropy = dist.entropy().mean()
            loss = policy_loss + value_coef * value_loss - entropy_coef * entropy

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)
            optimizer.step()

            with torch.no_grad():
                sums["policy_loss"] += float(policy_loss)
                sums["value_loss"] += float(value_loss)
                sums["entropy"] += float(entropy)
                sums["approx_kl"] += float((old_logp[mb] - logp).mean())
                sums["clip_frac"] += float(((ratio - 1).abs() > clip).float().mean())
            updates += 1
    model.eval()
    return {k: v / max(updates, 1) for k, v in sums.items()}


CSV_FIELDS = ["iteration", "env_steps", "episodes", "samples", "arrival_rate", "mean_return",
              "policy_loss", "value_loss", "entropy", "approx_kl", "clip_frac", "seconds"]


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--name", required=True, help="checkpoint name: lab/checkpoints/<name>.pt, hub id lab:<name>")
    p.add_argument("--from", dest="init", type=Path, default=None,
                   help="continue from this checkpoint (default: train from scratch)")
    p.add_argument("--scenario", action="append",
                   help='preset id or gen:WxH:trains:seed, seed "*" = new per episode (repeatable)')
    p.add_argument("--iterations", type=int, default=100)
    p.add_argument("--samples-per-iter", type=int, default=4096,
                   help="decisions collected per iteration (whole episodes, so a few more)")
    p.add_argument("--epochs", type=int, default=4)
    p.add_argument("--minibatch", type=int, default=512)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--lam", type=float, default=0.95)
    p.add_argument("--clip", type=float, default=0.2)
    p.add_argument("--value-coef", type=float, default=0.5)
    p.add_argument("--entropy-coef", type=float, default=0.01)
    p.add_argument("--max-grad-norm", type=float, default=0.5)
    p.add_argument("--device", default="auto", help="auto | cuda | mps | cpu")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--save-every", type=int, default=10)
    return p


def train(argv: Optional[list[str]] = None) -> dict:
    args = build_parser().parse_args(argv)
    scenarios = args.scenario or ["gen:30x30:5:*"]
    rng = seed_everything(args.seed)
    device = pick_device(args.device)

    model = load_model(args.init).to(device)
    rollout_model = ActorCritic()
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)

    out = checkpoint_path(args.name)
    out.parent.mkdir(parents=True, exist_ok=True)
    csv_path = out.with_suffix(".csv")
    meta = {
        "kind": "ppo",
        "base": str(args.init) if args.init else None,
        "scenarios": scenarios,
        "device": str(device),
        "hyperparameters": {k: getattr(args, k) for k in (
            "samples_per_iter", "epochs", "minibatch", "lr", "gamma", "lam", "clip",
            "value_coef", "entropy_coef", "seed")},
    }
    print(f"training {args.name!r} on {device} — scenarios {scenarios}, "
          f"{'from ' + str(args.init) if args.init else 'from scratch'}")

    env_steps = 0
    last: dict = {}
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for iteration in range(1, args.iterations + 1):
            t0 = time.perf_counter()
            rollout_model.load_state_dict({k: v.detach().cpu() for k, v in model.state_dict().items()})
            rollout_model.eval()
            batch, stats, episodes = Batch(), EpisodeStats(), 0
            while len(batch.action) < args.samples_per_iter:
                run_episode(rollout_model, scenarios[rng.randrange(len(scenarios))], rng,
                            args.gamma, args.lam, batch, stats)
                episodes += 1
            env_steps += stats.steps
            losses = ppo_update(model, optimizer, batch, device, epochs=args.epochs,
                                minibatch=args.minibatch, clip=args.clip, value_coef=args.value_coef,
                                entropy_coef=args.entropy_coef, max_grad_norm=args.max_grad_norm)
            last = {
                "iteration": iteration,
                "env_steps": env_steps,
                "episodes": episodes,
                "samples": len(batch.action),
                "arrival_rate": round(stats.arrived / max(stats.trains, 1), 4),
                "mean_return": round(float(np.mean(stats.returns)), 4),
                **{k: round(v, 5) for k, v in losses.items()},
                "seconds": round(time.perf_counter() - t0, 2),
            }
            writer.writerow(last)
            fh.flush()
            print(f"it {iteration:>4}  arrived {last['arrival_rate']:.2f}  return {last['mean_return']:+.3f}  "
                  f"pi {last['policy_loss']:+.4f}  v {last['value_loss']:.4f}  H {last['entropy']:.3f}  "
                  f"kl {last['approx_kl']:+.4f}  {last['seconds']:.1f}s")
            if iteration % args.save_every == 0 or iteration == args.iterations:
                save_checkpoint(args.name, model, {**meta, "iterations": iteration,
                                                   "env_steps": env_steps, "last": last}, optimizer)
    print(f"saved {out} (hub policy lab:{args.name}), curve in {csv_path}")
    return {"checkpoint": out, "csv": csv_path, "last": last}


def main() -> None:
    train()


if __name__ == "__main__":
    main()
