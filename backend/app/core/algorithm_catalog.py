"""One catalog over every algorithm seam (docs/plans/algorithm-catalog-all-seams.md).

Collects the policy registry, the proposal-agent registry and the recommender
registry into one list for the Algorithm Gallery. Nothing is listed by hand:
an algorithm registered at any seam shows up here with the metadata that sits
next to its code.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

from app.core.proposal_agents.registry import active_proposal_agent, list_proposal_agents
from app.core.recommenders.registry import active_recommender, list_recommenders
from app.policies.registry import policy_specs

#: Where in the playground an algorithm plugs in.
LAYERS = ("policy", "proposal-agent", "recommender")
FAMILIES = ("rule-based", "search-based", "learned", "hybrid")
ROLES = ("operational", "baseline", "diagnostic")


@dataclass(frozen=True)
class CatalogEntry:
    layer: str
    id: str
    label: str
    description: str
    is_default: bool
    show_in_ui: bool
    supports_scenarios: bool
    family: str
    deterministic: bool
    role: str
    observation: str
    at_conflict: str
    provenance: str
    licence: str
    grounding: str
    used_in: Tuple[str, ...]


def _from_seam(layer: str, algo, is_default: bool) -> CatalogEntry:
    return CatalogEntry(
        layer=layer,
        id=algo.id,
        label=algo.label,
        description=algo.description,
        is_default=is_default,
        show_in_ui=True,
        supports_scenarios=False,
        family=algo.family,
        deterministic=algo.deterministic,
        role=algo.role,
        observation=algo.observation,
        at_conflict=algo.at_conflict,
        provenance=algo.provenance,
        licence=algo.licence,
        grounding=algo.grounding,
        used_in=tuple(algo.used_in),
    )


def algorithm_catalog() -> List[CatalogEntry]:
    """Every registered algorithm, policies first, then proposal agents, then recommenders."""
    out: List[CatalogEntry] = []
    specs = policy_specs(include_hidden=True)
    default_id = next((s.id for s in specs if s.is_default), specs[0].id if specs else None)
    for s in specs:
        out.append(CatalogEntry(
            layer="policy",
            id=s.id,
            label=s.label,
            description=s.description,
            is_default=(s.id == default_id),
            show_in_ui=s.show_in_ui,
            supports_scenarios=s.supports_scenarios,
            family=s.family,
            deterministic=s.deterministic,
            role=s.role,
            observation=s.observation,
            at_conflict=s.at_conflict,
            provenance=s.provenance,
            licence=s.licence,
            grounding=s.grounding,
            used_in=tuple(s.used_in),
        ))
    active_agent = active_proposal_agent().id
    for a in list_proposal_agents():
        out.append(_from_seam("proposal-agent", a, a.id == active_agent))
    active_rec = active_recommender().id
    for r in list_recommenders():
        out.append(_from_seam("recommender", r, r.id == active_rec))
    return out
