"""Registry of proposal agents (the "KI" column of Plan / KI / Mensch).

Add a new agent by registering it here; the active one is resolved by id. This
mirrors the recommender registry so a learning agent plugs in without touching
the API or frontend.
"""
from __future__ import annotations

from typing import Dict, List

from app.core.proposal_agents.base import ProposalAgent
from app.core.proposal_agents.pp_replan import PPReplanAgent
from app.core.proposal_agents.uc2_rl import UC2RLProposalAgent

_REGISTRY: Dict[str, ProposalAgent] = {}


def register(agent: ProposalAgent) -> None:
    _REGISTRY[agent.id] = agent


# Built-in agents.
register(PPReplanAgent())
register(UC2RLProposalAgent())

# Default active agent id (later: selectable per session / in settings).
_ACTIVE_ID = "pp_replan"


def list_proposal_agents() -> List[ProposalAgent]:
    return list(_REGISTRY.values())


def get_proposal_agent(agent_id: str) -> ProposalAgent | None:
    return _REGISTRY.get(agent_id)


def active_proposal_agent() -> ProposalAgent:
    return _REGISTRY.get(_ACTIVE_ID) or next(iter(_REGISTRY.values()))


def proposal_agent_for(session) -> ProposalAgent:
    """The agent behind this session's KI column.

    The session's own agent (`proposal_agent_id`, set at creation, e.g. by a study
    condition) when it can propose for the session's env; otherwise the default.
    A study leg on another infrastructure therefore falls back to PP, and the
    `/proposals` response names whichever agent was used.
    """
    agent = _REGISTRY.get(getattr(session, "proposal_agent_id", None) or "")
    if agent is not None and agent.available(session.env):
        return agent
    return active_proposal_agent()
