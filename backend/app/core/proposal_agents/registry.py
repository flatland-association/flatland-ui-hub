"""Registry of proposal agents (the "KI" column of Plan / KI / Mensch).

Add a new agent by registering it here; the active one is resolved by id. This
mirrors the recommender registry so a learning agent plugs in without touching
the API or frontend.
"""
from __future__ import annotations

from typing import Dict, List

from app.core.proposal_agents.base import ProposalAgent
from app.core.proposal_agents.pp_replan import PPReplanAgent

_REGISTRY: Dict[str, ProposalAgent] = {}


def register(agent: ProposalAgent) -> None:
    _REGISTRY[agent.id] = agent


# Built-in agents.
register(PPReplanAgent())

# Default active agent id (later: selectable per session / in settings).
_ACTIVE_ID = "pp_replan"


def list_proposal_agents() -> List[ProposalAgent]:
    return list(_REGISTRY.values())


def get_proposal_agent(agent_id: str) -> ProposalAgent | None:
    return _REGISTRY.get(agent_id)


def active_proposal_agent() -> ProposalAgent:
    return _REGISTRY.get(_ACTIVE_ID) or next(iter(_REGISTRY.values()))
