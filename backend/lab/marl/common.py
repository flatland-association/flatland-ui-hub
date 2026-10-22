"""Shared pieces of the MARL lab scripts (docs/plans/marl-lab-plan.md, step 3).

Same network and observation as the hub's learned policy
(`app/policies/learned/learned_ppo_policy.py`), so whatever the lab trains
loads there unchanged.
"""
from __future__ import annotations

import random
import time
from pathlib import Path
from typing import Optional

import numpy as np
import torch

from app.core.env_factory import create_env
from app.policies.learned.ecml_observation import FastTreeObsBuilder
from app.policies.learned.lab_checkpoints import checkpoint_path, write_meta
from app.policies.learned.learned_ppo_policy import (
    DEFAULT_CHECKPOINT,
    N_ACTIONS,
    OBS_SIZE,
    ActorCritic,
    load_actor_critic_state,
)

__all__ = [
    "DEFAULT_CHECKPOINT", "N_ACTIONS", "OBS_SIZE", "ActorCritic",
    "pick_device", "make_env", "make_obs_builder", "observe",
    "masked_logits", "load_model", "save_checkpoint", "seed_everything",
]

# Masked logits get this instead of -inf, so log-probabilities and the KL stay
# finite (0 * -inf is nan). Softmax of it is 0 in float32.
MASKED = -1e9


def pick_device(name: str = "auto") -> torch.device:
    """`auto` takes cuda, then mps (Apple silicon), then cpu."""
    if name != "auto":
        return torch.device(name)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def seed_everything(seed: int) -> random.Random:
    random.seed(seed)
    np.random.seed(seed % (2**32))
    torch.manual_seed(seed)
    return random.Random(seed)


def make_env(scenario: str, rng: Optional[random.Random] = None):
    """A preset id, or a generated network "gen:<W>x<H>:<trains>:<seed>".

    Seed "*" draws a new seed per call from `rng`, so every training episode
    gets a different network of the same size.
    """
    if scenario.startswith("gen:"):
        _, size, trains, seed = scenario.split(":")
        width, height = (int(v) for v in size.split("x"))
        if seed == "*":
            seed_value = (rng or random).randrange(1, 2**31)
        else:
            seed_value = int(seed)
        return create_env(width=width, height=height, number_of_agents=int(trains), seed=seed_value)
    return create_env(scenario_preset_id=scenario)


def make_obs_builder(env) -> FastTreeObsBuilder:
    builder = FastTreeObsBuilder(max_depth=3, with_action_mask=True)
    builder.reset(env)
    return builder


def observe(builder: FastTreeObsBuilder, handles) -> tuple[np.ndarray, np.ndarray]:
    """(features [n, 36], mask [n, 5]) for `handles`, as the hub policy sees them."""
    obs = np.stack([np.asarray(builder.get(h), dtype=np.float32) for h in handles])
    return obs[:, :OBS_SIZE], obs[:, OBS_SIZE:OBS_SIZE + N_ACTIONS]


def masked_logits(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    return logits.masked_fill(mask < 0.5, MASKED)


def load_model(path: Optional[Path]) -> ActorCritic:
    """A fresh network for `None`, else the weights of a checkpoint file."""
    model = ActorCritic()
    if path is not None:
        ckpt = torch.load(Path(path), weights_only=False, map_location="cpu")
        load_actor_critic_state(model, ckpt["model"])
    return model


def save_checkpoint(name: str, model: ActorCritic, meta: dict,
                    optimizer: Optional[torch.optim.Optimizer] = None) -> Path:
    """`lab/checkpoints/<name>.pt` in the hub's format ({"model": state_dict, ...})
    plus the `<name>.json` sidecar the registry reads without torch."""
    path = checkpoint_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {**meta, "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    payload = {"model": {k: v.detach().cpu() for k, v in model.state_dict().items()}, "meta": meta}
    if optimizer is not None:
        payload["optimizer"] = optimizer.state_dict()
    tmp = path.with_suffix(".pt.tmp")
    torch.save(payload, tmp)
    tmp.replace(path)  # a running hub never sees a half-written file
    write_meta(path, meta)
    return path
