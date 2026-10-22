"""The online learner — docs/plans/online-ppo-learning.md, "Training flow".

`OnlineLearner.step()` is one step of its own background episode: observe, ask
every active policy, sample the learner's action, test candidates in forks at
relevant steps, execute the learner's action, record. Once enough on-policy
decisions are in, `update()` runs PPO (plus the distillation term), creates a
new version, evaluates it against the last stable version and the baseline,
and keeps it or rolls back. Everything is written to the audit log.

Runs in the worker process (`worker.py`); tests drive it directly.
"""
from __future__ import annotations

import copy
import json
import random
import time
import uuid
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import torch
import torch.nn.functional as F
from flatland.envs.step_utils.states import TrainState

from app.core.env_factory import create_env
from app.policies.learned import lab_checkpoints
from app.policies.learned.learned_ppo_policy import (
    DEFAULT_CHECKPOINT,
    EXPERIENCE_ENSEMBLE_SIZE,
    N_ACTIONS,
    ActorCritic,
    experience_state_key,
    load_actor_critic_checkpoint,
)
from app.policies.registry import get_policy_spec

from . import candidates as cand
from . import reward as rw
from .buffers import make_buffers
from .config import PUBLISHED_NAME, OnlineConfig
from .records import (
    CounterfactualResult,
    DistillationSample,
    ExperienceCountSample,
    PolicyPrediction,
    RolloutStep,
    UserInteraction,
    to_dict,
)

LEARNER_ID = "online-ppo"


def make_env(spec: str, rng: random.Random):
    """Preset id or gen:WxH:trains:seed; seed "*" draws a new network."""
    if spec.startswith("gen:"):
        _, size, trains, seed = spec.split(":")
        width, height = (int(v) for v in size.split("x"))
        seed_value = rng.randrange(1, 2**31) if seed == "*" else int(seed)
        return create_env(width=width, height=height, number_of_agents=int(trains), seed=seed_value)
    return create_env(scenario_preset_id=spec)


class OnlineLearner:
    def __init__(self, cfg: OnlineConfig, root: Path, run_id: Optional[str] = None, publish: bool = True):
        self.cfg = cfg
        self.root = Path(root)
        self.run_id = run_id or time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
        self.run_dir = self.root / "runs" / self.run_id
        (self.run_dir / "versions").mkdir(parents=True, exist_ok=True)
        self.audit_path = self.run_dir / "audit.jsonl"
        self.publish_enabled = publish

        torch.set_num_threads(max(1, cfg.torch_threads))
        self.rng = random.Random(cfg.seed)
        np.random.seed(cfg.seed % (2**32))
        torch.manual_seed(cfg.seed)

        self.model = self._initial_model()
        self.model.eval()
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=cfg.learning_rate)
        self.buffers = make_buffers(cfg)
        self.experience_counts = OrderedDict(self.model.experience_counts)
        self.experience_updates = int(self.model.experience_updates)
        self.pool = ThreadPoolExecutor(max_workers=max(1, len(cfg.active_policies) + 1))

        self.version = 0            # last version number handed out
        self.weights_version = 0    # the version the learner currently samples with
        self.stable_version = 0
        self.history: list[dict] = []
        self.total_steps = 0
        self.episode_id = 0
        self.episodes_done = 0
        self.policy_errors: dict[str, str] = {}
        self.last_update: Optional[dict] = None
        self.started_at = time.time()

        self._baseline_eval = self.evaluate(self._registry_factory(cfg.baseline_policy))
        self.stable_eval = self.evaluate(self._model_factory(self.model))
        self._stable_state = self._snapshot_state()
        self._save_version(0, {"eval": self.stable_eval})
        self.history.append({"version": 0, "decision": "initial", "eval": self.stable_eval,
                             "baseline": self._baseline_eval, "t": time.time()})
        self._audit({"event": "start", "run_id": self.run_id, "config": cfg.to_dict(),
                     "eval": self.stable_eval, "baseline": self._baseline_eval})
        self._publish(0)
        self._new_episode()

    # ── setup ──────────────────────────────────────────────────────────
    def _initial_model(self) -> ActorCritic:
        model = ActorCritic()
        init = self.cfg.init
        path = None
        if init == "ecml":
            path = DEFAULT_CHECKPOINT
        elif init.startswith("lab:"):
            path = lab_checkpoints.path_for_policy_id(init)
            if path is None:
                raise ValueError(f"unknown lab checkpoint {init!r}")
        elif init != "scratch":
            raise ValueError(f"init must be scratch, ecml or lab:<name>, not {init!r}")
        if path is not None:
            model = load_actor_critic_checkpoint(
                model, torch.load(path, weights_only=False, map_location="cpu")
            )
        return model

    def _snapshot_state(self) -> dict:
        return {
            "model": copy.deepcopy(self.model.state_dict()),
            "optimizer": copy.deepcopy(self.optimizer.state_dict()),
            "experience_updates": self.experience_updates,
        }

    def _registry_factory(self, policy_id: str) -> Callable:
        def make(env):
            policy = get_policy_spec(policy_id).runtime_factory(env)
            policy.reset(env)
            return policy
        return make

    @staticmethod
    def _model_factory(model) -> Callable:
        return lambda env: cand.GreedyModelPolicy(model, env)

    def _new_episode(self) -> None:
        self.episode_id += 1
        self.scenario = self.rng.choice(self.cfg.scenarios)
        self.env = make_env(self.scenario, self.rng)
        self.builder = cand.make_obs_builder(self.env)
        self.shaped = rw.ShapedReward(self.env)
        ids = list(dict.fromkeys(list(self.cfg.active_policies) + [self.cfg.fallback_policy]))
        self.policies, errors = cand.build_active_policies(ids, self.env)
        self.policy_errors.update(errors)
        self.trajectories: dict[int, list[list]] = {a.handle: [] for a in self.env.agents}
        self.episode_step = 0
        self.limit = int(getattr(self.env, "_max_episode_steps", 0) or 500)

    # ── one step of the background episode ─────────────────────────────
    def step(self) -> None:
        env = self.env
        active = [a.handle for a in env.agents if a.state != TrainState.DONE]
        if not active or env.dones.get("__all__") or self.episode_step >= self.limit:
            self._finish_episode()
            return

        feats, mask = cand.observe(self.builder, active)
        predictions = cand.query_all(self.policies, active, self.pool)

        obs_t = torch.from_numpy(feats)
        mask_t = torch.from_numpy(mask)
        with torch.no_grad():
            logits, values = self.model(obs_t)
            masked = logits.masked_fill(mask_t < 0.5, cand.MASKED)
            dist = torch.distributions.Categorical(logits=masked)
            sampled = dist.sample()
            log_probs = dist.log_prob(sampled)
            probs = torch.softmax(masked, dim=-1)

        choice = [cand.has_real_choice(feats[i], mask[i]) for i in range(len(active))]
        self._record_predictions(active, feats, choice, predictions, sampled, probs, values)

        if self.episode_step % max(1, self.cfg.cf_every) == 0:
            self._counterfactuals(active, feats, mask, choice, predictions, sampled)

        actions = {a.handle: 0 for a in env.agents}
        deciding = mask.sum(axis=1) > 1
        for i, h in enumerate(active):
            if deciding[i]:
                actions[h] = int(sampled[i])
                self._record_experience(feats[i], mask[i], actions[h], "executed")
                self.trajectories[h].append(
                    [feats[i], mask[i], int(sampled[i]), float(log_probs[i]), float(values[i]), 0.0])

        env.step(actions)
        self.episode_step += 1
        self.total_steps += 1
        for h, r in self.shaped.step(int(getattr(env, "_elapsed_steps", self.episode_step))).items():
            if self.trajectories[h]:
                self.trajectories[h][-1][5] += r

    def _record_experience(self, obs, mask, action: int, source: str) -> None:
        if not 0 <= int(action) < N_ACTIONS:
            return
        key = experience_state_key(obs, mask)
        counts = self.experience_counts.get(key)
        if counts is None:
            counts = {"executed": [0] * N_ACTIONS, "simulated": [0] * N_ACTIONS}
        self.experience_counts[key] = counts
        self.experience_counts.move_to_end(key)
        bucket = "simulated" if source == "simulated" else "executed"
        counts[bucket][int(action)] += 1
        while len(self.experience_counts) > max(1, self.cfg.experience_state_capacity):
            self.experience_counts.popitem(last=False)

        combined = [a + b for a, b in zip(counts["executed"], counts["simulated"])]
        self.buffers["experience_count_buffer"].add(ExperienceCountSample(
            np.asarray(obs, dtype=np.float32).tolist(),
            np.asarray(mask, dtype=np.float32).tolist(),
            np.log1p(combined).astype(float).tolist(),
            source,
        ))
        self.model.experience_counts = self.experience_counts

    def _record_predictions(self, active, feats, choice, predictions, sampled, probs, values) -> None:
        buf = self.buffers["multi_policy_prediction_buffer"]
        for i, h in enumerate(active):
            obs = feats[i].round(4).tolist() if choice[i] else None
            p = probs[i].tolist()
            a = int(sampled[i])
            buf.add(PolicyPrediction(LEARNER_ID, f"v{self.weights_version}", "background", self.episode_id,
                                     self.episode_step, h, obs, a, round(p[a], 4),
                                     [round(float(np.log(x)), 4) if x > 0 else None for x in p],
                                     round(float(values[i]), 4)))
            for pid, per_train in predictions.items():
                pred = per_train.get(h)
                buf.add(PolicyPrediction(pid, "static", "background", self.episode_id, self.episode_step, h, obs,
                                         pred.action if pred else None,
                                         pred.confidence if pred else None,
                                         pred.logits if pred else None,
                                         None, "background",
                                         (pred.error if pred else "missing")))

    def _counterfactuals(self, active, feats, mask, choice, predictions, sampled) -> None:
        idx = [i for i in range(len(active)) if choice[i]]
        self.rng.shuffle(idx)
        for i in idx[: self.cfg.cf_max_trains]:
            h = active[i]
            proposals = {"learner": int(sampled[i])}
            for pid, per_train in predictions.items():
                pred = per_train.get(h)
                if pred is not None and pred.action is not None:
                    proposals[pid] = pred.action
            fb = predictions.get(self.cfg.fallback_policy, {}).get(h)
            if fb is not None and fb.action is not None:
                proposals["fallback"] = fb.action
            candidates = cand.collect_candidates(mask[i], proposals)
            results = cand.evaluate_candidates(self.env, h, candidates, self._model_factory(self.model),
                                               self.cfg.cf_horizon)
            for result in results:
                self._record_experience(feats[i], mask[i], result["action"], "simulated")
            self._store_counterfactuals(results, h, "background")
            self._maybe_distill(results, int(sampled[i]), feats[i], mask[i], "counterfactual")

    def _store_counterfactuals(self, results, handle, context, step=None) -> None:
        buf = self.buffers["counterfactual_evaluation_buffer"]
        for r in results:
            buf.add(CounterfactualResult(self.episode_id, self.episode_step if step is None else step, handle,
                                         r["action"], r["sources"], self.cfg.cf_horizon, r["components"],
                                         r["score"], r["feasible"], context))

    def _maybe_distill(self, results, reference_action, feat, msk, origin, required_source=None) -> Optional[float]:
        best = cand.best_candidate(results)
        ref = next((r for r in results if r["action"] == reference_action), None)
        if best is None or ref is None or best["action"] == reference_action:
            return None
        if required_source and required_source not in best["sources"]:
            return None
        gap = best["score"] - ref["score"]
        if gap < self.cfg.cf_margin:
            return None
        self.buffers["distillation_buffer"].add(DistillationSample(
            feat.round(5).tolist(), msk.tolist(), best["action"], best["sources"], round(gap, 4), origin))
        return gap

    def _finish_episode(self) -> None:
        for h, pen in self.shaped.episode_end().items():
            if self.trajectories[h]:
                self.trajectories[h][-1][5] += pen
        rollout = self.buffers["ppo_rollout_buffer"]
        for h, traj in self.trajectories.items():
            advantage, next_value = 0.0, 0.0
            computed = []
            for obs, msk, action, logp, value, reward in reversed(traj):
                delta = reward + self.cfg.gamma * next_value - value
                advantage = delta + self.cfg.gamma * self.cfg.lam * advantage
                computed.append((obs, msk, action, logp, value, reward, advantage, advantage + value))
                next_value = value
            for k, (obs, msk, action, logp, value, reward, adv, ret) in enumerate(reversed(computed)):
                rollout.add(RolloutStep(obs.tolist(), msk.tolist(), action, logp, value, reward,
                                        done=(k == len(computed) - 1), policy_version=self.weights_version,
                                        episode_id=self.episode_id, step=k, handle=h, advantage=adv, ret=ret))
        self.episodes_done += 1
        self._new_episode()

    # ── update, evaluation, acceptance ─────────────────────────────────
    def ready_for_update(self) -> bool:
        return len(self.buffers["ppo_rollout_buffer"]) >= self.cfg.min_rollout_steps

    def update(self) -> dict:
        cfg = self.cfg
        steps = self.buffers["ppo_rollout_buffer"].items()
        obs = torch.tensor(np.array([s.obs for s in steps]), dtype=torch.float32)
        mask = torch.tensor(np.array([s.mask for s in steps]), dtype=torch.float32)
        action = torch.tensor([s.action for s in steps], dtype=torch.long)
        old_logp = torch.tensor([s.log_prob for s in steps], dtype=torch.float32)
        adv = torch.tensor([s.advantage for s in steps], dtype=torch.float32)
        ret = torch.tensor([s.ret for s in steps], dtype=torch.float32)
        if cfg.normalize_advantages and len(steps) > 1:
            adv = (adv - adv.mean()) / (adv.std() + 1e-8)
        distill = self.buffers["distillation_buffer"].items()
        experience_samples = self.buffers["experience_count_buffer"].items()
        if experience_samples:
            experience_obs = torch.tensor(np.array([s.obs for s in experience_samples]), dtype=torch.float32)
            experience_mask = torch.tensor(np.array([s.mask for s in experience_samples]), dtype=torch.float32)
            experience_targets = torch.tensor(
                np.array([s.target_log_counts for s in experience_samples]), dtype=torch.float32
            )

        sums = {
            "policy_loss": 0.0,
            "value_loss": 0.0,
            "entropy": 0.0,
            "approx_kl": 0.0,
            "distill_loss": 0.0,
            "experience_loss": 0.0,
        }
        n_updates, epochs_run, early_stopped = 0, 0, False
        self.model.train()
        for _ in range(cfg.epochs):
            epoch_kl, epoch_batches = 0.0, 0
            order = torch.randperm(len(steps))
            for start in range(0, len(steps), cfg.batch_size):
                mb = order[start:start + cfg.batch_size]
                logits, values = self.model(obs[mb])
                dist = torch.distributions.Categorical(logits=logits.masked_fill(mask[mb] < 0.5, cand.MASKED))
                logp = dist.log_prob(action[mb])
                ratio = torch.exp(logp - old_logp[mb])
                surrogate = torch.min(ratio * adv[mb], torch.clamp(ratio, 1 - cfg.clip, 1 + cfg.clip) * adv[mb])
                policy_loss = -surrogate.mean()
                value_loss = F.mse_loss(values, ret[mb])
                entropy = dist.entropy().mean()
                loss = policy_loss + cfg.value_coef * value_loss - cfg.entropy_coef * entropy

                distill_loss = torch.zeros(())
                if distill and cfg.distill_coef > 0:
                    pick = [distill[j] for j in np.random.randint(len(distill), size=min(cfg.distill_batch_size, len(distill)))]
                    d_logits, _ = self.model(torch.tensor(np.array([d.obs for d in pick]), dtype=torch.float32))
                    d_mask = torch.tensor(np.array([d.mask for d in pick]), dtype=torch.float32)
                    d_target = torch.tensor([d.target_action for d in pick], dtype=torch.long)
                    distill_loss = F.cross_entropy(d_logits.masked_fill(d_mask < 0.5, cand.MASKED), d_target)
                    loss = loss + cfg.distill_coef * distill_loss

                experience_loss = torch.zeros(())
                if experience_samples and cfg.experience_coef > 0:
                    count_batch_size = min(cfg.experience_batch_size, len(experience_samples))
                    count_indices = torch.randint(len(experience_samples), (count_batch_size,))
                    _, _, predicted_log_counts = self.model.forward_with_experience(experience_obs[count_indices])
                    count_mask = experience_mask[count_indices] > 0.5
                    if count_mask.any():
                        targets = experience_targets[count_indices]
                        head_losses = []
                        for head_index in range(EXPERIENCE_ENSEMBLE_SIZE):
                            bootstrap_weights = torch.poisson(torch.ones(count_batch_size)).unsqueeze(1)
                            weighted_mask = count_mask * bootstrap_weights
                            element_loss = F.smooth_l1_loss(
                                predicted_log_counts[:, head_index, :], targets, reduction="none"
                            )
                            head_losses.append(
                                (element_loss * weighted_mask).sum() / weighted_mask.sum().clamp_min(1.0)
                            )
                        experience_loss = torch.stack(head_losses).mean()
                        loss = loss + cfg.experience_coef * experience_loss

                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), cfg.max_grad_norm)
                self.optimizer.step()

                kl = float((old_logp[mb] - logp).mean().detach())
                epoch_kl += kl
                epoch_batches += 1
                sums["policy_loss"] += float(policy_loss.detach())
                sums["value_loss"] += float(value_loss.detach())
                sums["entropy"] += float(entropy.detach())
                sums["approx_kl"] += kl
                sums["distill_loss"] += float(distill_loss.detach())
                sums["experience_loss"] += float(experience_loss.detach())
                n_updates += 1
            epochs_run += 1
            if epoch_batches and epoch_kl / epoch_batches > cfg.target_kl:
                early_stopped = True
                break
        self.model.eval()
        if experience_samples and cfg.experience_coef > 0:
            self.experience_updates += n_updates
            self.model.experience_updates = self.experience_updates
            self.model.experience_estimator_ready = self.experience_updates > 0
        stats = {k: round(v / max(n_updates, 1), 5) for k, v in sums.items()}

        # entropy and KL of the new weights on the whole batch (collapse check)
        with torch.no_grad():
            logits, _ = self.model(obs)
            dist = torch.distributions.Categorical(logits=logits.masked_fill(mask < 0.5, cand.MASKED))
            final_entropy = float(dist.entropy().mean())
            final_kl = float((old_logp - dist.log_prob(action)).mean())
        stats.update({"final_entropy": round(final_entropy, 4), "final_kl": round(final_kl, 5),
                      "epochs_run": epochs_run, "early_stopped": early_stopped,
                      "rollout_steps": len(steps), "distill_samples": len(distill),
                      "experience_samples": len(experience_samples),
                      "experience_estimator_ready": self.model.experience_estimator_ready})
        return self._decide(stats)

    def _decide(self, stats: dict) -> dict:
        cfg = self.cfg
        self.version += 1
        candidate = self.version
        self._save_version(candidate, {"stats": stats})
        entry = {"version": candidate, "from_version": self.weights_version, "stats": stats, "t": time.time(),
                 "baseline": self._baseline_eval, "stable_before": self.stable_eval, "stable_version_before": self.stable_version}

        collapsed = stats["final_entropy"] < cfg.collapse_entropy or stats["final_kl"] > cfg.collapse_kl
        if collapsed:
            entry.update(decision="collapsed", eval=None, improved=False)
            self._rollback()
        else:
            ev = self.evaluate(self._model_factory(self.model))
            entry["eval"] = ev
            # Safety, as a hard constraint for publishing: not more deadlocks than
            # the stable version, or at least no more than the baseline. A version
            # as safe as DLA may replace a stable version that never drove.
            dl = ev["deadlocks_per_episode"]
            safe = (dl <= self.stable_eval["deadlocks_per_episode"] + cfg.safety_tolerance
                    or dl <= self._baseline_eval["deadlocks_per_episode"] + cfg.safety_tolerance)
            entry["safe"] = safe
            improved = ev["score"] > self.stable_eval["score"]
            acceptable = ev["score"] >= self.stable_eval["score"] - cfg.accept_tolerance
            entry["improved"] = improved
            entry["beats_baseline"] = ev["score"] > self._baseline_eval["score"]
            if safe and improved:
                # Better than the last stable version: the new stable version.
                entry["decision"] = "accepted"
                self.stable_version = candidate
                self.weights_version = candidate
                self.stable_eval = ev
                self._stable_state = self._snapshot_state()
                self._publish(candidate)
            elif acceptable:
                # Not better (or not safe enough to publish), not worse than the
                # tolerance allows: learning goes on from these weights, the stable
                # (published) version stays. The score already counts deadlocks;
                # measured against the stable version, so drift is bounded.
                entry["decision"] = "kept_training"
                self.weights_version = candidate
            else:
                entry["decision"] = "rolled_back"
                self._rollback()

        entry["stable_version"] = self.stable_version
        self.history.append(entry)
        self.last_update = entry
        self._audit({"event": "update", **entry})
        # Every step collected so far belongs to the old weights: start over.
        self.buffers["ppo_rollout_buffer"].reset(self.weights_version)
        self._new_episode()
        return entry

    def _rollback(self) -> None:
        self.model.load_state_dict(self._stable_state["model"])
        self.optimizer.load_state_dict(self._stable_state["optimizer"])
        self.experience_updates = self._stable_state["experience_updates"]
        self.model.experience_updates = self.experience_updates
        self.model.experience_estimator_ready = self.experience_updates > 0
        self.model.experience_counts = self.experience_counts
        self.weights_version = self.stable_version

    def evaluate(self, factory: Callable) -> dict:
        """Several independent episodes (fixed seeds), greedy, to the end."""
        episodes = []
        eval_rng = random.Random(12345)
        for spec in self.cfg.eval_scenarios:
            env = make_env(spec, eval_rng)
            policy = factory(env)
            handles = env.get_agent_handles()
            limit = int(getattr(env, "_max_episode_steps", 0) or 500)
            for _ in range(limit):
                if hasattr(policy, "start_step"):
                    policy.start_step()
                acts = policy.act_many(handles, {})
                if hasattr(policy, "end_step"):
                    policy.end_step()
                _, _, dones, _ = env.step(acts)
                if dones.get("__all__"):
                    break
            snap = rw.snapshot(env)
            trains = len(handles)
            episodes.append({"scenario": spec, "arrived": snap["arrived"], "trains": trains,
                             "lateness": snap["lateness"], "deadlocked": snap["deadlocked"],
                             "score": rw.episode_score(snap["arrived"], trains, snap["lateness"], snap["deadlocked"])})
        n = max(len(episodes), 1)
        trains = sum(e["trains"] for e in episodes) or 1
        return {
            "episodes": len(episodes),
            "score": round(sum(e["score"] for e in episodes) / n, 4),
            "arrival_rate": round(sum(e["arrived"] for e in episodes) / trains, 4),
            "lateness_per_train": round(sum(e["lateness"] for e in episodes) / trains, 2),
            "deadlocks_per_episode": round(sum(e["deadlocked"] for e in episodes) / n, 3),
            "per_episode": episodes,
        }

    # ── user interactions from the hub ─────────────────────────────────
    def ingest_override(self, record: dict, env) -> UserInteraction:
        """A human override from a hub session, with a snapshot of its env:
        fork it, score the human action against the AI's and the other
        candidates. Better only if its fork scores better."""
        h = int(record["handle"])
        human = int(record["action"])
        ai_policy = cand.GreedyModelPolicy(self.model, env)
        handles = env.get_agent_handles()
        builder = cand.make_obs_builder(env)
        reached = False
        for _ in range(30):
            feats, mask = cand.observe(builder, [h])
            if cand.has_real_choice(feats[0], mask[0]) or env.agents[h].state == TrainState.DONE:
                reached = cand.has_real_choice(feats[0], mask[0])
                break
            if env.dones.get("__all__"):
                break
            env.step(ai_policy.act_many(handles, {}))
        base = {"session_id": record.get("session_id", ""), "step": int(record.get("step", 0)), "handle": h,
                "mode": record.get("mode"), "owner": record.get("owner"), "human_action": human}
        if not reached:
            ui = UserInteraction("override", outcome="not evaluated", **base)
            self.buffers["user_interaction_buffer"].add(ui)
            return ui

        ai_action = ai_policy.act_many([h], {})[h]
        if 0 <= human < N_ACTIONS and mask[0][human] > 0.5:
            self._record_experience(feats[0], mask[0], human, "executed")
        proposals = {"user": human, "ai": ai_action}
        policies, errors = cand.build_active_policies(self.cfg.active_policies, env)
        self.policy_errors.update(errors)
        for p in policies:
            try:
                pred = p.predict([h])[h]
                if pred.action is not None:
                    proposals[p.policy_id] = pred.action
            except Exception as exc:
                self.policy_errors[p.policy_id] = f"{type(exc).__name__}: {exc}"
        candidates = cand.collect_candidates(mask[0], proposals)
        results = cand.evaluate_candidates(env, h, candidates, self._model_factory(self.model), self.cfg.cf_horizon)
        for result in results:
            self._record_experience(feats[0], mask[0], result["action"], "simulated")
        self._store_counterfactuals(results, h, "user", step=base["step"])
        by_action = {r["action"]: r for r in results}
        human_r, ai_r = by_action.get(human), by_action.get(ai_action)
        outcome = "not evaluated"
        if human_r and ai_r:
            gap = human_r["score"] - ai_r["score"]
            outcome = "better" if gap >= self.cfg.cf_margin and human_r["feasible"] else (
                "worse" if gap <= -self.cfg.cf_margin or not human_r["feasible"] else "equal")
        ui = UserInteraction("override", ai_action=ai_action,
                             human_score=human_r["score"] if human_r else None,
                             ai_score=ai_r["score"] if ai_r else None, outcome=outcome, **base)
        self.buffers["user_interaction_buffer"].add(ui)
        if human != ai_action:
            self.buffers["user_interaction_buffer"].add(UserInteraction(
                "rejected_suggestion", ai_action=ai_action, outcome=outcome, **base))
        if outcome == "better":
            self.buffers["distillation_buffer"].add(DistillationSample(
                feats[0].round(5).tolist(), mask[0].tolist(), human, ["user"],
                round(human_r["score"] - ai_r["score"], 4), "user"))
        self._audit({"event": "user_override", **to_dict(ui)})
        return ui

    def ingest_feedback(self, record: dict) -> UserInteraction:
        ui = UserInteraction("feedback", session_id=record.get("session_id", ""), step=int(record.get("step", 0)),
                             handle=int(record.get("handle", -1)), mode=record.get("mode"), owner="human",
                             feedback=str(record.get("feedback", ""))[:500], outcome="not evaluated")
        self.buffers["user_interaction_buffer"].add(ui)
        self._audit({"event": "feedback", **to_dict(ui)})
        return ui

    # ── persistence ────────────────────────────────────────────────────
    def _save_version(self, version: int, meta: dict) -> Path:
        path = self.run_dir / "versions" / f"v{version}.pt"
        checkpoint_meta = {
            "version": version,
            "run_id": self.run_id,
            "experience_updates": self.experience_updates,
            "experience_state_count": len(self.experience_counts),
            **meta,
        }
        torch.save({"model": {k: v.detach().cpu() for k, v in self.model.state_dict().items()},
                    "meta": checkpoint_meta,
                    "experience_counts": dict(self.experience_counts)}, path)
        return path

    def _publish(self, version: int) -> None:
        """The stable version as lab/checkpoints/online-ppo.pt: the hub offers
        it as `lab:online-ppo`; running sessions pick it up on their next step."""
        if not self.publish_enabled:
            return
        path = lab_checkpoints.checkpoint_path(PUBLISHED_NAME)
        path.parent.mkdir(parents=True, exist_ok=True)
        meta = {"kind": "online", "label": f"Online PPO (v{version})", "version": version, "run_id": self.run_id,
                "init": self.cfg.init, "eval": {k: v for k, v in self.stable_eval.items() if k != "per_episode"},
            "experience_updates": self.experience_updates,
            "experience_state_count": len(self.experience_counts),
                "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
        tmp = path.with_suffix(".pt.tmp")
        torch.save({"model": {k: v.detach().cpu() for k, v in self.model.state_dict().items()},
                "meta": meta, "experience_counts": dict(self.experience_counts)}, tmp)
        tmp.replace(path)
        lab_checkpoints.write_meta(path, meta)

    def _audit(self, entry: dict) -> None:
        with self.audit_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps({"t": time.time(), **entry}, default=str) + "\n")

    def status(self) -> dict:
        def brief(e):
            if e is None:
                return None
            ev = e.get("eval") or {}
            return {"version": e["version"], "decision": e["decision"], "improved": e.get("improved"),
                    "beats_baseline": e.get("beats_baseline"), "t": e.get("t"),
                    "score": ev.get("score"), "arrival_rate": ev.get("arrival_rate"),
                    "lateness_per_train": ev.get("lateness_per_train"),
                    "deadlocks_per_episode": ev.get("deadlocks_per_episode"),
                    "stable_score_before": (e.get("stable_before") or {}).get("score"),
                    "stats": e.get("stats")}
        policy_sources = {policy_id: 0 for policy_id in dict.fromkeys([LEARNER_ID, *self.cfg.active_policies])}
        for prediction in self.buffers["multi_policy_prediction_buffer"]:
            if prediction.action is not None:
                policy_sources[prediction.policy_id] = policy_sources.get(prediction.policy_id, 0) + 1
        distillation_sources: dict[str, int] = {}
        for sample in self.buffers["distillation_buffer"]:
            for source in set(sample.sources):
                distillation_sources[source] = distillation_sources.get(source, 0) + 1
        experience_sources: dict[str, int] = {}
        for sample in self.buffers["experience_count_buffer"]:
            experience_sources[sample.source] = experience_sources.get(sample.source, 0) + 1
        return {
            "run_id": self.run_id,
            "init": self.cfg.init,
            "version": self.version,
            "weights_version": self.weights_version,
            "stable_version": self.stable_version,
            "published_policy": lab_checkpoints.LAB_POLICY_PREFIX + PUBLISHED_NAME,
            "total_steps": self.total_steps,
            "episodes": self.episodes_done,
            "scenario": self.scenario,
            "rollout_progress": [len(self.buffers["ppo_rollout_buffer"]), self.cfg.min_rollout_steps],
            "buffers": {name: len(buf) for name, buf in self.buffers.items()},
            "data_sources": {
                "policy_predictions": policy_sources,
                "distillation_targets": distillation_sources,
                "experience_samples": experience_sources,
            },
            "stable_eval": {k: v for k, v in self.stable_eval.items() if k != "per_episode"},
            "baseline_eval": {k: v for k, v in self._baseline_eval.items() if k != "per_episode"},
            "baseline_policy": self.cfg.baseline_policy,
            "history": [brief(e) for e in self.history[-30:]],
            "policy_errors": self.policy_errors,
            "uptime_s": round(time.time() - self.started_at, 1),
        }

    def close(self) -> None:
        self.pool.shutdown(wait=False, cancel_futures=True)
