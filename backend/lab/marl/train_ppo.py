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

Generic scenarios retain the legacy shaped reward. --cases enables the PF-CH
mission contract, live incident timing and one transition per physical step.
--bc-dataset/--bc-coef protect a PP-imitation actor during PPO; --critic-warmup
updates only the value head initially. --resume restores a matching recipe.
CPU rollout workers share one frozen policy per iteration; updates can use MPS.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import multiprocessing
import random
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.step_utils.states import TrainState

from app.policies.learned.lab_checkpoints import checkpoint_path
from app.policies.learned.learned_ppo_policy import checkpoint_hidden_size
from app.utils.agent_compat import (
    agent_direction,
    agent_initial_direction,
    agent_initial_position,
    agent_position,
)
from lab.marl.common import (
    ActorCritic,
    load_model,
    make_env,
    make_obs_builder,
    masked_logits,
    observation_size,
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
    missions: int = 0
    served_calls: int = 0
    required_calls: int = 0


def _distance(env, dist_map, handle: int) -> float | None:
    agent = env.agents[handle]
    if agent.state == TrainState.DONE:
        return 0.0
    on_map = agent_position(agent) is not None
    position = agent_position(agent) if on_map else agent_initial_position(agent)
    direction = agent_direction(agent) if on_map else agent_initial_direction(agent)
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

        env.step({h: RailEnvActions.from_value(action) for h, action in actions.items()})

        for h in active:
            agent = env.agents[h]
            reward = 0.0
            if agent.state == TrainState.DONE:
                arrived[h] = True
                latest = getattr(agent, "latest_arrival", None)
                late = max(0, step - int(latest)) if latest is not None else 0
                reward += ARRIVAL_BONUS - min(LATE_PENALTY_CAP, LATE_PENALTY_PER_STEP * late)
            new_distance = _distance(env, dist_map, h)
            previous_distance = distance[h]
            if previous_distance is not None and new_distance is not None:
                reward += PROGRESS_PER_CELL * max(-1.0, min(1.0, previous_distance - new_distance))
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


def discounted_advantages(rewards, values, terminals, gamma: float, lam: float):
    """GAE at physical-step resolution, with bounded mission horizons terminal."""
    advantages = [0.0] * len(rewards)
    advantage, next_value = 0.0, 0.0
    for i in range(len(rewards) - 1, -1, -1):
        continuation = 0.0 if terminals[i] else 1.0
        delta = rewards[i] + gamma * next_value * continuation - values[i]
        advantage = delta + gamma * lam * continuation * advantage
        advantages[i] = advantage
        next_value = values[i]
    return advantages, [a + v for a, v in zip(advantages, values, strict=True)]


def discounted_team_credit(outcome: float, gamma: float, inactive_steps: int) -> float:
    """Fold a delayed joint outcome into the last active physical transition."""
    if inactive_steps < 0:
        raise ValueError('team outcome precedes the last transition')
    return float(outcome * gamma ** inactive_steps)


@dataclass
class PFChTransition:
    """One physical-step transition for an unfinished train."""

    obs: np.ndarray
    mask: np.ndarray
    action: int
    logp: float
    value: float
    reward: float
    terminal: bool
    step: int


def run_pf_ch_episode(model, case, gamma: float, lam: float, team_credit: float = 0.0,
                      *, lateness_cost: float = 0.0) -> tuple[Batch, EpisodeStats]:
    """Collect an entire native PF-CH mission with one frozen CPU policy."""
    from lab.marl.pf_ch_episode import PFChEpisode

    episode = PFChEpisode(case, observation_schema=model.observation_schema,
                          **({'lateness_cost': lateness_cost} if lateness_cost else {}))
    trajectories: dict[int, list[PFChTransition]] = {h: [] for h in episode.handles}
    returns = {h: 0.0 for h in episode.handles}
    try:
        while not episode.done:
            active = [h for h in episode.handles if episode.env.agents[h].state != TrainState.DONE]
            if not active:
                break
            features, masks = episode.observe(active)
            with torch.no_grad():
                logits, values = model(torch.from_numpy(features))
                dist = torch.distributions.Categorical(logits=masked_logits(logits, torch.from_numpy(masks)))
                actions = dist.sample()
                logps = dist.log_prob(actions)
            _, rewards, dones, _ = episode.step({h: int(a) for h, a in zip(active, actions, strict=True)})
            for i, h in enumerate(active):
                reward = float(rewards.get(h, 0.0))
                trajectories[h].append(PFChTransition(features[i], masks[i], int(actions[i]), float(logps[i]),
                                                       float(values[i]), reward, bool(dones.get(h) or episode.done), episode.now))
                returns[h] += reward
        for h, penalty in episode.episode_end_rewards().items():
            if trajectories[h]:
                trajectories[h][-1].reward += penalty
                trajectories[h][-1].terminal = True
            returns[h] += penalty
        metrics = episode.metrics()
        outcome = 1.0 if metrics['complete_mission'] else metrics['completed_missions'] / len(episode.handles) - 1.0
        for h, trajectory in trajectories.items():
            if trajectory and team_credit:
                credit = discounted_team_credit(team_credit * outcome, gamma, episode.now - trajectory[-1].step)
                trajectory[-1].reward += credit
                returns[h] += credit
        batch = Batch()
        for trajectory in trajectories.values():
            if not trajectory:
                continue
            trajectory[-1].terminal = True
            advantages, targets = discounted_advantages(
                [row.reward for row in trajectory], [row.value for row in trajectory],
                [row.terminal for row in trajectory], gamma, lam,
            )
            for row, advantage, target in zip(trajectory, advantages, targets, strict=True):
                batch.obs.append(row.obs)
                batch.mask.append(row.mask)
                batch.action.append(row.action)
                batch.logp.append(row.logp)
                batch.value.append(row.value)
                batch.advantage.append(advantage)
                batch.ret.append(target)
        stats = EpisodeStats(trains=len(episode.handles), arrived=metrics['arrived'],
                             returns=list(returns.values()), steps=int(episode.env._elapsed_steps),
                             missions=int(metrics['complete_mission']), served_calls=metrics['served_calls'],
                             required_calls=metrics['required_calls'])
        return batch, stats
    finally:
        episode.close()


def _collect_pf_ch(task):
    state, case, seed, gamma, lam, schema, team_credit, *cost = task
    torch.set_num_threads(1)
    seed_everything(seed)
    model = ActorCritic(obs_size=state['trunk.0.weight'].shape[1],
                        hidden_size=checkpoint_hidden_size({'model': state}))
    model.observation_schema = schema
    model.load_state_dict(state)
    model.eval()
    return run_pf_ch_episode(model, case, gamma, lam, team_credit,
                             **({'lateness_cost': cost[0]} if cost and cost[0] else {}))


def _extend_batch(batch: Batch, stats: EpisodeStats, result) -> None:
    episode_batch, episode_stats = result
    for key in Batch.__dataclass_fields__:
        getattr(batch, key).extend(getattr(episode_batch, key))
    stats.returns.extend(episode_stats.returns)
    for key in ('trains', 'arrived', 'steps', 'missions', 'served_calls', 'required_calls'):
        setattr(stats, key, getattr(stats, key) + getattr(episode_stats, key))


def ppo_update(model: ActorCritic, optimizer, batch: Batch, device, *, epochs: int,
               minibatch: int, clip: float, value_coef: float, entropy_coef: float,
               max_grad_norm: float, bc_batch=None, bc_coef: float = 0.0,
               critic_only: bool = False, target_kl: float = 0.05,
               bc_focal_gamma: float = 0.0) -> dict:
    obs = torch.from_numpy(np.stack(batch.obs)).to(device)
    mask = torch.from_numpy(np.stack(batch.mask)).to(device)
    action = torch.tensor(batch.action, dtype=torch.long, device=device)
    old_logp = torch.tensor(batch.logp, dtype=torch.float32, device=device)
    adv = torch.tensor(batch.advantage, dtype=torch.float32, device=device)
    ret = torch.tensor(batch.ret, dtype=torch.float32, device=device)
    adv = (adv - adv.mean()) / (adv.std(correction=0) + 1e-8)

    n = obs.shape[0]
    sums = {"policy_loss": 0.0, "value_loss": 0.0, "entropy": 0.0, "approx_kl": 0.0, "clip_frac": 0.0, "bc_loss": 0.0}
    updates = 0
    model.train()
    for _ in range(epochs):
        order = torch.randperm(n, device=device)
        for start in range(0, n, minibatch):
            mb = order[start:start + minibatch]
            logits, values = model(obs[mb])
            if critic_only:
                values = model.value_head(model.trunk(obs[mb]).detach()).squeeze(-1)
            dist = torch.distributions.Categorical(logits=masked_logits(logits, mask[mb]))
            logp = dist.log_prob(action[mb])
            ratio = torch.exp(logp - old_logp[mb])
            surrogate = torch.min(ratio * adv[mb], torch.clamp(ratio, 1 - clip, 1 + clip) * adv[mb])
            policy_loss = -surrogate.mean()
            value_loss = F.mse_loss(values, ret[mb])
            entropy = dist.entropy().mean()
            bc_loss = torch.zeros((), device=device)
            if bc_batch is not None and bc_coef and not critic_only:
                from lab.marl.train_bc import imitation_loss
                b_obs, b_mask, b_action, b_weight = bc_batch
                ids = torch.randint(len(b_action), (min(minibatch, len(b_action)),), device=device)
                bc_loss = imitation_loss(model, b_obs[ids], b_mask[ids], b_action[ids], b_weight[ids], bc_focal_gamma)
            loss = (value_coef * value_loss if critic_only else
                    policy_loss + value_coef * value_loss - entropy_coef * entropy + bc_coef * bc_loss)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)
            optimizer.step()

            with torch.no_grad():
                sums["bc_loss"] += float(bc_loss.detach())
                sums["policy_loss"] += float(policy_loss)
                sums["value_loss"] += float(value_loss)
                sums["entropy"] += float(entropy)
                sums["approx_kl"] += float(((ratio - 1) - (logp - old_logp[mb])).mean())
                sums["clip_frac"] += float(((ratio - 1).abs() > clip).float().mean())
            updates += 1
        if not critic_only and target_kl and sums['approx_kl'] / max(updates, 1) > target_kl:
            break
    model.eval()
    return {k: v / max(updates, 1) for k, v in sums.items()}


CSV_FIELDS = ["iteration", "env_steps", "episodes", "samples", "arrival_rate", "mean_return",
              "policy_loss", "value_loss", "entropy", "approx_kl", "clip_frac", "bc_loss", "mission_rate", "call_rate", "seconds"]


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
    p.add_argument("--cases", type=Path, help="PF-CH training manifest; enables native mission reward/incident parity")
    p.add_argument("--workers", type=int, default=1, help="isolated PF-CH rollout processes, 1..8")
    p.add_argument("--threads", type=int, default=1)
    p.add_argument("--bc-dataset", type=Path, action="append", default=[])
    p.add_argument("--bc-coef", type=float, default=0.0)
    p.add_argument("--bc-decision-weight", type=float, default=1.0,
                   help="BC multiplier for ready-to-depart and at-call teacher states")
    p.add_argument("--bc-focal-gamma", type=float, default=0.0,
                   help="focal exponent for the BC anchoring objective")
    p.add_argument("--critic-warmup", type=int, default=0, help="initial updates change only the value head")
    p.add_argument("--target-kl", type=float, default=0.05)
    p.add_argument("--observation-schema", default="ecml36-service-v1",
                   choices=("ecml36-service-v1", "pf-ch-context-v1", "pf-ch-relative-v1", "uc2-context-v1"))
    p.add_argument("--team-credit", type=float, default=0.0, help="joint terminal outcome scale; PF-CH only")
    p.add_argument("--lateness-cost", type=float, default=0.0,
                   help="cost per accrued late train-step; native case episodes only")
    p.add_argument("--snapshot-dir", type=Path, help="archive periodic models outside the policy picker")
    p.add_argument("--resume", type=Path, help="restore model, optimiser, counters and RNG from same recipe")
    return p


def train(argv: list[str] | None = None) -> dict:
    args = build_parser().parse_args(argv)
    if not 1 <= args.workers <= 8 or args.iterations < 1 or args.samples_per_iter < 1 or args.threads < 1 or min(args.epochs, args.minibatch, args.save_every) < 1:
        raise ValueError("positive iterations/samples/threads/epochs/minibatch/save-every and 1..8 workers required")
    if (args.lr <= 0 or args.max_grad_norm <= 0 or args.bc_coef < 0 or args.critic_warmup < 0
            or args.team_credit < 0 or args.lateness_cost < 0):
        raise ValueError("positive learning rate/gradient norm and nonnegative BC/warmup required")
    if args.bc_decision_weight < 1 or args.bc_focal_gamma < 0:
        raise ValueError("BC decision weight must be >= 1 and focal gamma nonnegative")
    if not 0 <= args.gamma <= 1 or not 0 <= args.lam <= 1:
        raise ValueError("gamma and lambda must be between zero and one")
    finite = ('lr', 'gamma', 'lam', 'clip', 'value_coef', 'entropy_coef',
              'max_grad_norm', 'bc_coef', 'bc_decision_weight', 'bc_focal_gamma', 'team_credit', 'target_kl', 'lateness_cost')
    if any(not math.isfinite(getattr(args, key)) for key in finite):
        raise ValueError('training coefficients must be finite')
    if args.init and args.resume:
        raise ValueError("use --from for a new recipe or --resume for the same recipe")
    if args.workers != 1 and not args.cases:
        raise ValueError("parallel rollouts require an explicit PF-CH manifest")
    torch.set_num_threads(args.threads)
    scenarios = args.scenario or ["gen:30x30:5:*"]
    cases = None
    case_digest = None
    if args.cases:
        from lab.marl.pf_ch_episode import load_cases
        manifest = json.loads(args.cases.read_text())
        if isinstance(manifest, dict) and manifest.get('split', 'train') != 'train':
            raise ValueError("PPO accepts only training cases")
        cases = load_cases(args.cases)
        if not cases:
            raise ValueError("training manifest has no cases")
        scenarios = sorted({case.preset for case in cases})
        case_digest = hashlib.sha256(args.cases.read_bytes()).hexdigest()
    if not cases and args.team_credit:
        raise ValueError('team credit requires --cases')
    if not cases and args.lateness_cost:
        raise ValueError('lateness cost requires --cases')
    if not cases and args.observation_schema in ('pf-ch-context-v1', 'pf-ch-relative-v1', 'uc2-context-v1'):
        raise ValueError('PF-CH context requires --cases')
    rng = seed_everything(args.seed)
    device = pick_device(args.device)
    model = load_model(args.resume or args.init, obs_size=observation_size(args.observation_schema),
                       observation_schema=args.observation_schema).to(device)
    rollout_model = ActorCritic(obs_size=observation_size(args.observation_schema),
                                hidden_size=model.trunk[0].out_features)
    rollout_model.observation_schema = args.observation_schema
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    bc_batch = None
    if args.bc_dataset:
        from lab.marl.train_bc import decision_sample_weights, demonstration_tensors, load_demonstrations
        records = load_demonstrations(args.bc_dataset)
        if records[0]['observation_schema'] != args.observation_schema:
            raise ValueError('BC dataset observation semantics differ from PPO')
        anchor = list(demonstration_tensors(records))
        anchor[3] = decision_sample_weights(anchor[0], anchor[3], args.bc_decision_weight)
        bc_batch = tuple(t.to(device) for t in anchor)
        if bc_batch[0].shape[1] != model.trunk[0].in_features:
            raise ValueError('BC dataset schema does not match PPO input')
        # The validated device batch owns the anchor; do not retain the larger
        # Python rows or redundant CPU tensors throughout online optimisation.
        del records, anchor
    elif args.bc_coef:
        raise ValueError("--bc-coef requires --bc-dataset")
    meta = {
        "kind": "ppo", "base": str(args.init) if args.init else None,
        "scenarios": scenarios, "device": str(device), "observation_schema": args.observation_schema,
        "hidden_size": model.trunk[0].out_features, "num_hidden_layers": 3,
        "reward_schema": "pf-ch-mission-team-v2" if args.team_credit else "pf-ch-mission-v1" if cases else "legacy-shaped-v1",
        "case_manifest": str(args.cases) if args.cases else None, "case_sha256": case_digest,
        "hyperparameters": {k: getattr(args, k) for k in (
            "samples_per_iter", "epochs", "minibatch", "lr", "gamma", "lam", "clip",
            "value_coef", "entropy_coef", "seed", "workers", "bc_coef", "bc_decision_weight", "bc_focal_gamma", "critic_warmup", "target_kl", "max_grad_norm", "team_credit")},
    }
    meta['bc_dataset'] = [{"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                          for path in args.bc_dataset]
    if args.lateness_cost:
        meta['hyperparameters']['lateness_cost'] = args.lateness_cost
        meta['reward_schema'] += '+lateness-v1'
    if args.init:
        meta['base_sha256'] = hashlib.sha256(args.init.read_bytes()).hexdigest()
    source_root = Path(__file__).resolve().parents[2]
    meta['source_sha256'] = {str(path.relative_to(source_root)): hashlib.sha256(path.read_bytes()).hexdigest()
                              for path in (Path(__file__), source_root / 'lab/marl/train_bc.py',
                                           source_root / 'lab/marl/pf_ch_episode.py',
                                           source_root / 'lab/marl/common.py',
                                           source_root / 'app/policies/learned/ecml_observation.py',
                                           source_root / 'app/policies/learned/pf_ch_observation.py',
                                           source_root / 'app/policies/learned/pf_ch_relative_observation.py',
                                           source_root / 'app/policies/learned/uc2_observation.py',
                                           source_root / 'app/policies/learned/learned_ppo_policy.py',
                                           source_root / 'app/core/env_step.py',
                                           source_root / 'app/core/stops.py',
                                           source_root / 'app/core/disturbances.py')}
    out = checkpoint_path(args.name)
    out.parent.mkdir(parents=True, exist_ok=True)
    csv_path = out.with_suffix(".csv")
    env_steps, start_iteration, last = 0, 0, {}
    if args.resume:
        checkpoint = torch.load(args.resume, map_location=device, weights_only=False)
        previous = checkpoint['meta']
        if previous.get('case_sha256') != case_digest or previous.get('hyperparameters') != meta['hyperparameters'] or previous.get('bc_dataset') != meta['bc_dataset']:
            raise ValueError("resume manifest or hyperparameters differ; use --from to change recipe")
        if previous.get('scenarios') != scenarios or previous.get('source_sha256') != meta['source_sha256']:
            raise ValueError('resume scenarios or source differ; use --from for a new recipe')
        if previous.get('device') != str(device):
            raise ValueError('resume device differs; use --from for a new recipe')
        if previous.get('observation_schema') != meta['observation_schema']:
            raise ValueError("resume observation schema differs")
        optimizer.load_state_dict(checkpoint['optimizer'])
        resume_state = checkpoint['training_state']
        rng.setstate(resume_state['python_rng'])
        random.setstate(resume_state['global_python_rng'])
        np.random.set_state(resume_state['numpy_rng'])
        torch.set_rng_state(resume_state['torch_rng'].cpu())
        if device.type == 'mps' and 'mps_rng' in resume_state:
            torch.mps.set_rng_state(resume_state['mps_rng'].cpu())
        if device.type == 'cuda' and 'cuda_rng' in resume_state:
            torch.cuda.set_rng_state_all(resume_state['cuda_rng'])
        env_steps, start_iteration = previous['env_steps'], previous['iterations']
        if args.iterations <= start_iteration:
            raise ValueError("--iterations must exceed the resumed iteration")
        meta['base'] = previous.get('base')
        meta['base_sha256'] = previous.get('base_sha256')
    print(f"training {args.name!r} on {device}, {args.workers} rollout worker(s), {scenarios}", flush=True)
    executor = ProcessPoolExecutor(max_workers=args.workers, mp_context=multiprocessing.get_context('spawn')) if args.workers > 1 else None
    try:
        append = bool(args.resume and out.resolve() == args.resume.resolve() and csv_path.exists())
        if append:
            with csv_path.open(newline='', encoding='utf-8') as existing:
                reader = csv.DictReader(existing)
                if reader.fieldnames != CSV_FIELDS:
                    raise ValueError('resume CSV header differs')
                rows = [row for row in reader if int(row['iteration']) <= start_iteration]
            temporary = csv_path.with_suffix('.csv.tmp')
            with temporary.open('w', newline='', encoding='utf-8') as trimmed:
                curve = csv.DictWriter(trimmed, fieldnames=CSV_FIELDS)
                curve.writeheader()
                curve.writerows(rows)
            temporary.replace(csv_path)
        with csv_path.open('a' if append else 'w', newline='', encoding='utf-8') as fh:
            writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
            if not append:
                writer.writeheader()
            for iteration in range(start_iteration + 1, args.iterations + 1):
                t0 = time.perf_counter()
                frozen = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
                rollout_model.load_state_dict(frozen)
                rollout_model.eval()
                batch, stats, episodes = Batch(), EpisodeStats(), 0
                while len(batch.action) < args.samples_per_iter:
                    if cases:
                        tasks = [(frozen, rng.choice(cases), rng.randrange(2**31), args.gamma, args.lam, args.observation_schema, args.team_credit)
                                 for _ in range(args.workers)]
                        if args.lateness_cost:
                            tasks = [(*task, args.lateness_cost) for task in tasks]
                        results = executor.map(_collect_pf_ch, tasks) if executor else map(_collect_pf_ch, tasks)
                        for result in results:
                            _extend_batch(batch, stats, result)
                            episodes += 1
                    else:
                        run_episode(rollout_model, rng.choice(scenarios), rng, args.gamma, args.lam, batch, stats)
                        episodes += 1
                    if episodes > 100 and not batch.action:
                        raise ValueError('no policy decisions in training cases')
                env_steps += stats.steps
                losses = ppo_update(model, optimizer, batch, device, epochs=args.epochs,
                                    minibatch=args.minibatch, clip=args.clip, value_coef=args.value_coef,
                                    entropy_coef=args.entropy_coef, max_grad_norm=args.max_grad_norm,
                                    bc_batch=bc_batch, bc_coef=args.bc_coef, bc_focal_gamma=args.bc_focal_gamma,
                                    critic_only=iteration <= args.critic_warmup, target_kl=args.target_kl)
                last = {
                    'iteration': iteration, 'env_steps': env_steps, 'episodes': episodes, 'samples': len(batch.action),
                    'arrival_rate': round(stats.arrived / max(stats.trains, 1), 4),
                    'mission_rate': round(stats.missions / episodes, 4) if cases else '',
                    'call_rate': round(stats.served_calls / max(stats.required_calls, 1), 4) if cases else '',
                    'mean_return': round(float(np.mean(stats.returns)), 4),
                    **{k: round(v, 5) for k, v in losses.items()}, 'seconds': round(time.perf_counter() - t0, 2),
                }
                writer.writerow(last)
                fh.flush()
                print(f"it {iteration:>4} arrived {last['arrival_rate']:.2f} mission {last['mission_rate']} "
                      f"return {last['mean_return']:+.3f} {last['seconds']:.1f}s", flush=True)
                if iteration % args.save_every == 0 or iteration == args.iterations:
                    state: dict[str, object] = {'python_rng': rng.getstate(), 'global_python_rng': random.getstate(),
                             'numpy_rng': np.random.get_state(), 'torch_rng': torch.get_rng_state()}
                    if device.type == 'mps':
                        state['mps_rng'] = torch.mps.get_rng_state()
                    if device.type == 'cuda':
                        state['cuda_rng'] = torch.cuda.get_rng_state_all()
                    save_checkpoint(args.name, model, {**meta, 'iterations': iteration,
                                    'env_steps': env_steps, 'last': last}, optimizer, training_state=state)
                    if args.snapshot_dir:
                        args.snapshot_dir.mkdir(parents=True, exist_ok=True)
                        snapshot = args.snapshot_dir / f'{args.name}-iteration-{iteration:05d}.pt'
                        temporary = snapshot.with_suffix('.pt.tmp')
                        # Runtime inference deliberately uses weights_only=True.
                        # Keep optimiser and NumPy RNG state in the resumable
                        # final checkpoint, not in development inference exports.
                        snapshot_meta = json.loads(out.with_suffix('.json').read_text())
                        torch.save({'model': {key: value.detach().cpu().clone()
                                              for key, value in model.state_dict().items()},
                                    'meta': snapshot_meta}, temporary)
                        temporary.replace(snapshot)
                        sidecar = snapshot.with_suffix('.json')
                        temporary_meta = sidecar.with_suffix('.json.tmp')
                        temporary_meta.write_text(json.dumps(snapshot_meta, indent=2) + '\n')
                        temporary_meta.replace(sidecar)
    finally:
        if executor:
            executor.shutdown(wait=True, cancel_futures=True)
    print(f"saved {out} (hub policy lab:{args.name})", flush=True)
    return {'checkpoint': out, 'csv': csv_path, 'last': last}


def main() -> None:
    train()


if __name__ == "__main__":
    main()
