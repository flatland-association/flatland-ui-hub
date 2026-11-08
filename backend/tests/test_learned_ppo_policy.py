"""The ECML 2026 PPO policy (docs/plans/marl-lab-plan.md, step 1)."""
import numpy as np
import pytest
import torch

from flatland.envs.step_utils.states import TrainState

from app.core.env_factory import create_env
from app.policies.learned.learned_ppo_policy import LearnedPpoPolicy
from app.policies.learned.learned_ppo_policy import (
    ActorCritic,
    DEFAULT_CHECKPOINT,
    count_uncertainty_percent,
    experience_state_key,
    load_actor_critic_checkpoint,
)
from app.policies.registry import get_policy_spec


def _run(env, policy, steps):
    handles = env.get_agent_handles()
    trace = []
    for _ in range(steps):
        actions = policy.act_many(handles, {})
        trace.append(actions)
        env.step(actions)
    return trace


def test_registered_as_learned_and_offered():
    spec = get_policy_spec("learned_ppo")
    assert spec is not None
    assert spec.family == "learned"
    assert spec.show_in_ui and not spec.is_default  # torch is installed for tests
    assert "MIT" in spec.licence


def test_acts_only_with_allowed_actions_and_reports_probabilities():
    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    policy = get_policy_spec("learned_ppo").runtime_factory(env)
    handles = env.get_agent_handles()
    actions = policy.act_many(handles, {})
    assert set(actions) == set(handles)
    for h, a in actions.items():
        probs = policy.last_action_probs[h]
        assert len(probs) == 5
        assert abs(sum(probs) - 1.0) < 1e-5
        # The greedy action is the most probable one, so never a masked action.
        assert probs[a] == max(probs) > 0


def test_deterministic_for_the_same_env():
    env_a, env_b = create_env(seed=7), create_env(seed=7)
    trace_a = _run(env_a, LearnedPpoPolicy(env_a), 25)
    trace_b = _run(env_b, LearnedPpoPolicy(env_b), 25)
    assert trace_a == trace_b


def test_brings_all_trains_home_on_its_own_topology():
    env = create_env(scenario_preset_id="ecml2026-scene1-level0")
    policy = LearnedPpoPolicy(env)
    handles = env.get_agent_handles()
    for _ in range(int(env._max_episode_steps)):
        _, _, dones, _ = env.step(policy.act_many(handles, {}))
        if dones["__all__"]:
            break
    assert all(env.agents[h].state == TrainState.DONE for h in handles)


def test_branch_factory_works_after_reset():
    # Forks build the policy without an env and reset it on the forked env.
    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    policy = get_policy_spec("learned_ppo").branch_factory()
    policy.reset(env)
    assert set(policy.act_many(env.get_agent_handles(), {})) == set(env.get_agent_handles())


def test_experience_head_and_quantized_state_action_key():
    model = ActorCritic()
    logits, values, log_counts = model.forward_with_experience(torch.zeros((2, 36)))
    assert logits.shape == (2, 5)
    assert values.shape == (2,)
    assert log_counts.shape == (2, 3, 5)

    mask = np.array([1, 0, 1, 0, 1], dtype=np.float32)
    first = experience_state_key(np.zeros(36, dtype=np.float32), mask)
    nearby = experience_state_key(np.full(36, 0.001, dtype=np.float32), mask)
    different_mask = experience_state_key(np.zeros(36, dtype=np.float32), np.ones(5, dtype=np.float32))
    assert first == nearby
    assert first != different_mask


def test_count_uncertainty_marks_sparse_counts_and_ensemble_disagreement():
    assert count_uncertainty_percent(0, 0) == 100
    assert count_uncertainty_percent(9, 0) == pytest.approx(100 / np.sqrt(10))
    assert count_uncertainty_percent(99, 0) == pytest.approx(10)
    assert count_uncertainty_percent(9, 20) == 100


def test_legacy_checkpoint_loads_without_a_ready_experience_estimator():
    checkpoint = torch.load(DEFAULT_CHECKPOINT, weights_only=False, map_location="cpu")
    model = load_actor_critic_checkpoint(ActorCritic(), checkpoint)
    assert model.experience_estimator_ready is False
    assert model.experience_counts == {}


def test_not_added_to_every_sessions_what_if_scenarios():
    # scenario_policy_factories() drives /hmi/scenarios and the recommendations
    # of every session; the learned policy must not join them by default.
    from app.policies.registry import scenario_policy_factories

    assert "learned_ppo" not in scenario_policy_factories()
