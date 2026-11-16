"""The operator's decisions count per train in the uc2_rl adviser.

Plan: docs/plans/uc2-rl-keep-human-decisions.md. A KI course for the selected
train keeps every other train's standing override (and ROAM certifies the step
with it); accepting clears only the selected train's own. PP is unchanged.
"""
import warnings

warnings.filterwarnings("ignore")

import pytest
from flatland.envs.step_utils.states import TrainState

from app.api.overrides import ProposalApplyRequest, apply_proposal, get_proposals
from app.core.env_factory import create_env
from app.core.override_manager import override_manager
from app.core.proposal_agents import registry as proposal_registry
from app.core.proposal_agents.uc2_rl import UC2RLProposalAgent
from app.core.scenario_runner import TrajectoryBranchRunner
from app.core.session_manager import session_manager
from app.policies import registry
from app.policies.plan_policy import trainruns_from_env
from app.utils.agent_compat import agent_position

STOP = 4
TRAIN_0_HOME = (2, 20)  # last cell recorded before train 0 leaves the map at its target


def _drive_dla(env, steps, per_step_hooks=True):
    dla = registry.create_runtime_policy("deadlock_avoidance", env)
    for _ in range(steps):
        handles = env.get_agent_handles()
        if per_step_hooks:
            dla.start_step()
        actions = dla.act_many(handles, {h: env for h in handles})
        if per_step_hooks:
            dla.end_step()
        env.step(actions)


def _reaches(proposal, handle, cell):
    return any(w.waypoint.position == cell for w in proposal.trainruns.get(handle, []))


def _uc2_session():
    session = session_manager.create(scenario_preset_id="tutorial")
    session.proposal_agent_id = "uc2_rl"
    return session


@pytest.mark.integration
def test_the_fork_sees_standing_trains():
    """Flatland's persister empties `agent_positions` (flatland-rl #576); the
    what-if fork rebuilds it, or a driver reading it misses every train that
    stands still (here: two, head-on, after DLA without its per-step hooks)."""
    live = create_env(scenario_preset_id="tutorial")
    _drive_dla(live, 15, per_step_hooks=False)
    assert all(a.speed_counter.speed == 0 for a in live.agents)

    fork = TrajectoryBranchRunner(live, registry._branch_uc2_rl)._fork_env()

    assert (fork.agent_positions == live.agent_positions).all()
    assert (live.agent_positions >= 0).sum() == len(live.agents)


@pytest.mark.integration
def test_the_courses_keep_another_trains_stop():
    env = create_env(scenario_preset_id="tutorial")
    agent = UC2RLProposalAgent()

    free = agent.propose_for(env, 1)
    stopped = agent.propose_for(env, 1, {0: STOP})

    assert _reaches(free[0], 0, TRAIN_0_HOME), "without the stop the model brings train 0 home"
    assert stopped and not any(_reaches(p, 0, TRAIN_0_HOME) for p in stopped)


@pytest.mark.integration
def test_asked_about_the_stopped_train_the_ki_suggests_moving_it_again():
    """The selected train's own stop is the question the courses answer."""
    env = create_env(scenario_preset_id="tutorial")
    agent = UC2RLProposalAgent()

    for_train_0 = agent.propose_for(env, 0, {0: STOP})

    assert [p.trainruns for p in for_train_0] == [p.trainruns for p in agent.propose_for(env, 0)]
    assert _reaches(for_train_0[0], 0, TRAIN_0_HOME)


@pytest.mark.integration
def test_accepting_for_one_train_keeps_the_other_trains_stop():
    session = _uc2_session()
    try:
        override_manager.set(session.id, 0, STOP)
        override_manager.set(session.id, 1, STOP)

        apply_proposal(session.id, ProposalApplyRequest(variant="ai", handle=1))

        assert override_manager.get_all(session.id) == {0: STOP}, "only train 1's own stop gives way"
        plan = trainruns_from_env(session.env)
        assert 1 in plan and 0 not in plan, "the stopped train stays under its stop, outside the plan"

        apply_proposal(session.id, ProposalApplyRequest(variant="ai", handle=0))

        assert override_manager.get_all(session.id) == {}
        assert 0 in trainruns_from_env(session.env)
    finally:
        session_manager.delete(session.id)


@pytest.mark.integration
def test_the_shown_courses_are_scored_with_the_other_trains_stop():
    session = _uc2_session()
    try:
        override_manager.set(session.id, 0, STOP)

        response = get_proposals(session.id, handle=1)

        assert response["ai_keeps_overrides"] is True
        for course in [response["variants"][1], *response["ai_alternatives"]]:
            assert course["metrics"]["not_arrived"] >= 1, "train 0 stays stopped, as it will after accepting"
    finally:
        session_manager.delete(session.id)


def test_pp_still_answers_for_every_train():
    """PP's replans ignore standing overrides, so accepting one still clears them all."""
    from tests.test_replan_proposals import _forked_session

    session = _forked_session()
    try:
        agent = proposal_registry.proposal_agent_for(session)
        assert not agent.respects_overrides
        override_manager.set(session.id, 0, STOP)

        assert get_proposals(session.id, handle=1)["ai_keeps_overrides"] is False
        apply_proposal(session.id, ProposalApplyRequest(variant="ai", handle=1, priority=[0, 1, 2]))

        assert override_manager.get_all(session.id) == {}
    finally:
        session_manager.delete(session.id)


@pytest.mark.integration
def test_round_a_train_the_dispatcher_stopped():
    """Tutorial, through the API as the Plan B UI drives it: the dispatcher stops
    train 0 on the main line; it halts at (2,13), just before the loop's east
    switch, while train 1 waits at B. Joint ROAM must certify the step with the
    stop: certifying train 0's proposed move instead, it saw a head-on meeting
    and held train 1 at B for good. With it, the best KI course sends train 1
    through the loop; taken while the client keeps pinning DLA, train 1 arrives
    and train 0 stays stopped."""
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as client:
        sid = client.post("/session", json={"scenario_preset_id": "tutorial", "proposal_agent": "uc2_rl",
                                             "enabled_policy_ids": ["deadlock_avoidance"]}).json()["id"]
        try:
            env = session_manager.get(sid).env
            step = {"policy": "deadlock_avoidance", "n_steps": 1}
            while agent_position(env.agents[0]) != (2, 11):
                client.post(f"/session/{sid}/step", json=step)
            client.post(f"/session/{sid}/agent/0/override", json={"action": STOP})
            client.post(f"/session/{sid}/step", json={**step, "n_steps": 4})
            assert agent_position(env.agents[0]) == (2, 13) and agent_position(env.agents[1]) is None

            response = client.get(f"/session/{sid}/proposals", params={"handle": 1}).json()

            best = response["variants"][1]
            assert best["train"]["arrived"], "train 1 gets round the stopped train 0"
            assert any(p["row"] == 1 and p["col"] == 14 for p in best["trajectories"]["1"]), "through the loop"
            assert max(p["col"] for p in best["trajectories"]["0"]) == 13, "train 0 stays stopped"

            taken = client.post(f"/session/{sid}/proposals/apply", json={
                "variant": "ai", "handle": 1, "candidate_id": best["candidate_id"],
                "preview_token": best["preview_token"], "source_step": response["source_step"]})
            assert taken.status_code == 200
            assert override_manager.get_all(sid) == {0: STOP}

            while env.agents[1].state != TrainState.DONE and env._elapsed_steps < env._max_episode_steps:
                client.post(f"/session/{sid}/step", json=step)
            assert env.agents[1].state == TrainState.DONE
            assert agent_position(env.agents[0]) == (2, 13)
        finally:
            client.delete(f"/session/{sid}")
