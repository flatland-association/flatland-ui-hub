"""GET /policies — list all available policies for the UI selector.

GET /policies/catalog — every algorithm at every seam, for the Algorithm Gallery.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.core.algorithm_catalog import algorithm_catalog
from app.policies.registry import policy_specs

router = APIRouter()


class PolicyInfo(BaseModel):
    id: str
    label: str
    description: str
    is_default: bool = False
    show_in_ui: bool = False
    supports_scenarios: bool = False
    # Catalog metadata for the Algorithm Gallery. Served from the registry so
    # there is no second copy to drift; see PolicySpec for what each means.
    family: str = "rule-based"
    deterministic: bool = True
    role: str = "operational"
    observation: str = "DummyObservationBuilder"
    at_conflict: str = ""
    provenance: str = ""
    licence: str = "Flatland (base set)"
    grounding: str = ""


@router.get("/policies", response_model=list[PolicyInfo])
def list_policies() -> list[PolicyInfo]:
    specs = policy_specs(include_hidden=True)
    if not specs:
        return []

    default_id = next((spec.id for spec in specs if spec.is_default), specs[0].id)

    return [
        PolicyInfo(
            id=spec.id,
            label=spec.label,
            description=spec.description,
            is_default=(spec.id == default_id),
            show_in_ui=spec.show_in_ui,
            supports_scenarios=spec.supports_scenarios,
            family=spec.family,
            deterministic=spec.deterministic,
            role=spec.role,
            observation=spec.observation,
            at_conflict=spec.at_conflict,
            provenance=spec.provenance,
            licence=spec.licence,
            grounding=spec.grounding,
        )
        for spec in specs
    ]


class AlgorithmInfo(PolicyInfo):
    """A catalog entry: a `PolicyInfo` plus the seam it plugs into.

    Kept apart from `/policies` on purpose: the policy picker reads that list
    and must never offer a proposal agent or a recommender as a policy.
    """
    #: policy | proposal-agent | recommender
    layer: str = "policy"
    used_in: list[str] = []


@router.get("/policies/catalog", response_model=list[AlgorithmInfo])
def list_algorithm_catalog() -> list[AlgorithmInfo]:
    return [
        AlgorithmInfo(**{**entry.__dict__, "used_in": list(entry.used_in)})
        for entry in algorithm_catalog()
    ]
