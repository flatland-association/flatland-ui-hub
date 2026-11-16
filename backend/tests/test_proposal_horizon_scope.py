"""The UC2 native horizon must not expand ordinary PP preview work."""
import pytest

from app.api import overrides
from app.core.proposal_agents.base import Proposal
from app.core.proposal_agents.registry import get_proposal_agent
from app.core.scenario_runner import BranchResult
from app.core.session_manager import session_manager

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("preset, requested_agent, native_horizon, expected_horizon", [
    ("olten-dense", None, 700, 250),
    ("olten-dense", "uc2_rl", 700, 250),  # incompatible adviser falls back to PP
    ("tutorial", "uc2_rl", 40, 40),      # no legacy 50-step floor for UC2
])
def test_proposals_use_effective_agent_horizon_for_every_branch(
    preset, requested_agent, native_horizon, expected_horizon, monkeypatch,
):
    session = session_manager.create(scenario_preset_id=preset)
    session.proposal_agent_id = requested_agent
    seen = []

    def branch(env, factory, committed, horizon, release_at=None):
        assert int(env._max_episode_steps) == native_horizon
        seen.append(horizon)
        return BranchResult(total_agents=len(env.agents), agent_outcomes={
            int(a.handle): dict(arrived=False, arrival_step=None, delay=0, deadlocked=False)
            for a in env.agents})

    # Keep the real session capture and compatible-agent resolution. Only
    # expensive simulation/search is replaced: this test measures the horizon
    # actually passed to baseline, AI and human forecast consumers.
    monkeypatch.setattr(overrides, "_branch_run", branch)
    for agent_id in ("pp_replan", "uc2_rl"):
        monkeypatch.setattr(get_proposal_agent(agent_id), "propose_for",
                            lambda *_: [Proposal(priority=(), trainruns={})])
    try:
        payload = overrides.get_proposals(session.id, handle=0, action=4)
        assert payload["horizon"] == expected_horizon
        assert seen == [expected_horizon] * 3
        assert payload["ai_agent"]["id"] == ("uc2_rl" if preset == "tutorial" else "pp_replan")
    finally:
        session_manager.delete(session.id)
