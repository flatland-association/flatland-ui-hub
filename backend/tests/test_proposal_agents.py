"""The proposal-agent seam: the "KI" column comes from whichever agent is active.

Plan: docs/plans/proposal-agents-roadmap.md (stage 2 → 3).
"""
import warnings

warnings.filterwarnings("ignore")

from app.api.overrides import ProposalApplyRequest, apply_proposal, get_proposals
from app.core.proposal_agents import registry
from app.core.proposal_agents.base import Proposal, ProposalAgent
from app.planners.replan import replan_from_state
from tests.test_replan_proposals import _forked_session


class _KeepPlanOrderAgent(ProposalAgent):
    """A stand-in for a later learning agent: one fixed order, PP underneath."""

    id = "stub"
    label = "Stub"

    def __init__(self):
        self.resolved = []

    def propose(self, env):
        order = tuple(sorted(a.handle for a in env.agents))
        trainruns = replan_from_state(env, priority=order)
        return [Proposal(priority=order, trainruns=trainruns)] if trainruns else []

    def resolve(self, env, priority):
        self.resolved.append(tuple(priority))
        return replan_from_state(env, priority=tuple(priority))


def _with_active(agent, monkeypatch):
    monkeypatch.setattr(registry, "_ACTIVE_ID", agent.id)
    monkeypatch.setitem(registry._REGISTRY, agent.id, agent)


def test_pp_replan_is_the_default_agent():
    agent = registry.active_proposal_agent()

    assert agent.id == "pp_replan"
    assert agent in registry.list_proposal_agents()


def test_pp_replan_proposals_are_distinct_orders():
    proposals = registry.active_proposal_agent().propose(_forked_session().env)

    assert proposals
    assert len({p.priority for p in proposals}) == len(proposals)
    assert all(p.trainruns for p in proposals)


def test_proposals_come_from_the_active_agent(monkeypatch):
    stub = _KeepPlanOrderAgent()
    _with_active(stub, monkeypatch)
    session = _forked_session()

    response = get_proposals(session.id, handle=1)

    assert response["ai_agent"] == {"id": "stub", "label": "Stub"}
    ai = response["variants"][1]
    assert ai["id"] == "ai" and ai["source"] == "stub"
    assert ai["priority"] == sorted(a.handle for a in session.env.agents)
    # One proposal, so nothing behind the toggle.
    assert response["ai_alternatives"] == []


def test_accepting_resolves_through_the_active_agent(monkeypatch):
    stub = _KeepPlanOrderAgent()
    _with_active(stub, monkeypatch)
    session = _forked_session()

    apply_proposal(session.id, ProposalApplyRequest(variant="ai", handle=1, priority=[0, 1, 2]))

    assert stub.resolved == [(0, 1, 2)]
