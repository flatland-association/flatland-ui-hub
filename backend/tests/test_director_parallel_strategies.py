"""The three Director options planned in forked workers give the same tiles as
planned one after another (sessions._plan_strategies)."""
import warnings

import pytest
from fastapi.testclient import TestClient

warnings.filterwarnings("ignore")

from app.api import sessions as sessions_api  # noqa: E402
from app.core.session_manager import session_manager  # noqa: E402
from app.main import app  # noqa: E402
from app.policies import goal_directed_policy as gdp  # noqa: E402

PRESET = "pf-ch-wn-wal-long-approach"


def _assert_equivalent(actual, expected, path="$"):
    if type(actual) is not type(expected):
        pytest.fail(f"{path}: {type(actual).__name__} != {type(expected).__name__}")
    if isinstance(actual, dict):
        assert actual.keys() == expected.keys(), path
        for key in actual:
            _assert_equivalent(actual[key], expected[key], f"{path}.{key}")
    elif isinstance(actual, list):
        assert len(actual) == len(expected), path
        for index, (left, right) in enumerate(zip(actual, expected)):
            _assert_equivalent(left, right, f"{path}[{index}]")
    elif isinstance(actual, float):
        assert actual == pytest.approx(expected, rel=1e-8, abs=1e-7), path
    else:
        assert actual == expected, path


def _strategies(client, monkeypatch, parallel: str):
    monkeypatch.setenv("DIRECTOR_PARALLEL", parallel)
    sessions_api._STRATEGY_CACHE.clear()
    sid = session_manager.create(scenario_preset_id=PRESET).id
    for _ in range(3):
        client.post(f"/session/{sid}/step", json={"policy": "goal_directed", "n_steps": 1})
    return client.get(f"/session/{sid}/director/strategies").json()


def test_parallel_and_sequential_plan_the_same_options(monkeypatch):
    if gdp.loaded_models() is None:
        pytest.skip("no Director checkpoints installed")
    if not sessions_api._strategy_parallel_enabled():
        pytest.skip("no fork on this platform")
    client = TestClient(app)
    sequential = _strategies(client, monkeypatch, "0")
    parallel = _strategies(client, monkeypatch, "1")
    assert [s["id"] for s in parallel["strategies"]] == ["focus_delay", "focus_connections", "focus_stability"]
    assert all(s["plan"] is not None for s in parallel["strategies"])
    strip = lambda r: [{k: v for k, v in s.items()} for s in r["strategies"]]  # noqa: E731
    _assert_equivalent(strip(parallel), strip(sequential))


def test_the_off_switch_plans_in_process(monkeypatch):
    monkeypatch.setenv("DIRECTOR_PARALLEL", "0")
    assert sessions_api._strategy_parallel_enabled() is False
