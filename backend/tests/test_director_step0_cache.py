"""Step-0 Director plans are computed once and reused (step0_cache.py): the
second session of the same scenario gets the same first plan and the same
three options without planning anything."""
import warnings

import pytest
from fastapi.testclient import TestClient

warnings.filterwarnings("ignore")

from app.api import sessions as sessions_api  # noqa: E402
from app.core.session_manager import session_manager  # noqa: E402
from app.main import app  # noqa: E402
from app.policies import goal_directed_policy as gdp  # noqa: E402
from app.policies.goal_based_policies import search, step0_cache  # noqa: E402

PRESET = "pf-ch-wn-wal-long-approach"


@pytest.fixture(autouse=True)
def _tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(step0_cache, "CACHE_DIR", tmp_path)
    monkeypatch.setenv("DIRECTOR_STEP0_CACHE", "1")
    monkeypatch.setenv("DIRECTOR_STEP0_WRITE", "1")
    sessions_api._STRATEGY_CACHE.clear()
    if gdp.loaded_models() is None:
        pytest.skip("no Director checkpoints installed")


def _plan_and_strategies(client):
    sid = session_manager.create(scenario_preset_id=PRESET).id
    session_manager.get(sid).policy = "goal_directed"
    w = client.post(f"/session/{sid}/director/weights",
                    json={"punctuality": 1, "connections": 1, "stability": 1, "plan": True}).json()
    s = client.get(f"/session/{sid}/director/strategies").json()
    return sid, w, s


def test_the_second_run_of_a_scenario_plans_nothing_and_gets_the_same_answer(monkeypatch):
    client = TestClient(app)
    _, w1, s1 = _plan_and_strategies(client)
    assert s1["available"] and not s1.get("precomputed")
    assert list(step0_cache.CACHE_DIR.glob("*.plan.pkl"))
    assert list(step0_cache.CACHE_DIR.glob("*.strategies.json"))

    def refuse(*args, **kwargs):
        raise AssertionError("planned although step 0 was cached")

    monkeypatch.setattr(search, "director_plan", refuse)
    sessions_api._STRATEGY_CACHE.clear()
    sid2, w2, s2 = _plan_and_strategies(client)
    assert s2["precomputed"] and s2["session_id"] == sid2
    assert w2["plan"]["source"] == w1["plan"]["source"]
    assert w2["plan"]["weighted"] == w1["plan"]["weighted"]
    assert w2["paths"] == w1["paths"]
    strip = lambda s: [{k: v for k, v in x.items()} for x in s["strategies"]]  # noqa: E731
    assert strip(s2) == strip(s1)


def test_the_key_changes_with_the_weights_and_with_a_live_seed():
    env = session_manager.create(scenario_preset_id=PRESET).env
    base = step0_cache.fingerprint(env, (1, 1, 1), "first-plan")
    assert base == step0_cache.fingerprint(env, (1, 1, 1), "first-plan")
    assert base != step0_cache.fingerprint(env, (2, 1, 1), "first-plan")
    assert base != step0_cache.fingerprint(env, (1, 1, 1), "strategies")
    env._live_seed = 7
    assert base != step0_cache.fingerprint(env, (1, 1, 1), "first-plan")


def test_the_server_reads_but_does_not_write(monkeypatch):
    monkeypatch.setenv("DIRECTOR_STEP0_WRITE", "0")
    step0_cache.save_strategies("k", {"strategies": []})
    assert step0_cache.load_strategies("k") is None


def test_off_switch(monkeypatch):
    monkeypatch.setenv("DIRECTOR_STEP0_CACHE", "0")
    step0_cache.save_strategies("k", {"strategies": []})
    assert step0_cache.load_strategies("k") is None
