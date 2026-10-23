"""Every knob of the online learner, with the defaults the hub starts with."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "lab" / "online"
PUBLISHED_NAME = "online-ppo"  # the stable version, offered as lab:online-ppo


@dataclass
class OnlineConfig:
    # where the learner starts: "scratch", "ecml" or "lab:<name>"
    init: str = "scratch"
    # background episodes (preset ids or gen:WxH:trains:seed, seed "*" = new network)
    scenarios: list[str] = field(default_factory=lambda: [
        "gen:30x30:3:*",
        "pf-ch-wn-wal-long-approach",
    ])
    # the policies asked at every step, besides the learner itself
    active_policies: list[str] = field(default_factory=lambda: ["deadlock_avoidance", "shortest_path", "learned_ppo"])
    fallback_policy: str = "deadlock_avoidance"

    # buffers
    rollout_buffer_size: int = 20_000
    prediction_buffer_size: int = 20_000
    user_buffer_size: int = 2_000
    counterfactual_buffer_size: int = 10_000
    distillation_buffer_size: int = 5_000
    experience_buffer_size: int = 50_000
    experience_state_capacity: int = 50_000

    # PPO
    min_rollout_steps: int = 2048
    epochs: int = 4
    batch_size: int = 256
    learning_rate: float = 3e-4
    gamma: float = 0.99
    lam: float = 0.95
    clip: float = 0.2
    value_coef: float = 0.5
    entropy_coef: float = 0.01
    max_grad_norm: float = 0.5
    normalize_advantages: bool = True
    target_kl: float = 0.05          # an epoch stops early above this
    collapse_kl: float = 0.5         # a candidate above this is rejected outright
    collapse_entropy: float = 0.02   # ... and below this entropy too
    distill_coef: float = 0.5
    distill_batch_size: int = 128
    experience_coef: float = 0.1
    experience_batch_size: int = 128

    # counterfactual forks
    cf_every: int = 4                # every n-th step
    cf_max_trains: int = 2           # trains with a real choice per forked step
    cf_horizon: int = 20             # steps a fork runs
    cf_margin: float = 0.05          # a candidate must beat the learner's own action by this

    # evaluation and acceptance
    eval_scenarios: list[str] = field(default_factory=lambda: [
        "gen:30x30:3:101", "gen:30x30:3:102", "gen:30x30:3:103", "gen:30x30:3:104",
        "gen:30x30:3:105", "gen:30x30:3:106",
    ])
    # better than stable -> new stable version (published); within this much of
    # stable -> training continues from it, stable unchanged; worse -> rollback
    accept_tolerance: float = 0.05
    safety_tolerance: float = 0.0    # candidate deadlocks per episode <= stable + tolerance
    baseline_policy: str = "deadlock_avoidance"

    seed: int = 0
    torch_threads: int = 2
    status_every_steps: int = 25

    @classmethod
    def from_dict(cls, data: dict | None) -> "OnlineConfig":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (data or {}).items() if k in known})

    def to_dict(self) -> dict:
        return asdict(self)
