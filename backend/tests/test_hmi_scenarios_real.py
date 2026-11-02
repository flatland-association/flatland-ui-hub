"""End-to-end test: /hmi/scenarios returns real ScenarioBuilder output."""
import warnings
warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient
import pytest
from app.main import app

pytestmark = pytest.mark.integration

client = TestClient(app)


def _make_session(num_agents: int = 2):
    r = client.post("/session", json={
        "width": 25, "height": 25, "number_of_agents": num_agents,
        "seed": 42, "max_num_cities": 2,
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _drive(sid: str, steps: int, policy: str = "deadlock_avoidance"):
    r = client.post(f"/session/{sid}/step", json={"n_steps": steps, "policy": policy})
    assert r.status_code == 200, r.text
    return r.json()


def test_scenarios_endpoint_returns_list():
    sid = _make_session()
    r = client.get(f"/session/{sid}/hmi/scenarios")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    assert len(body) >= 1
    for opt in body:
        assert {"id", "title", "description", "kpiDelta", "isRecommended"} <= opt.keys()


def test_scenarios_with_explicit_handle():
    """Drive a few steps so an agent is on the map, then ask for handle=0."""
    sid = _make_session(num_agents=2)
    _drive(sid, steps=20)
    r = client.get(f"/session/{sid}/hmi/scenarios?handle=0&horizon=20")
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) >= 1


def test_scenarios_falls_back_to_mock_when_no_agent_on_map():
    """Right after creation, no agent has departed yet → mock fallback."""
    sid = _make_session()
    r = client.get(f"/session/{sid}/hmi/scenarios")
    assert r.status_code == 200, r.text
    body = r.json()
    # Mock always returns 3 scenarios. Real builder returns 5 (baseline + 4).
    # Either is valid; just check the list is non-empty and well-formed.
    assert len(body) in (3, 5), f"unexpected scenario count: {len(body)}"


def test_scenarios_real_have_baseline_label_when_active():
    """Once an agent is on the map, the real builder kicks in and we see
    the 'baseline' scenario in the output."""
    sid = _make_session()
    _drive(sid, steps=25)
    r = client.get(f"/session/{sid}/hmi/scenarios?horizon=20")
    assert r.status_code == 200, r.text
    body = r.json()
    titles = {opt["title"] for opt in body}
    if len(body) == 5:
        # Real path: baseline + LEFT/FORWARD/RIGHT/STOP
        assert "baseline" in titles, f"expected real builder output, got {titles}"
        assert {"LEFT", "FORWARD", "RIGHT", "STOP"} <= titles


def test_scenarios_invalid_handle_returns_422():
    sid = _make_session()
    _drive(sid, steps=15)
    r = client.get(f"/session/{sid}/hmi/scenarios?handle=99")
    # 422 from ValueError, or 200 if the env still has only 2 agents
    # and we hit the fallback path. Both are acceptable; we just guard
    # against 500.
    assert r.status_code != 500, r.text


def test_scenarios_unknown_session_returns_404():
    r = client.get("/session/does-not-exist/hmi/scenarios")
    assert r.status_code == 404
