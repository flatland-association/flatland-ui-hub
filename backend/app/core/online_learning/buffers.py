"""The five separate buffers. Only `PpoRolloutBuffer` feeds the PPO loss, and
it refuses anything the current learner version did not sample itself."""
from __future__ import annotations

from collections import deque
from typing import Generic, Iterator, TypeVar

from .records import (
    LEARNER_SOURCE,
    CounterfactualResult,
    DistillationSample,
    PolicyPrediction,
    RolloutStep,
    UserInteraction,
)

T = TypeVar("T")


class OffPolicyDataError(ValueError):
    """Raised when data that is not on-policy for the current version is
    offered to the PPO rollout buffer."""


class BoundedBuffer(Generic[T]):
    def __init__(self, capacity: int, record_type: type):
        self.capacity = int(capacity)
        self.record_type = record_type
        self._items: deque = deque(maxlen=self.capacity)

    def add(self, item: T) -> None:
        if not isinstance(item, self.record_type):
            raise TypeError(f"{type(self).__name__} holds {self.record_type.__name__}, not {type(item).__name__}")
        self._items.append(item)

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self) -> Iterator[T]:
        return iter(self._items)

    def items(self) -> list[T]:
        return list(self._items)

    def clear(self) -> None:
        self._items.clear()


class PpoRolloutBuffer(BoundedBuffer[RolloutStep]):
    """Valid on-policy data only: steps sampled by the learner's current version."""

    def __init__(self, capacity: int, version: int = 0):
        super().__init__(capacity, RolloutStep)
        self.version = version

    def add(self, item: RolloutStep) -> None:
        if not isinstance(item, RolloutStep):
            raise OffPolicyDataError(f"only learner rollout steps go into the PPO buffer, not {type(item).__name__}")
        if item.source != LEARNER_SOURCE:
            raise OffPolicyDataError(f"step from {item.source!r} is off-policy for PPO")
        if item.policy_version != self.version:
            raise OffPolicyDataError(
                f"step of version {item.policy_version} is stale for the current version {self.version}")
        super().add(item)

    def reset(self, version: int) -> None:
        """A new policy version invalidates every step collected before."""
        self.version = version
        self.clear()


def make_buffers(cfg) -> dict:
    return {
        "ppo_rollout_buffer": PpoRolloutBuffer(cfg.rollout_buffer_size),
        "multi_policy_prediction_buffer": BoundedBuffer(cfg.prediction_buffer_size, PolicyPrediction),
        "user_interaction_buffer": BoundedBuffer(cfg.user_buffer_size, UserInteraction),
        "counterfactual_evaluation_buffer": BoundedBuffer(cfg.counterfactual_buffer_size, CounterfactualResult),
        "distillation_buffer": BoundedBuffer(cfg.distillation_buffer_size, DistillationSample),
    }
