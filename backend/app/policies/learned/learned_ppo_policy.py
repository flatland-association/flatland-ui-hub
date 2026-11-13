"""Shared actor-critic policies with checkpoint-specific observations.

The MLP and checkpoint format are vendored from the ECML starter kit (MIT,
LICENSE.ecml2026-starterkit). Legacy checkpoints retain their original
36-feature waypoint and mask semantics. PF-CH checkpoints can use explicit
service or corridor-context schemas. Each policy builds observations from
its session environment and greedily selects among the allowed actions.
"""
from __future__ import annotations

import math
from collections import OrderedDict
from threading import RLock
from pathlib import Path
from typing import TYPE_CHECKING, Dict, Optional

import numpy as np
import torch
import torch.nn as nn
from flatland.core.env_observation_builder import DummyObservationBuilder, ObservationBuilder
from flatland.envs.rail_env import RailEnv

from app.policies.base import Policy
from app.policies.learned.ecml_observation import (
    LEGACY_OBSERVATION_SCHEMA,
    OBSERVATION_SCHEMA,
    FastTreeObsBuilder,
)

if TYPE_CHECKING:
    from app.policies.learned.pf_ch_observation import PFChObservationBuilder

CHECKPOINT_DIR = Path(__file__).parent / "checkpoints"
DEFAULT_CHECKPOINT = CHECKPOINT_DIR / "ecml2026_ppo.pt"

OBS_SIZE = FastTreeObsBuilder.OBSERVATION_DIM
N_ACTIONS = FastTreeObsBuilder.ACTION_MASK_SIZE
EXPERIENCE_ENSEMBLE_SIZE = 3
PF_CH_CONTEXT_OBSERVATION_SCHEMA = "pf-ch-context-v1"
PF_CH_RELATIVE_OBSERVATION_SCHEMA = "pf-ch-relative-v1"
UC2_CONTEXT_OBSERVATION_SCHEMA = "uc2-context-v1"


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
        self.observation_schema = OBSERVATION_SCHEMA
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


SUPPORTED_HIDDEN_SIZES = (128, 256, 384)


def checkpoint_hidden_size(checkpoint: dict) -> int:
    """Validate the fixed three-layer MLP shape and infer its hidden width.

    Older checkpoints need no architecture metadata. Declared widths/depths,
    when present, must agree with their actual tensors before construction.
    """
    state = checkpoint.get("model") or {}
    try:
        first = state["trunk.0.weight"]
        if first.ndim != 2:
            raise ValueError("first trunk weight must be a matrix")
        width, inputs = map(int, first.shape)
    except (KeyError, AttributeError, TypeError) as exc:
        raise ValueError("checkpoint has no valid first trunk weight") from exc
    if width not in SUPPORTED_HIDDEN_SIZES or inputs < 1:
        raise ValueError(f"unsupported hidden width {width}; expected {SUPPORTED_HIDDEN_SIZES}")
    meta = checkpoint.get("meta") or {}
    if meta.get("hidden_size", width) != width or meta.get("num_hidden_layers", 3) != 3:
        raise ValueError("checkpoint architecture metadata differs from its tensors")
    expected = {f"trunk.{index}.{part}" for index in (0, 2, 4) for part in ("weight", "bias")}
    if {key for key in state if key.startswith("trunk.")} != expected:
        raise ValueError("checkpoint must contain exactly three hidden trunk layers")
    shapes = {
        "trunk.0.weight": (width, inputs), "trunk.0.bias": (width,),
        "trunk.2.weight": (width, width), "trunk.2.bias": (width,),
        "trunk.4.weight": (width, width), "trunk.4.bias": (width,),
        "policy_head.weight": (N_ACTIONS, width), "policy_head.bias": (N_ACTIONS,),
        "value_head.weight": (1, width), "value_head.bias": (1,),
    }
    for index in range(EXPERIENCE_ENSEMBLE_SIZE):
        for part, shape in (("weight", (N_ACTIONS, width)), ("bias", (N_ACTIONS,))):
            name = f"experience_heads.{index}.{part}"
            if name in state:
                shapes[name] = shape
    for name, shape in shapes.items():
        value = state.get(name)
        if not isinstance(value, torch.Tensor) or tuple(value.shape) != shape:
            raise ValueError(f"checkpoint tensor {name!r} must have shape {shape}")
    return width


def load_actor_critic_state(model: ActorCritic, state: dict) -> bool:
    """Load current or legacy weights; only the new experience heads may be absent."""
    result = model.load_state_dict(state, strict=False)
    missing = [key for key in result.missing_keys if not key.startswith("experience_heads.")]
    if missing or result.unexpected_keys:
        raise RuntimeError(
            f"incompatible ActorCritic checkpoint: missing={missing}, unexpected={result.unexpected_keys}"
        )
    return not any(key.startswith("experience_heads.") for key in result.missing_keys)


def _observation_builder(schema: str) -> FastTreeObsBuilder | PFChObservationBuilder:
    if schema in (LEGACY_OBSERVATION_SCHEMA, OBSERVATION_SCHEMA):
        return FastTreeObsBuilder(max_depth=3, with_action_mask=True, schema=schema)
    if schema == UC2_CONTEXT_OBSERVATION_SCHEMA:
        from app.policies.learned.uc2_observation import UC2ObservationBuilder

        return UC2ObservationBuilder(max_depth=3, with_action_mask=True)
    if schema == PF_CH_RELATIVE_OBSERVATION_SCHEMA:
        from app.policies.learned.pf_ch_relative_observation import PFChRelativeObservationBuilder

        return PFChRelativeObservationBuilder(max_depth=3, with_action_mask=True)
    if schema == PF_CH_CONTEXT_OBSERVATION_SCHEMA:
        from app.policies.learned.pf_ch_observation import PFChObservationBuilder

        return PFChObservationBuilder(max_depth=3, with_action_mask=True)
    raise ValueError(f"unsupported observation schema: {schema!r}")


def checkpoint_observation_size(checkpoint: dict) -> int:
    """The checkpoint input width, checked against its declared observation schema."""
    meta = checkpoint.get("meta") or {}
    schema = meta.get("observation_schema", LEGACY_OBSERVATION_SCHEMA)
    expected = _observation_builder(schema).OBSERVATION_DIM
    actual = int(checkpoint["model"]["trunk.0.weight"].shape[1])
    declared = meta.get("observation_dim", meta.get("obs_size", actual))
    if actual != expected or declared != actual:
        raise ValueError(
            f"observation schema {schema!r} expects {expected} inputs; "
            f"checkpoint has {actual}, metadata declares {declared}"
        )
    return actual


def load_actor_critic_checkpoint(model: ActorCritic, checkpoint: dict) -> ActorCritic:
    meta = checkpoint.get("meta") or {}
    schema = meta.get("observation_schema", LEGACY_OBSERVATION_SCHEMA)
    obs_size = checkpoint_observation_size(checkpoint)
    hidden_size = checkpoint_hidden_size(checkpoint)
    if model.trunk[0].out_features != hidden_size:
        raise ValueError(f"checkpoint expects hidden width {hidden_size}; supplied model differs")
    if model.trunk[0].in_features != obs_size:
        raise ValueError(f"checkpoint expects {obs_size} inputs; supplied model has {model.trunk[0].in_features}")
    has_experience_head = load_actor_critic_state(model, checkpoint["model"])
    model.observation_schema = schema
    # The existing experience estimator is trained/keyed on 36 features only.
    model.experience_updates = int(meta.get("experience_updates", 0)) if obs_size == OBS_SIZE else 0
    model.experience_estimator_ready = has_experience_head and model.experience_updates > 0
    experience_counts = (checkpoint.get("experience_counts") or {}) if obs_size == OBS_SIZE else {}
    model.experience_counts = {
        tuple(key): {
            "executed": list(counts.get("executed", [0] * N_ACTIONS)),
            "simulated": list(counts.get("simulated", [0] * N_ACTIONS)),
        }
        for key, counts in experience_counts.items()
    }
    return model


_MODELS: OrderedDict[tuple[Path, int], ActorCritic] = OrderedDict()
_MODEL_CACHE_LOCK = RLock()
MAX_CACHED_MODELS = 4


def load_actor_critic(path: Path = DEFAULT_CHECKPOINT) -> ActorCritic:
    """Load once per checkpoint file; every session shares the frozen network.

    Keyed by modification time too: the lab (backend/lab/marl/) retrains
    checkpoints under the same name, and a new session should get the new one.
    """
    path = Path(path).resolve()
    key = (path, path.stat().st_mtime_ns)
    with _MODEL_CACHE_LOCK:
        model = _MODELS.get(key)
        if model is not None:
            _MODELS.move_to_end(key)
            return model
        # The shipped inference export contains tensors and primitive metadata.
        ckpt = torch.load(path, weights_only=True, map_location="cpu")
        model = load_actor_critic_checkpoint(ActorCritic(obs_size=checkpoint_observation_size(ckpt),
                                                      hidden_size=checkpoint_hidden_size(ckpt)), ckpt)
        model.eval().requires_grad_(False)
        # A retrained file must not retain every historical version in memory.
        for stale in [entry for entry in _MODELS if entry[0] == path]:
            del _MODELS[stale]
        _MODELS[key] = model
        while len(_MODELS) > MAX_CACHED_MODELS:
            _MODELS.popitem(last=False)
        return model


class LearnedPpoPolicy(Policy):
    def __init__(self, env: Optional[RailEnv] = None, checkpoint: Path = DEFAULT_CHECKPOINT):
        self.checkpoint = Path(checkpoint)
        self.model = load_actor_critic(self.checkpoint)
        self.obs_builder: Optional[FastTreeObsBuilder | PFChObservationBuilder] = None
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
        builder = _observation_builder(self.model.observation_schema)
        builder.reset(env)
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
        return self.infer_prepared(self.prepare_inference(handles))

    def prepare_inference(self, handles) -> tuple[list[int], np.ndarray, int]:
        """Capture a private feature batch while the live environment is stable."""
        handles = list(handles)
        if not handles:
            return handles, np.empty((0, 0), dtype=np.float32), 0
        if self.obs_builder is None:
            raise RuntimeError("LearnedPpoPolicy.reset(env) must run before act_many")
        observations = self.obs_builder.get_many(handles)
        obs = np.stack([np.asarray(observations[h], dtype=np.float32) for h in handles])
        return handles, obs, self.obs_builder.OBSERVATION_DIM

    def infer_prepared(self, prepared: tuple[list[int], np.ndarray, int]):
        """Infer from an owned batch without reading the environment or builder."""
        handles, obs, obs_size = prepared
        if not handles:
            return {}
        features = torch.from_numpy(obs[:, :obs_size])
        mask = torch.from_numpy(obs[:, obs_size:obs_size + N_ACTIONS])
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
            stored = None
            if obs_size == OBS_SIZE:
                key = experience_state_key(obs[i, :obs_size], obs[i, obs_size:obs_size + N_ACTIONS])
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
            builder = _observation_builder(self.model.observation_schema)
            builder.reset(env)
        observation = np.asarray(builder.get(handle), dtype=np.float32)
        features = torch.from_numpy(observation[:builder.OBSERVATION_DIM]).unsqueeze(0)
        with torch.no_grad():
            _, value = self.model(features)
        return float(value.item())

    def intervention_features(self, handle: int) -> Optional[dict]:
        """What the policy saw and wanted for `handle` in the last step — the
        state half of an intervention record (app/core/intervention_log.py)."""
        obs = self.last_observations.get(handle)
        builder = self.obs_builder
        if obs is None or builder is None:
            return None
        obs_size = builder.OBSERVATION_DIM
        return {
            "obs": obs[:obs_size].round(5).tolist(),
            "mask": obs[obs_size:obs_size + N_ACTIONS].tolist(),
            "ai_probs": [round(p, 5) for p in self.last_action_probs.get(handle, [])],
            "policy": self.get_name(),
        }

    def act_for_handle(self, handle, observation=None, eps=0.0):
        return self.act_many([handle])[handle]

    def get_name(self) -> str:
        return f"LearnedPpoPolicy({self.checkpoint.stem})"
