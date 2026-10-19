"""The Algorithm Gallery's catalog covers every seam (docs/plans/algorithm-catalog-all-seams.md)."""
from fastapi.testclient import TestClient

from app.core.algorithm_catalog import FAMILIES, LAYERS, ROLES, algorithm_catalog
from app.core.proposal_agents.registry import list_proposal_agents
from app.core.recommenders.registry import list_recommenders
from app.main import app
from app.policies.registry import policy_ids


def test_every_registered_algorithm_appears_once():
    keys = [(e.layer, e.id) for e in algorithm_catalog()]
    assert len(keys) == len(set(keys))
    expected = (
        {("policy", pid) for pid in policy_ids(include_hidden=True)}
        | {("proposal-agent", a.id) for a in list_proposal_agents()}
        | {("recommender", r.id) for r in list_recommenders()}
    )
    assert set(keys) == expected


def test_entries_are_described():
    for e in algorithm_catalog():
        assert e.layer in LAYERS, e
        assert e.family in FAMILIES, e
        assert e.role in ROLES, e
        assert e.at_conflict and e.provenance and e.licence, f"{e.layer}/{e.id} lacks catalog text"


def test_pp_is_listed_as_search_based_proposal_agent():
    pp = next(e for e in algorithm_catalog() if e.id == "pp_replan")
    assert pp.layer == "proposal-agent"
    assert pp.family == "search-based"
    assert "MIT" in pp.licence


def test_policies_endpoint_still_lists_only_policies():
    client = TestClient(app)
    ids = {p["id"] for p in client.get("/policies").json()}
    assert ids == set(policy_ids(include_hidden=True))
    catalog = client.get("/policies/catalog").json()
    assert {(c["layer"], c["id"]) for c in catalog} >= {("proposal-agent", "pp_replan"), ("recommender", "proximity")}
    assert sum(1 for c in catalog if c["layer"] == "policy" and c["is_default"]) == 1
