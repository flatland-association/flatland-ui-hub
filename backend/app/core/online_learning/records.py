"""What each buffer holds (docs/plans/online-ppo-learning.md, "Data model")."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional

LEARNER_SOURCE = "learner_rollout"


@dataclass
class RolloutStep:
    """One decision the current learner version sampled itself (on-policy)."""
    obs: list[float]
    mask: list[float]
    action: int
    log_prob: float
    value: float
    reward: float
    done: bool
    policy_version: int
    episode_id: int
    step: int
    handle: int
    source: str = LEARNER_SOURCE
    advantage: float = 0.0
    ret: float = 0.0


@dataclass
class PolicyPrediction:
    """What one active policy would do for one train at one step."""
    policy_id: str
    policy_version: str
    session_id: str
    episode_id: int
    step: int
    handle: int
    obs: Optional[list[float]]
    action: Optional[int]
    confidence: Optional[float] = None
    logits: Optional[list[float]] = None
    value: Optional[float] = None
    mode: str = "background"
    error: Optional[str] = None


@dataclass
class UserInteraction:
    """A human decision in the hub: override, rejected AI suggestion or feedback."""
    kind: str                      # "override" | "rejected_suggestion" | "feedback"
    session_id: str
    step: int
    handle: int
    mode: Optional[str]
    owner: Optional[str]
    human_action: Optional[int] = None
    ai_action: Optional[int] = None
    feedback: Optional[str] = None
    human_score: Optional[float] = None
    ai_score: Optional[float] = None
    outcome: Optional[str] = None  # "better" | "worse" | "equal" | "not evaluated"


@dataclass
class CounterfactualResult:
    """A candidate action that a fork actually ran."""
    episode_id: int
    step: int
    handle: int
    action: int
    sources: list[str]
    horizon: int
    components: dict
    score: float
    feasible: bool
    context: str = "background"    # "background" | "user"


@dataclass
class DistillationSample:
    """An action that scored better in a fork than the learner's own."""
    obs: list[float]
    mask: list[float]
    target_action: int
    sources: list[str]
    score_gap: float
    origin: str = "counterfactual"  # "counterfactual" | "user"


def to_dict(record) -> dict:
    return asdict(record)
