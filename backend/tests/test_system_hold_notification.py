"""The automatic hold of an affected train is not worded as the operator's
(docs/plans/plan-b-log-findings.md §4.4)."""
import pytest
from fastapi.testclient import TestClient

from app.main import app

pytestmark = pytest.mark.integration


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _codes(client, sid, handle):
    notes = client.get(f"/session/{sid}/hmi/notifications").json()
    return {n["code"] for n in notes if n.get("relatedElement", {}).get("id") in (handle, str(handle), f"train-{handle}")
            or (n.get("params") or {}).get("train") == handle}


def test_system_and_operator_holds_are_worded_apart(client):
    sid = client.post("/session", json={"scenario_preset_id": "uc2-4", "seed": 42}).json()["id"]
    client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance", "n_steps": 20})

    client.post(f"/session/{sid}/agent/1/override", json={"action": 4, "source": "system"})
    assert "train.systemHold" in _codes(client, sid, 1)
    assert "train.overridePending" not in _codes(client, sid, 1)

    client.post(f"/session/{sid}/agent/2/override", json={"action": 4})
    assert "train.overridePending" in _codes(client, sid, 2)

    # The operator now decides for the held train: from here it is theirs.
    client.post(f"/session/{sid}/agent/1/override", json={"action": 4})
    assert "train.overridePending" in _codes(client, sid, 1)
    assert "train.systemHold" not in _codes(client, sid, 1)
