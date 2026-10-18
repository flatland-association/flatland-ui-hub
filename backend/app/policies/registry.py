"""Central policy registry for runtime creation + UI metadata.

Single source of truth for:
- available policy ids
- policy labels/descriptions for /policies
- runtime construction for step/play/scenario APIs
"""
from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from typing import Callable

from flatland.envs.rail_env import RailEnv

from app.policies.base import Policy
from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy
from app.policies.goal_directed_policy import GoalDirectedPolicy
from app.policies.shortest_path_policy import ShortestPathPolicy
from app.policies.forward_only_policy import ForwardOnlyPolicy
from app.policies.do_nothing_policy import DoNothingPolicy
from app.policies.plan_policy import PlanPolicy, trainruns_from_env
from app.policies.random_policy import RandomPolicy


PolicyFactory = Callable[[RailEnv], Policy]
PolicyBranchFactory = Callable[[], Policy]


@dataclass(frozen=True)
class PolicySpec:
    """Runtime construction + catalog metadata for one algorithm.

    The catalog fields exist so the Algorithm Gallery can *describe* an
    algorithm rather than just name it: before it, the UI offered a dropdown of
    five labels and nothing else — no way to tell rule-based from learned, what
    a policy does when two trains contend, or whether it may be published.

    They live HERE rather than in a frontend catalog on purpose. This registry
    is already the single source of truth for runtime behaviour; a second copy
    in the frontend is exactly the drift the widget catalog has to guard against
    with a consistency check.
    """

    id: str
    label: str
    description: str
    is_default: bool
    show_in_ui: bool
    supports_scenarios: bool
    runtime_factory: PolicyFactory
    branch_factory: PolicyBranchFactory

    # ── catalog metadata ────────────────────────────────────────────────
    #: How it decides: rule-based | search-based | learned | hybrid.
    family: str = "rule-based"
    #: Same env + same seed -> same actions?
    deterministic: bool = True
    #: Why it is in the list: operational | baseline | diagnostic.
    role: str = "operational"
    #: The ObservationBuilder it ships via build_observation_builder().
    observation: str = "DummyObservationBuilder"
    #: The operationally interesting bit: behaviour when trains contend.
    at_conflict: str = ""
    #: Where the implementation comes from.
    provenance: str = ""
    #: Licence of the source. Blocking question for any open-source release.
    licence: str = "Flatland (base set)"
    #: Why this exists — a source, a paper, or control-room practice.
    grounding: str = ""
    #: Other places in the playground that run the same algorithm.
    used_in: tuple[str, ...] = ()


def _mk_deadlock(env: RailEnv) -> Policy:
    return DeadLockAvoidancePolicy()


def _mk_shortest(env: RailEnv) -> Policy:
    return ShortestPathPolicy(env)


def _mk_random(env: RailEnv) -> Policy:
    try:
        action_size = int(env.action_space[0])
    except Exception:
        action_size = 5
    return RandomPolicy(action_size=action_size)


def _mk_forward(env: RailEnv) -> Policy:
    return ForwardOnlyPolicy()


def _mk_do_nothing(env: RailEnv) -> Policy:
    return DoNothingPolicy()


def _mk_goal_directed(env: RailEnv) -> Policy:
    return GoalDirectedPolicy(env)


def _mk_plan(env: RailEnv) -> Policy:
    return PlanPolicy(env, trainruns_from_env(env))


# torch is a dev/lab dependency, not a runtime one: the production image
# installs requirements.txt only. So the learned policy is imported lazily and
# offered only where torch is installed — importing the registry at app startup
# must never touch torch (same rule as goal_directed_policy's dials).
_TORCH_AVAILABLE = importlib.util.find_spec("torch") is not None


def _mk_learned_ppo(env: RailEnv) -> Policy:
    from app.policies.learned.learned_ppo_policy import LearnedPpoPolicy
    return LearnedPpoPolicy(env)


def _mk_learned_ppo_branch() -> Policy:
    from app.policies.learned.learned_ppo_policy import LearnedPpoPolicy
    return LearnedPpoPolicy()


_REGISTRY: dict[str, PolicySpec] = {
    "deadlock_avoidance": PolicySpec(
        id="deadlock_avoidance",
        label="DLA (Default)",
        description="Avoids deadlocks proactively by checking opponent paths.",
        is_default=True,
        show_in_ui=True,
        supports_scenarios=True,
        runtime_factory=_mk_deadlock,
        branch_factory=DeadLockAvoidancePolicy,
        family="rule-based",
        deterministic=True,
        role="operational",
        observation="FullEnvObservation",
        at_conflict=(
            "Looks ahead along opponent shortest paths and holds a train back rather than letting it enter a section that would deadlock. The only base policy that reasons about other trains at all."
        ),
        provenance=(
            "flatland-baselines (deadlock_avoidance_heuristic), adapted to the local Policy base class."
        ),
        grounding=(
            "Flatland 3 Challenge baseline — the standard reference heuristic for deadlock-free operation."
        ),
    ),
    "shortest_path": PolicySpec(
        id="shortest_path",
        label="Shortest Path",
        description="Each agent picks the action that minimises distance to its target.",
        is_default=False,
        show_in_ui=True,
        supports_scenarios=True,
        runtime_factory=_mk_shortest,
        branch_factory=ShortestPathPolicy,
        family="rule-based",
        deterministic=True,
        role="baseline",
        observation="DummyObservationBuilder",
        at_conflict=(
            "Nothing. Each train minimises its own distance to target and ignores the others, so contention turns into a deadlock. That is what makes it the useful contrast to DLA."
        ),
        provenance=(
            "Flatland baseline heuristic; reads env.distance_map directly."
        ),
        grounding=(
            "The canonical single-agent-optimal, multi-agent-naive baseline."
        ),
    ),
    "random": PolicySpec(
        id="random",
        label="Random",
        description="Picks a random valid action per agent.",
        is_default=False,
        show_in_ui=True,
        supports_scenarios=True,
        runtime_factory=_mk_random,
        branch_factory=RandomPolicy,
        family="rule-based",
        deterministic=False,
        role="baseline",
        observation="DummyObservationBuilder",
        at_conflict=(
            "Nothing — actions are drawn uniformly from the valid set."
        ),
        provenance=(
            "Flatland baseline."
        ),
        grounding=(
            "Lower bound / control condition: any algorithm worth running must beat it."
        ),
    ),
    "forward_only": PolicySpec(
        id="forward_only",
        label="Forward Only",
        description="Always MOVE_FORWARD; ignores switches.",
        is_default=False,
        show_in_ui=True,
        supports_scenarios=False,
        runtime_factory=_mk_forward,
        branch_factory=ForwardOnlyPolicy,
        family="rule-based",
        deterministic=True,
        role="diagnostic",
        observation="DummyObservationBuilder",
        at_conflict=(
            "Nothing, and it ignores switches too — every train drives straight until the environment stops it."
        ),
        provenance=(
            "Flatland baseline."
        ),
        grounding=(
            "Diagnostic: isolates what the rail topology alone forces, with no routing decision involved."
        ),
    ),
    "do_nothing": PolicySpec(
        id="do_nothing",
        label="Do Nothing",
        description="All agents stay still (DO_NOTHING).",
        is_default=False,
        show_in_ui=False,
        supports_scenarios=False,
        runtime_factory=_mk_do_nothing,
        branch_factory=DoNothingPolicy,
        family="rule-based",
        deterministic=True,
        role="diagnostic",
        observation="DummyObservationBuilder",
        at_conflict=(
            "Nothing happens at all — every train holds."
        ),
        provenance=(
            "Flatland baseline."
        ),
        grounding=(
            "Diagnostic floor: the run where the AI contributes nothing, used to check the harness itself moves nothing."
        ),
    ),
    # Plans once per env (seconds, not per-step), so what-if branching —
    # which forks envs freely — stays off here. Director-mode rollouts
    # still follow the committed plan on forks via the model-free
    # `goal_directed_policy.director_replay_factory` (see overrides/hmi).
    "goal_directed": PolicySpec(
        id="goal_directed",
        label="Director Planner",
        description=(
            "Plans all trains with the weighted model-guided search "
            "(punctuality / connections / stability), then drives the plan."
        ),
        is_default=False,
        show_in_ui=True,
        supports_scenarios=False,
        runtime_factory=_mk_goal_directed,
        branch_factory=GoalDirectedPolicy,
        family="hybrid",
        deterministic=True,
        role="operational",
        observation="DummyObservationBuilder",
        at_conflict=(
            "Plans all trains up front against weighted goals (punctuality / connections / stability), then drives the plan. A malfunction of consequence — or a weight change mid-run — triggers a residual re-plan, spliced in only when it out-scores continuing the committed plan. A train it cannot route holds rather than guessing."
        ),
        provenance=(
            "Own implementation. Optional torch checkpoints (evaluator / connection model); without them it falls back to plan_avoiding_overlaps and records that in the plan info — degraded, never broken."
        ),
        licence="Own implementation",
        grounding=(
            "Director mode (WP 3.4): the human steers by goal weights, the planner re-plans against them."
        ),
    ),
    # The first learned policy (docs/plans/marl-lab-plan.md, step 1). Offered
    # everywhere so the human can work with it in all three modes; it is a
    # practice partner, not the default. Measured on the project scenarios it
    # does well on its own ECML topology and short PF-CH approaches, and
    # deadlocks like Shortest Path on the corridors and Olten — that gap is
    # what the lab's training steps are for.
    "learned_ppo": PolicySpec(
        id="learned_ppo",
        label="Learned PPO (ECML 2026)",
        description=(
            "A multi-agent RL policy: one network shared by all trains, trained with PPO "
            "for the ECML 2026 challenge. Greedy, so the same state gives the same actions."
        ),
        is_default=False,
        show_in_ui=_TORCH_AVAILABLE,
        supports_scenarios=True,
        runtime_factory=_mk_learned_ppo,
        branch_factory=_mk_learned_ppo_branch,
        family="learned",
        deterministic=True,
        role="baseline",
        observation="FastTreeObs (36 features + action mask, built by the policy itself)",
        at_conflict=(
            "Nothing explicit: it sees opposing and same-direction trains a few branches ahead "
            "and learned when to stop. Off the topology it was trained on, it deadlocks on "
            "single-track corridors."
        ),
        provenance=(
            "flatland-association/ecml2026-starterkit: pretrained checkpoint, observation "
            "builder and network, vendored in app/policies/learned/."
        ),
        licence="MIT (ECML 2026 starter kit)",
        grounding=(
            "ECML PKDD 2026 Real-World Baselines Challenge, RL track starter policy. "
            "The playground's first learned policy, for practising human-AI collaboration "
            "(docs/plans/marl-lab-plan.md)."
        ),
    ),
    # Only meaningful for a scenario that ships a plan file, so it is hidden
    # by default and enabled per session by `Session.__init__` when the env
    # carries one — otherwise the picker would offer "follow the plan" for
    # environments that have no plan to follow. What-if branching is out for
    # the same reason as the Director planner: a forked env has no plan.
    "plan": PolicySpec(
        id="plan",
        label="Scripted Plan",
        description=(
            "Drives every train along the scenario's premade plan; trains the "
            "plan does not cover, or that the operator overrode, fall back to "
            "deadlock avoidance."
        ),
        is_default=False,
        show_in_ui=False,
        supports_scenarios=False,
        runtime_factory=_mk_plan,
        branch_factory=PlanPolicy,
        family="rule-based",
        deterministic=True,
        role="operational",
        observation="DummyObservationBuilder",
        at_conflict=(
            "Does not resolve conflicts itself: it follows the trainruns it is given, "
            "step by step. A train the plan does not cover, or one the operator "
            "overrode, falls back to deadlock avoidance."
        ),
        provenance="Own implementation (app/policies/plan_policy.py).",
        licence="Own implementation",
        grounding=(
            "Executes premade plans of a scenario, and every course a planner produces: "
            "the plan is the decision, this only carries it out."
        ),
        used_in=(
            "Simulating and accepting PP proposals (/proposals)",
            "Rolling forward the contention strategies pp and priority",
        ),
    ),
}

# Policies that no session offers unless something about that session unlocks
# them. Keeps `show_in_ui` meaning "offer everywhere" rather than "offer never".
PLAN_POLICY_ID = "plan"


def policy_ids(*, include_hidden: bool = True) -> list[str]:
    if include_hidden:
        return list(_REGISTRY.keys())
    return [pid for pid, spec in _REGISTRY.items() if spec.show_in_ui]


def policy_specs(*, include_hidden: bool = True) -> list[PolicySpec]:
    if include_hidden:
        return list(_REGISTRY.values())
    return [spec for spec in _REGISTRY.values() if spec.show_in_ui]


def get_policy_spec(policy_id: str) -> PolicySpec | None:
    return _REGISTRY.get(policy_id)


def create_runtime_policy(policy_id: str, env: RailEnv) -> Policy:
    spec = get_policy_spec(policy_id)
    if spec is None:
        raise KeyError(policy_id)
    policy = spec.runtime_factory(env)
    policy.reset(env)
    return policy


def scenario_policy_factories() -> dict[str, PolicyBranchFactory]:
    return {
        spec.id: spec.branch_factory
        for spec in _REGISTRY.values()
        if spec.supports_scenarios
    }
