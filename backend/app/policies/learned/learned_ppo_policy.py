"""A learned multi-agent policy: the ECML 2026 PPO actor-critic.

docs/plans/marl-lab-plan.md, step 1. One network shared by all trains
(parameter sharing), fed the starter kit's 36-feature FastTreeObs plus a
5-action mask. The network and its loading are vendored from
flatland-association/ecml2026-starterkit (MIT, LICENSE.ecml2026-starterkit);
the wrapper around it is ours.

The policy builds its own observations. Sessions step the env with whatever
observation builder the env was created with, so — like DeadLockAvoidancePolicy
reading the env directly — this policy keeps its own FastTreeObsBuilder bound
to the env in `reset()` and ignores the `observations` it is handed.

Greedy (argmax over the masked logits), so the same env state gives the same
actions. The per-train action probabilities of the last step are kept in
`last_action_probs` for the lab's confidence display and intervention log
(plan steps 2 and 4).
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import torch
import torch.nn as nn
from flatland.core.env_observation_builder import DummyObservationBuilder, ObservationBuilder
from flatland.envs.rail_env import RailEnv

from app.policies.base import Policy
from app.policies.learned.ecml_observation import FastTreeObsBuilder

CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"
DEFAULT_CHECKPOINT = CHECKPOINT_DIR / "ecml2026_ppo.pt"

OBS_SIZE = FastTreeObsBuilder.OBSERVATION_DIM
N_ACTIONS = FastTreeObsBuilder.ACTION_MASK_SIZE
EXPERIENCE_ENSEMBLE_SIZE = 3


def experience_state_key(obs: np.ndarray, mask: np.ndarray) -> tuple[int, ...]:
    """Quantized state key shared by the learner and runtime estimator."""
    features = np.rint(np.asarray(obs, dtype=np.float32)[:OBS_SIZE] * 100).astype(np.int32)
    valid_actions = (np.asarray(mask, dtype=np.float32)[:N_ACTIONS] >= 0.5).astype(np.int32)
    return tuple(int(value) for value in features) + tuple(int(value) for value in valid_actions)


def count_uncertainty_percent(mean_count: float, spread: float) -> float:
    """Conservative uncertainty proxy: low support or ensemble disagreement raises it."""
    mean_count = max(0.0, float(mean_count))
    spread = max(0.0, float(spread))
    uncertainty = max(1.0 / math.sqrt(mean_count + 1.0), spread / (mean_count + 1.0))
    return 100.0 * min(1.0, uncertainty)


class ActorCritic(nn.Module):
    """The starter kit's network: an MLP trunk with policy and value heads.

    Layer names match the checkpoint's state dict (`trunk.*`, `policy_head.*`,
    `value_head.*`), so `load_state_dict` takes the file as published.
    """

    def __init__(self, obs_size: int = OBS_SIZE, n_actions: int = N_ACTIONS,
                 hidden_size: int = 128, num_hidden_layers: int = 3):
        super().__init__()
        layers: list[nn.Module] = [nn.Linear(obs_size, hidden_size), nn.Tanh()]
        for _ in range(num_hidden_layers - 1):
            layers += [nn.Linear(hidden_size, hidden_size), nn.Tanh()]
        self.trunk = nn.Sequential(*layers)
        self.policy_head = nn.Linear(hidden_size, n_actions)
        self.value_head = nn.Linear(hidden_size, 1)
        self.experience_heads = nn.ModuleList(
            nn.Linear(hidden_size, n_actions) for _ in range(EXPERIENCE_ENSEMBLE_SIZE)
        )
        self.experience_estimator_ready = False
        self.experience_updates = 0
        self.experience_counts: dict[tuple[int, ...], dict[str, list[int]]] = {}

    def forward(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.trunk(obs)
        return self.policy_head(features), self.value_head(features).squeeze(-1)

    def forward_with_experience(
        self, obs: torch.Tensor
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        features = self.trunk(obs)
        return (
            self.policy_head(features),
            self.value_head(features).squeeze(-1),
            torch.stack([head(features) for head in self.experience_heads], dim=1),
        )


def load_actor_critic_state(model: ActorCritic, state: dict) -> bool:
    """Load current or legacy weights; only the new experience heads may be absent."""
    result = model.load_state_dict(state, strict=False)
    missing = [key for key in result.missing_keys if not key.startswith("experience_heads.")]
    if missing or result.unexpected_keys:
        raise RuntimeError(
            f"incompatible ActorCritic checkpoint: missing={missing}, unexpected={result.unexpected_keys}"
        )
    return not any(key.startswith("experience_heads.") for key in result.missing_keys)


def load_actor_critic_checkpoint(model: ActorCritic, checkpoint: dict) -> ActorCritic:
    has_experience_head = load_actor_critic_state(model, checkpoint["model"])
    meta = checkpoint.get("meta") or {}
    model.experience_updates = int(meta.get("experience_updates", 0))
    model.experience_estimator_ready = has_experience_head and model.experience_updates > 0
    model.experience_counts = {
        tuple(key): {
            "executed": list(counts.get("executed", [0] * N_ACTIONS)),
            "simulated": list(counts.get("simulated", [0] * N_ACTIONS)),
        }
        for key, counts in (checkpoint.get("experience_counts") or {}).items()
    }
    return model


_MODELS: dict[tuple[Path, int], ActorCritic] = {}


def load_actor_critic(path: Path = DEFAULT_CHECKPOINT) -> ActorCritic:
    """Load once per checkpoint file; every session shares the frozen network.

    Keyed by modification time too: the lab (backend/lab/marl/) retrains
    checkpoints under the same name, and a new session should get the new one.
    """
    path = Path(path)
    key = (path, path.stat().st_mtime_ns)
    model = _MODELS.get(key)
    if model is None:
        ckpt = torch.load(path, weights_only=False, map_location="cpu")
        model = load_actor_critic_checkpoint(ActorCritic(), ckpt)
        model.eval()
        _MODELS[key] = model
    return model


class LearnedPpoPolicy(Policy):
    def __init__(self, env: Optional[RailEnv] = None, checkpoint: Path = DEFAULT_CHECKPOINT):
        self.checkpoint = Path(checkpoint)
        self.model = load_actor_critic(self.checkpoint)
        self.obs_builder: Optional[FastTreeObsBuilder] = None
        self.last_action_probs: Dict[int, list[float]] = {}
        self.last_observations: Dict[int, np.ndarray] = {}
        self.last_action_seen_counts: Dict[int, list[float]] = {}
        self.last_action_seen_count_exact: Dict[int, bool] = {}
        self.last_action_seen_count_sources: Dict[int, dict[str, list[int]]] = {}
        self.last_action_seen_count_spread: Dict[int, list[float]] = {}
        self.last_action_seen_count_predictions: Dict[int, list[list[float]]] = {}
        self.last_action_seen_count_uncertainty: Dict[int, list[float]] = {}
        if env is not None:
            self.reset(env)

    def build_observation_builder(self) -> ObservationBuilder:
        # The env's own builder is not used (see the module docstring).
        return DummyObservationBuilder()

    def reset(self, env: RailEnv) -> None:
        builder = FastTreeObsBuilder(max_depth=3, with_action_mask=True)
        builder.set_env(env)
        builder.reset()
        self.obs_builder = builder
        self.last_action_probs = {}
        self.last_observations = {}
        self.last_action_seen_counts = {}
        self.last_action_seen_count_exact = {}
        self.last_action_seen_count_sources = {}
        self.last_action_seen_count_spread = {}
        self.last_action_seen_count_predictions = {}
        self.last_action_seen_count_uncertainty = {}

    def act_many(self, handles, observations=None, **kwargs):
        handles = list(handles)
        if not handles:
            return {}
        if self.obs_builder is None:
            raise RuntimeError("LearnedPpoPolicy.reset(env) must run before act_many")
        obs = np.stack([np.asarray(self.obs_builder.get(h), dtype=np.float32) for h in handles])
        features = torch.from_numpy(obs[:, :OBS_SIZE])
        mask = torch.from_numpy(obs[:, OBS_SIZE:OBS_SIZE + N_ACTIONS])
        with torch.no_grad():
            logits, _, log_seen_counts = self.model.forward_with_experience(features)
            logits = logits.masked_fill(mask < 0.5, float("-inf"))
            probs = torch.softmax(logits, dim=-1)
            actions = logits.argmax(dim=-1)
            count_predictions = torch.expm1(log_seen_counts).clamp_min(0)
            mean_predictions = count_predictions.mean(dim=1)
            spread_predictions = count_predictions.std(dim=1, unbiased=False)
        self.last_action_probs = {h: probs[i].tolist() for i, h in enumerate(handles)}
        self.last_observations = {h: obs[i] for i, h in enumerate(handles)}
        for i, handle in enumerate(handles):
            key = experience_state_key(obs[i, :OBS_SIZE], obs[i, OBS_SIZE:OBS_SIZE + N_ACTIONS])
            stored = self.model.experience_counts.get(key)
            if stored is not None:
                executed = list(stored.get("executed", [0] * N_ACTIONS))
                simulated = list(stored.get("simulated", [0] * N_ACTIONS))
                seen_counts = [executed_count + simulated_count
                               for executed_count, simulated_count in zip(executed, simulated)]
                self.last_action_seen_count_exact[handle] = True
                self.last_action_seen_count_sources[handle] = {
                    "executed": executed,
                    "simulated": simulated,
                }
                spreads = (spread_predictions[i].cpu().numpy().tolist()
                           if self.model.experience_estimator_ready else [0.0] * N_ACTIONS)
            elif self.model.experience_estimator_ready:
                seen_counts = [float(value) for value in mean_predictions[i].cpu().numpy()]
                self.last_action_seen_count_exact[handle] = False
                spreads = [float(value) for value in spread_predictions[i].cpu().numpy()]
            else:
                seen_counts = None
                spreads = [0.0] * N_ACTIONS
                self.last_action_seen_count_exact[handle] = False
            if seen_counts is not None:
                self.last_action_seen_counts[handle] = seen_counts
            self.last_action_seen_count_spread[handle] = spreads
            self.last_action_seen_count_predictions[handle] = (
                count_predictions[i].cpu().numpy().tolist()
                if self.model.experience_estimator_ready else []
            )
            self.last_action_seen_count_uncertainty[handle] = [
                count_uncertainty_percent(count, spread)
                for count, spread in zip(seen_counts or [0.0] * N_ACTIONS, spreads)
            ]
        return {h: int(actions[i]) for i, h in enumerate(handles)}

    def value_estimate(self, env: RailEnv, handle: int) -> float:
        """Estimate V(s) for a handle in the supplied environment state."""
        builder = self.obs_builder
        if builder is None or builder.env is not env:
            builder = FastTreeObsBuilder(max_depth=3, with_action_mask=True)
            builder.set_env(env)
            builder.reset()
        observation = np.asarray(builder.get(handle), dtype=np.float32)
        features = torch.from_numpy(observation[:OBS_SIZE]).unsqueeze(0)
        with torch.no_grad():
            _, value = self.model(features)
        return float(value.item())

    def intervention_features(self, handle: int) -> Optional[dict]:
        """What the policy saw and wanted for `handle` in the last step — the
        state half of an intervention record (app/core/intervention_log.py)."""
        obs = self.last_observations.get(handle)
        if obs is None:
            return None
        return {
            "obs": obs[:OBS_SIZE].round(5).tolist(),
            "mask": obs[OBS_SIZE:OBS_SIZE + N_ACTIONS].tolist(),
            "ai_probs": [round(p, 5) for p in self.last_action_probs.get(handle, [])],
            "policy": self.get_name(),
        }

    def act_for_handle(self, handle, observation=None, eps=0.0):
        return self.act_many([handle])[handle]

    def get_name(self) -> str:
        return f"LearnedPpoPolicy({self.checkpoint.stem})"
