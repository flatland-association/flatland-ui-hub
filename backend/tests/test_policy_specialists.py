"""A specialist is described by its PolicySpec, not by a list next to it.

`PolicySpec.bundle` names the bundle a trained network is bound to. The
registry, the inference control, the proposal forecasts and the catalog all
read it, so a further specialist only needs its registry entry.
"""
from fastapi.testclient import TestClient

from app.api.overrides import _policy_factory_for
from app.core import pf_ch_control
from app.main import app
from app.policies import registry
from app.policies.learned import pf_ch_bundle, uc2_roam_bundle


def test_the_specs_name_the_specialists_bundles():
    assert registry.get_policy_spec("uc2_rl").bundle is uc2_roam_bundle
    assert registry.get_policy_spec("pf_ch_rl").bundle is pf_ch_bundle
    others = [spec.id for spec in registry.policy_specs() if spec.specialist]
    assert sorted(others) == ["pf_ch_rl", "uc2_rl"]


def test_specialist_check_reads_the_registry():
    assert registry.is_specialist_policy("uc2_rl")
    assert not registry.is_specialist_policy("goal_directed")
    assert not registry.is_specialist_policy("plan")
    assert not registry.is_specialist_policy("unknown")
    assert not registry.is_specialist_policy(None)
    # The inference control keeps its name for callers, but no list of its own
    # (an identity check would break on the bundle tests' registry reloads).
    assert pf_ch_control.is_specialist_policy.__module__ == "app.policies.registry"
    assert not hasattr(pf_ch_control, "_SPECIALIST_BUNDLES")


def test_a_specialist_forecast_follows_its_own_branch_factory():
    assert _policy_factory_for("uc2_rl") is registry.get_policy_spec("uc2_rl").branch_factory
    assert _policy_factory_for("pf_ch_rl") is registry.get_policy_spec("pf_ch_rl").branch_factory


def test_the_catalog_serves_the_specialist_flag():
    listed = {p["id"]: p for p in TestClient(app).get("/policies").json()}
    assert listed["uc2_rl"]["specialist"] is True
    assert listed["pf_ch_rl"]["specialist"] is True
    assert listed["deadlock_avoidance"]["specialist"] is False
    assert listed["goal_directed"]["specialist"] is False
