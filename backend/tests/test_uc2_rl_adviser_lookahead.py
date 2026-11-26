"""Native future courses, whole-batch certification and isolated bounded search."""
import copy
import json
import weakref
from collections import Counter

import pytest
from flatland.core.env_observation_builder import DummyObservationBuilder

from app.core.env_factory import create_env
from app.core.native_env_cache import clear_native_environment_caches
from app.core.proposal_agents.base import Proposal, ProposalAgent
from app.core.proposal_agents.uc2_rl import (
    MAX_CANDIDATES, UC2RLProposalAgent, _course_key, _Intervention, _rollout,
    rollout_trainruns,
)
from app.policies.base import Policy
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
from app.policies.learned.roam_check import RoamCheck, open_waypoint_groups
from app.policies.plan_policy import PlanPolicy
from app.policies.registry import create_runtime_policy


def _state(env):
    return (int(env._elapsed_steps), copy.deepcopy(env.dones), tuple(
        (a.current_configuration, a.state.name, a.arrival_time,
         a.speed_counter.speed, a.speed_counter.distance,
         a.malfunction_handler.malfunction_down_counter,
         copy.deepcopy(a.waypoints)) for a in env.agents))


def _takeover(preset="uc2-1", steps=4):
    env = create_env(scenario_preset_id=preset)
    driver = create_runtime_policy("deadlock_avoidance", env)
    driver.reset(env)
    for _ in range(steps):
        driver.start_step()
        actions = driver.act_many(env.get_agent_handles(), {})
        driver.end_step()
        env.step(actions)
    return env


@pytest.fixture
def takeover():
    env = _takeover()
    yield env
    clear_native_environment_caches()


class _NoFallback(Policy):
    def build_observation_builder(self):
        return DummyObservationBuilder()

    def reset(self, env):
        pass

    def act_many(self, handles, observations, **kwargs):
        raise AssertionError(f"Course left its executable plan: {handles}")

    def act_for_handle(self, handle, observation=None, eps=0.0):
        raise AssertionError("Course requested a fallback")


def _replay(env, course):
    fork = copy.deepcopy(env)
    player = PlanPolicy(trainruns=course, fallback=_NoFallback())
    player.reset(fork)
    while not fork.dones.get("__all__") and fork._elapsed_steps < fork._max_episode_steps:
        actions = player.act_many(fork.get_agent_handles(), {})
        fork.step(actions)
    return fork


def test_legacy_agents_delegate_handle_aware_seam_without_changing_priority():
    class Legacy(ProposalAgent):
        def propose(self, env):
            return [Proposal(priority=(2, 0), trainruns={})]

        def resolve(self, env, priority):
            assert priority == (2, 0)
            return {2: []}

    legacy = Legacy()
    proposal = legacy.propose_for(None, 9)[0]
    assert proposal.candidate_id is None and proposal.intervention is None
    assert legacy.resolve_for(None, proposal.priority, 9, "ignored") == {2: []}


@pytest.mark.integration
def test_future_branches_and_waits_are_distinct_deterministic_and_read_only(takeover):
    env = takeover
    before = _state(env)
    builder = env.obs_builder
    adviser = UC2RLProposalAgent()
    proposals = adviser.propose_for(env, 0)
    assert 2 < len(proposals) <= MAX_CANDIDATES
    assert proposals[0].intervention["kind"] == "rl"
    branches = [p for p in proposals if p.intervention["kind"] == "branch"]
    waits = [p for p in proposals if p.intervention["kind"] == "wait"]
    assert branches and waits
    assert all(p.intervention["step"] > env._elapsed_steps for p in branches)
    assert {p.intervention["wait_steps"] for p in waits} == {1, 3, 5}
    assert len({_course_key(p.trainruns) for p in proposals}) == len(proposals)
    assert len({p.candidate_id for p in proposals}) == len(proposals)
    assert all(p.priority == () and p.intervention["handle"] == 0 for p in proposals)
    for proposal in proposals:
        json.dumps(proposal.intervention, allow_nan=False)
        assert all(w.scheduled_at <= env._max_episode_steps
                   for run in proposal.trainruns.values() for w in run)
    repeated = adviser.propose_for(env, 0)
    assert [(p.candidate_id, _course_key(p.trainruns)) for p in proposals] == [
        (p.candidate_id, _course_key(p.trainruns)) for p in repeated]
    assert _state(env) == before and env.obs_builder is builder
    assert _course_key(rollout_trainruns(env)) == _course_key(proposals[0].trainruns)


@pytest.mark.integration
def test_future_branch_and_wait_courses_replay_through_the_acceptance_policy(takeover):
    proposals = UC2RLProposalAgent().propose_for(takeover, 0)
    for kind in ("branch", "wait"):
        proposal = next(p for p in proposals if p.intervention["kind"] == kind)
        replay = _replay(takeover, proposal.trainruns)
        assert all(a.state.name == "DONE" for a in replay.agents)
        assert replay._elapsed_steps <= takeover._max_episode_steps
        if kind == "branch":
            greedy_cells = [w.waypoint for w in proposals[0].trainruns[0]]
            assert [w.waypoint for w in proposal.trainruns[0]] != greedy_cells


@pytest.mark.integration
def test_forced_future_action_is_inside_joint_certification_and_withdrawal_rejects_it(takeover, monkeypatch):
    candidate = next(p for p in UC2RLProposalAgent().propose_for(takeover, 0)
                     if p.intervention["kind"] == "branch")
    intervention = _Intervention(**candidate.intervention)
    finalize = UC2RoamPolicy.finalize_actions
    batches = []

    def reject(self, proposals):
        assert set(proposals) == set(self.roam_check.env.get_agent_handles())
        now = int(self.roam_check.env._elapsed_steps)
        batches.append((now, dict(proposals)))
        result = finalize(self, proposals)
        if now == intervention.step:
            assert int(proposals[intervention.handle]) == intervention.action
            result[intervention.handle] = 4
        return result

    monkeypatch.setattr(UC2RoamPolicy, "finalize_actions", reject)
    runs, _ = _rollout(takeover, intervention=intervention)
    assert runs == {} and batches[-1][0] == intervention.step


@pytest.mark.integration
@pytest.mark.parametrize("preset", ["uc2-1", "uc2-3"])
def test_native_steps_of_all_future_courses_keep_uncached_resource_and_mission_certificates(preset, monkeypatch):
    env = _takeover(preset)
    from flatland.envs.rail_env import RailEnv
    native_step = RailEnv.step
    finalize = UC2RoamPolicy.finalize_actions
    pending, checked = {}, []

    def certify(self, proposals):
        fork = self.roam_check.env
        reference = RoamCheck(fork, partial_moves=True, max_candidates=60,
                              use_reachability_cache=False)
        _, before = reference.snapshot(self._pending_groups)
        actions = finalize(self, proposals)
        pending[id(fork)] = (reference, self.obs_builder, set(before))
        return actions

    def actual_step(fork, actions, *args, **kwargs):
        result = native_step(fork, actions, *args, **kwargs)
        if id(fork) in pending:
            reference, builder, before = pending.pop(id(fork))
            trains, after = reference.snapshot(open_waypoint_groups(builder.base))
            assert after <= before
            resources = Counter(reference.tables.resources[t.node] for t in trains.values())
            assert all(count == 1 for count in resources.values())
            checked.append(int(fork._elapsed_steps))
        return result

    monkeypatch.setattr(UC2RoamPolicy, "finalize_actions", certify)
    monkeypatch.setattr(RailEnv, "step", actual_step)
    try:
        proposals = UC2RLProposalAgent().propose_for(env, 0)
        assert any(p.intervention["kind"] == "branch" for p in proposals)
        assert any(p.intervention["kind"] == "wait" for p in proposals)
        assert checked and not pending
    finally:
        clear_native_environment_caches()


@pytest.mark.integration
@pytest.mark.parametrize("preset", ["tutorial", "uc2-1", "uc2-2", "uc2-3", "uc2-4"])
def test_native_takeover_search_never_calls_pp_or_dla_and_uses_selected_handle(preset, monkeypatch):
    env = _takeover(preset)
    before = _state(env)
    from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy

    def forbidden(*args, **kwargs):
        raise AssertionError("RL adviser called a planner/fallback")

    monkeypatch.setattr(PlanPolicy, "reset", forbidden)
    monkeypatch.setattr(DeadLockAvoidancePolicy, "reset", forbidden)
    try:
        proposals = UC2RLProposalAgent().propose_for(env, 1)
        assert proposals and len(proposals) <= MAX_CANDIDATES
        assert all(p.intervention["handle"] == 1 for p in proposals)
        assert all(p.intervention["handle"] != 0 for p in proposals[1:])
        assert _state(env) == before
        assert UC2RLProposalAgent().propose_for(env, 99) == []
        if preset == "uc2-3":
            assert any(float(a.speed_counter.max_speed) == .6 for a in env.agents)
    finally:
        clear_native_environment_caches()


@pytest.mark.integration
def test_candidate_budget_and_failed_rollout_cleanup(takeover, monkeypatch):
    import app.core.proposal_agents.uc2_rl as module
    native_copy = module._fork_env
    references, cleanup = [], []

    def capture(env):
        fork = native_copy(env)
        references.append(weakref.ref(fork))
        return fork

    monkeypatch.setattr(module, "_fork_env", capture)
    native_clear = module.clear_native_environment_caches

    def clear():
        cleanup.append(True)
        native_clear()

    monkeypatch.setattr(module, "clear_native_environment_caches", clear)
    proposals = UC2RLProposalAgent().propose_for(takeover, 0)
    assert proposals and len(references) <= MAX_CANDIDATES
    assert len(cleanup) == len(references)

    def fail(*args):
        raise RuntimeError("inference failure")

    monkeypatch.setattr(UC2RoamPolicy, "infer_prepared", fail)
    with pytest.raises(RuntimeError, match="inference failure"):
        UC2RLProposalAgent().propose_for(takeover, 0)
    assert len(cleanup) == len(references)
    import gc
    gc.collect()
    assert all(ref() is None for ref in references)


@pytest.mark.integration
def test_unknown_candidate_does_not_resolve_to_greedy(takeover):
    assert UC2RLProposalAgent().resolve_for(takeover, (), 0, "not-a-course") is None
