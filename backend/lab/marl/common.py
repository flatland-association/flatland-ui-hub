"""Shared pieces of the MARL lab scripts (docs/plans/marl-lab-plan.md, step 3).

Same network and observation as the hub's learned policy
(`app/policies/learned/learned_ppo_policy.py`), so whatever the lab trains
loads there unchanged.
"""
from __future__ import annotations

import random
import time
from pathlib import Path

import numpy as np
import torch

from app.core.env_factory import create_env
from app.policies.learned.ecml_observation import OBSERVATION_SCHEMA, FastTreeObsBuilder
from app.policies.learned.lab_checkpoints import checkpoint_path, write_meta
from app.policies.learned.learned_ppo_policy import (
    DEFAULT_CHECKPOINT,
    N_ACTIONS,
    OBS_SIZE,
    ActorCritic,
    SUPPORTED_HIDDEN_SIZES,
    checkpoint_hidden_size,
    load_actor_critic_state,
)

__all__ = [
    "DEFAULT_CHECKPOINT",
    "N_ACTIONS",
    "OBS_SIZE",
    "ActorCritic",
    "load_model",
    "make_env",
    "make_obs_builder",
    "masked_logits",
    "observation_size",
    "observe",
    "pick_device",
    "save_checkpoint",
    "seed_everything",
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


def make_env(scenario: str, rng: random.Random | None = None):
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


def observation_size(schema: str = OBSERVATION_SCHEMA) -> int:
    """Feature count for a supported training/runtime schema."""
    if schema == 'uc2-context-v1':
        from app.policies.learned.uc2_observation import UC2ObservationBuilder
        return UC2ObservationBuilder.OBSERVATION_DIM
    if schema == 'pf-ch-relative-v1':
        from app.policies.learned.pf_ch_relative_observation import PFChRelativeObservationBuilder
        return PFChRelativeObservationBuilder.OBSERVATION_DIM
    if schema == 'pf-ch-context-v1':
        from app.policies.learned.pf_ch_observation import PFChObservationBuilder
        return PFChObservationBuilder.OBSERVATION_DIM
    if schema in (OBSERVATION_SCHEMA, 'ecml36-legacy-v0'):
        return OBS_SIZE
    raise ValueError(f'unsupported observation schema: {schema}')


def make_obs_builder(env, observation_schema: str = OBSERVATION_SCHEMA):
    if observation_schema == 'uc2-context-v1':
        from app.policies.learned.uc2_observation import UC2ObservationBuilder
        builder = UC2ObservationBuilder(max_depth=3, with_action_mask=True)
    elif observation_schema == 'pf-ch-relative-v1':
        from app.policies.learned.pf_ch_relative_observation import PFChRelativeObservationBuilder
        builder = PFChRelativeObservationBuilder(max_depth=3, with_action_mask=True)
    elif observation_schema == 'pf-ch-context-v1':
        from app.policies.learned.pf_ch_observation import PFChObservationBuilder
        builder = PFChObservationBuilder(max_depth=3, with_action_mask=True)
    else:
        builder = FastTreeObsBuilder(max_depth=3, with_action_mask=True, schema=observation_schema)
    builder.reset(env)
    return builder


def observe(builder, handles) -> tuple[np.ndarray, np.ndarray]:
    """Features and five-action masks in the builder's versioned schema."""
    handles = list(handles)
    observations = builder.get_many(handles)
    obs = np.stack([np.asarray(observations[h], dtype=np.float32) for h in handles])
    size = builder.OBSERVATION_DIM
    if obs.shape[1] != size + N_ACTIONS:
        raise ValueError("observation/mask dimensions do not match builder schema")
    return obs[:, :size], obs[:, size:size + N_ACTIONS]


def masked_logits(logits: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    return logits.masked_fill(mask < 0.5, MASKED)


def load_model(path: Path | None, *, obs_size: int | None = None,
               observation_schema: str | None = None, hidden_size: int | None = None) -> ActorCritic:
    """Load native weights, optionally extending inputs or hidden capacity.

    Widening embeds the complete old computation in the leading hidden block.
    New-to-old and new-to-head connections start at zero; extra neurons retain
    random incoming weights, allowing their outgoing gradients to activate them.
    """
    checkpoint = torch.load(Path(path), weights_only=False, map_location='cpu') if path else None
    previous_size = checkpoint['model']['trunk.0.weight'].shape[1] if checkpoint else OBS_SIZE
    previous_hidden = checkpoint_hidden_size(checkpoint) if checkpoint else 128
    width = hidden_size if hidden_size is not None else previous_hidden
    if width not in SUPPORTED_HIDDEN_SIZES or (checkpoint and width < previous_hidden):
        raise ValueError("unsupported hidden width or shrinking a checkpoint is not allowed")
    size = obs_size if obs_size is not None else previous_size
    schema = observation_schema or ((checkpoint.get('meta') or {}).get('observation_schema', 'ecml36-legacy-v0')
                                    if checkpoint else OBSERVATION_SCHEMA)
    if observation_size(schema) != size:
        raise ValueError('input width does not match observation schema')
    model = ActorCritic(obs_size=size, hidden_size=width)
    if checkpoint:
        state = dict(checkpoint['model'])
        if size != previous_size:
            previous_schema = (checkpoint.get('meta') or {}).get('observation_schema', 'ecml36-legacy-v0')
            native_extension = previous_size == OBS_SIZE and size > previous_size
            relative_extension = (previous_schema == 'pf-ch-context-v1' and schema == 'pf-ch-relative-v1'
                                  and previous_size == 272 and size == 368)
            uc2_extension = (previous_schema == 'pf-ch-context-v1' and schema == 'uc2-context-v1'
                             and previous_size == 272 and size == 313)
            if not (native_extension or relative_extension or uc2_extension):
                raise ValueError('only36-feature extension or prefix-preserving272-to368/313 extension is supported')
            original = state['trunk.0.weight']
            expanded = original.new_zeros((original.shape[0], size))
            expanded[:, :previous_size] = original
            state['trunk.0.weight'] = expanded
        if width > previous_hidden:
            expanded = {key: value.detach().clone() for key, value in model.state_dict().items()}
            for key, value in state.items():
                if key not in expanded:
                    raise ValueError(f"unsupported checkpoint tensor {key!r}")
                destination = expanded[key]
                if value.ndim == 2:
                    # Do not let random extra units change any old activation.
                    destination[:value.shape[0], :] = 0
                    destination[:value.shape[0], :value.shape[1]] = value
                else:
                    destination[:value.shape[0]] = value
            state = expanded
        load_actor_critic_state(model, state)
    model.observation_schema = schema
    return model


def save_checkpoint(name: str, model: ActorCritic, meta: dict,
                    optimizer: torch.optim.Optimizer | None = None,
                    training_state: dict | None = None) -> Path:
    """`lab/checkpoints/<name>.pt` in the hub's format ({"model": state_dict, ...})
    plus the `<name>.json` sidecar the registry reads without torch."""
    path = checkpoint_path(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    meta = {"observation_schema": model.observation_schema, "obs_size": model.trunk[0].in_features, **meta, "hidden_size": model.trunk[0].out_features, "num_hidden_layers": 3,
            "saved_at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    payload = {"model": {k: v.detach().cpu() for k, v in model.state_dict().items()}, "meta": meta}
    if optimizer is not None:
        payload["optimizer"] = optimizer.state_dict()
    if training_state is not None:
        payload["training_state"] = training_state
    tmp = path.with_suffix(".pt.tmp")
    torch.save(payload, tmp)
    tmp.replace(path)  # a running hub never sees a half-written file
    write_meta(path, meta)
    return path
