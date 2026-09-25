"""Contention strategies: keep / switch policy / PP re-plan, simulated and scored
(app/core/contention_strategies.py, /hmi/contention-strategies)."""
import warnings

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

warnings.filterwarnings("ignore")

from app.api.hmi import get_contention_strategies, post_contention_strategy, StrategyApplyRequest
from app.core.scenario_presets import select_disturbances
from app.core.session_manager import session_manager
from app.main import app

WALENSEE = "pf-ch-wn-wal-long-approach"
BREAKDOWN = "interview-e1-breakdown-single-track"


def _walensee_at_conflict():
    session = session_manager.create(scenario_preset_id=WALENSEE, disturbances=select_disturbances(WALENSEE, [BREAKDOWN]))
    TestClient(app).post(f"/session/{session.id}/step", json={"policy": session.policy, "n_steps": 30})
    return session


def test_three_strategies_simulated_and_ranked():
    session = _walensee_at_conflict()
    r = get_contention_strategies(session.id)

    ids = [s["id"] for s in r["strategies"]]
    assert ids[0] == "keep" and "pp" in ids and any(i.startswith("policy:") for i in ids)
    assert sorted(r["handles"]) == [0, 1, 2]
    by_id = {s["id"]: s for s in r["strategies"]}
    # Shortest Path runs all three trains into the single-track section: a
    # deadlock, scored as the worst — and never as "delay saved".
    sp = next(s for i, s in by_id.items() if i.startswith("policy:"))
    assert sp["metrics"]["deadlocks"] > 0 and sp["lateSavedSteps"] < 0
    assert r["recommended"] in ("keep", "pp")
    assert r["confidence"] in ("high", "medium", "low")
    for s in r["strategies"]:
        assert sorted(s["passOrder"]) == [0, 1, 2]


def test_no_contention_no_strategies():
    session = session_manager.create(scenario_preset_id=WALENSEE, disturbances=select_disturbances(WALENSEE, []))
    assert get_contention_strategies(session.id)["strategies"] == []


def test_apply_switches_policy_or_installs_pp():
    session = _walensee_at_conflict()
    assert post_contention_strategy(session.id, StrategyApplyRequest(strategy="keep"))["applied"] == "keep"

    res = post_contention_strategy(session.id, StrategyApplyRequest(strategy="policy:shortest_path"))
    assert res["policy"] == "shortest_path" and session.policy == "shortest_path"

    res = post_contention_strategy(session.id, StrategyApplyRequest(strategy="pp", priority=[0, 1, 2]))
    assert res["policy"] == "plan" and session.policy == "plan"


def test_apply_rejects_unknown_strategy():
    session = _walensee_at_conflict()
    with pytest.raises(HTTPException) as exc:
        post_contention_strategy(session.id, StrategyApplyRequest(strategy="teleport"))
    assert exc.value.status_code == 400


def test_pp_beats_the_plan_when_the_first_train_breaks_down_before_the_section():
    """The strategies tour's case: E1 stuck in Weesen; the re-plan lets the
    others go first and clearly beats keeping the plan."""
    session = session_manager.create(
        scenario_preset_id=WALENSEE, disturbances=select_disturbances(WALENSEE, ["strategy-e1-breakdown-weesen"]),
    )
    TestClient(app).post(f"/session/{session.id}/step", json={"policy": session.policy, "n_steps": 22})
    r = get_contention_strategies(session.id)
    by_id = {s["id"]: s for s in r["strategies"]}
    assert r["recommended"] == "pp" and r["confidence"] == "high"
    assert by_id["pp"]["lateSavedSteps"] >= 20
    assert by_id["pp"]["priority"][-1] == 0          # E1, the broken train, goes last
    assert by_id["pp"]["passOrder"][-1] == 0
    assert by_id["keep"]["passOrder"][0] == 0         # the plan keeps E1 first
