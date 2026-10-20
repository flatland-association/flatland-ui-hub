"""Asking the active policies, collecting candidate actions, and testing them
in forks — docs/plans/online-ppo-learning.md, steps 2, 4 and 5."""
from __future__ import annotations

import copy
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable, Iterable, Optional

import numpy as np

from app.policies.learned.ecml_observation import FastTreeObsBuilder
from app.policies.registry import get_policy_spec

from . import reward as rw

OBS_SIZE = FastTreeObsBuilder.OBSERVATION_DIM
N_ACTIONS = FastTreeObsBuilder.ACTION_MASK_SIZE
MASKED = -1e9


def make_obs_builder(env) -> FastTreeObsBuilder:
    builder = FastTreeObsBuilder(max_depth=3, with_action_mask=True)
    builder.set_env(env)
    builder.reset()
    return builder


def observe(builder, handles) -> tuple[np.ndarray, np.ndarray]:
    obs = np.stack([np.asarray(builder.get(h), dtype=np.float32) for h in handles])
    return obs[:, :OBS_SIZE], obs[:, OBS_SIZE:OBS_SIZE + N_ACTIONS]


def as_int(action) -> int:
    return int(getattr(action, "value", action))


# ── the other active policies ──────────────────────────────────────────

@dataclass
class Prediction:
    action: Optional[int]
    confidence: Optional[float] = None
    logits: Optional[list[float]] = None
    error: Optional[str] = None


class ActivePolicy:
    """One registry policy bound to one env, asked for its actions each step."""

    def __init__(self, policy_id: str, env):
        spec = get_policy_spec(policy_id)
        if spec is None:
            raise KeyError(policy_id)
        self.policy_id = policy_id
        self.policy = spec.runtime_factory(env)
        self.policy.reset(env)

    @property
    def version(self) -> str:
        checkpoint = getattr(self.policy, "checkpoint", None)
        return getattr(checkpoint, "stem", None) or "static"

    def predict(self, handles: list[int]) -> dict[int, Prediction]:
        self.policy.start_step()
        actions = self.policy.act_many(handles, {})
        self.policy.end_step()
        probs = getattr(self.policy, "last_action_probs", {}) or {}
        out = {}
        for h in handles:
            if h not in actions:
                out[h] = Prediction(None, error="missing")
                continue
            a = as_int(actions[h])
            p = probs.get(h)
            out[h] = Prediction(
                action=a,
                confidence=round(float(p[a]), 4) if p and a < len(p) else None,
                logits=[round(math.log(x), 4) if x > 0 else None for x in p] if p else None,
            )
        return out


def build_active_policies(policy_ids: Iterable[str], env) -> tuple[list[ActivePolicy], dict[str, str]]:
    """The policies that could be built, and the errors of those that could not."""
    built, errors = [], {}
    for pid in policy_ids:
        try:
            built.append(ActivePolicy(pid, env))
        except Exception as exc:  # a broken policy must not stop the learner
            errors[pid] = f"{type(exc).__name__}: {exc}"
    return built, errors


def query_all(policies: list[ActivePolicy], handles: list[int], pool: ThreadPoolExecutor) -> dict[str, dict[int, Prediction]]:
    """Ask every active policy at once. A policy that raises gives an error
    prediction for every train instead of failing the step."""
    futures = {p.policy_id: pool.submit(p.predict, handles) for p in policies}
    results = {}
    for pid, fut in futures.items():
        try:
            results[pid] = fut.result(timeout=30)
        except Exception as exc:
            results[pid] = {h: Prediction(None, error=f"{type(exc).__name__}: {exc}") for h in handles}
    return results


# ── the learner's own greedy policy, for forks and evaluation ───────────

class GreedyModelPolicy:
    """The learner's network as a greedy policy on one env (its own builder)."""

    def __init__(self, model, env):
        self.model = model
        self.builder = make_obs_builder(env)

    def start_step(self):
        pass

    def end_step(self):
        pass

    def reset(self, env):
        self.builder = make_obs_builder(env)

    def act_many(self, handles, observations=None):
        import torch

        handles = list(handles)
        if not handles:
            return {}
        feats, mask = observe(self.builder, handles)
        with torch.no_grad():
            logits, _ = self.model(torch.from_numpy(feats))
            logits = logits.masked_fill(torch.from_numpy(mask) < 0.5, MASKED)
            actions = logits.argmax(dim=-1)
        return {h: int(actions[i]) for i, h in enumerate(handles)}


# ── candidates and forks ───────────────────────────────────────────────

def has_real_choice(features: np.ndarray, mask: np.ndarray) -> bool:
    """A routing choice (two of left/forward/right) or the stop-or-go cell
    right before a switch."""
    routes = int(mask[1] > 0.5) + int(mask[2] > 0.5) + int(mask[3] > 0.5)
    return routes >= 2 or (features[8] > 0.5 and mask[2] > 0.5 and mask[4] > 0.5)


def collect_candidates(mask: np.ndarray, proposals: dict[str, Optional[int]]) -> dict[int, list[str]]:
    """Every valid action, with who proposed it. Valid actions nobody proposed
    are candidates too ("unproposed"), so the learner can find a move no
    policy suggested. Proposals of invalid actions are dropped."""
    candidates: dict[int, list[str]] = {}
    for source, action in proposals.items():
        if action is None or action < 0 or action >= N_ACTIONS or mask[action] < 0.5:
            continue
        candidates.setdefault(int(action), []).append(source)
    for a in range(N_ACTIONS):
        if mask[a] > 0.5 and a not in candidates:
            candidates[a] = ["unproposed"]
    return candidates


def evaluate_candidates(env, handle: int, candidates: dict[int, list[str]],
                        continuation: Callable[[object], object], horizon: int,
                        manual_sources: Iterable[str] = ("user",)) -> list[dict]:
    """Run every candidate in its own fork: the candidate action for `handle`
    now, then the continuation policy for everyone, for `horizon` steps."""
    manual_sources = set(manual_sources)
    before = rw.snapshot(env)
    results = []
    for action, sources in candidates.items():
        fork = copy.deepcopy(env)
        policy = continuation(fork)
        handles = fork.get_agent_handles()
        waiting = 0
        flatland_reward = 0.0
        for t in range(horizon):
            if fork.dones.get("__all__"):
                break
            acts = policy.act_many(handles, {})
            if t == 0:
                acts[handle] = action
            _, rewards, dones, _ = fork.step(acts)
            flatland_reward += float(sum(v for v in rewards.values() if isinstance(v, (int, float))))
            waiting += rw.waiting_count(fork)
        components, score, feasible = rw.fork_score(
            before, rw.snapshot(fork), waiting, flatland_reward, manual=bool(manual_sources & set(sources)))
        results.append({"action": int(action), "sources": list(sources), "components": components,
                        "score": score, "feasible": feasible})
    return results


def best_candidate(results: list[dict]) -> Optional[dict]:
    """The feasible candidate with the highest simulated score — never the one
    a policy was most confident about."""
    feasible = [r for r in results if r["feasible"]]
    return max(feasible, key=lambda r: r["score"]) if feasible else None
