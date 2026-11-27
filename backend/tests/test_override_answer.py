"""The override answer echoes the decision as taken: route, start and step
(docs/plans/plan-b-log-findings.md §4.4, REQ-8)."""
import pytest
from fastapi.testclient import TestClient

from app.api import overrides
from app.main import app

pytestmark = pytest.mark.integration


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _session(client, steps=5):
    body = {"scenario_preset_id": "uc2-4", "seed": 42, "enabled_policy_ids": ["deadlock_avoidance"]}
    sid = client.post("/session", json=body).json()["id"]
    client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance", "n_steps": steps})
    return sid


def test_a_hold_answers_with_its_step_and_no_route(client):
    sid = _session(client)
    reply = client.post(f"/session/{sid}/agent/1/override", json={"action": 4})
    assert reply.status_code == 200
    assert reply.json() == {"session_id": sid, "handle": 1, "action": 4, "via": [], "start": None, "step": 5}


def test_a_reroute_answers_with_the_route_and_start_it_was_given(client, monkeypatch):
    sid = _session(client)
    monkeypatch.setattr(overrides, "_commit_override", lambda *a: None)  # the route itself is not under test
    reply = client.post(f"/session/{sid}/agent/1/override",
                        json={"action": overrides.REROUTE_ACTION, "via": [[2, 3], [2, 4]], "start": [2, 2, 1]})
    assert reply.status_code == 200
    assert reply.json()["via"] == [[2, 3], [2, 4]]
    assert reply.json()["start"] == [2, 2, 1] and reply.json()["step"] == 5
