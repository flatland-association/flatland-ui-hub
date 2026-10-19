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

    def forward(self, obs: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        features = self.trunk(obs)
        return self.policy_head(features), self.value_head(features).squeeze(-1)


_MODELS: dict[Path, ActorCritic] = {}


def load_actor_critic(path: Path = DEFAULT_CHECKPOINT) -> ActorCritic:
    """Load once per checkpoint file; every session shares the frozen network."""
    path = Path(path)
    model = _MODELS.get(path)
    if model is None:
        ckpt = torch.load(path, weights_only=False, map_location="cpu")
        model = ActorCritic()
        model.load_state_dict(ckpt["model"])
        model.eval()
        _MODELS[path] = model
    return model


class LearnedPpoPolicy(Policy):
    def __init__(self, env: Optional[RailEnv] = None, checkpoint: Path = DEFAULT_CHECKPOINT):
        self.checkpoint = Path(checkpoint)
        self.model = load_actor_critic(self.checkpoint)
        self.obs_builder: Optional[FastTreeObsBuilder] = None
        self.last_action_probs: Dict[int, list[float]] = {}
        self.last_observations: Dict[int, np.ndarray] = {}
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
            logits, _ = self.model(features)
            logits = logits.masked_fill(mask < 0.5, float("-inf"))
            probs = torch.softmax(logits, dim=-1)
            actions = logits.argmax(dim=-1)
        self.last_action_probs = {h: probs[i].tolist() for i, h in enumerate(handles)}
        self.last_observations = {h: obs[i] for i, h in enumerate(handles)}
        return {h: int(actions[i]) for i, h in enumerate(handles)}

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
