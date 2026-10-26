"""Graph env playground API: network, session creation, stepping, unknown session."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_network():
    response = client.get("/graph-env-api/network")

    assert response.status_code == 200
    network = response.json()
    assert len(network["tracks"]) == 41
    assert len(network["nodes"]) == 38
    assert all(len(track) >= 2 for track in network["tracks"])
    assert {"id", "lat", "lon", "is_switch"} <= set(network["nodes"][0])
    assert len(network["bounds"]) == 2


def test_create_and_step_session():
    created = client.post("/graph-env-api/sessions").json()
    assert created["id"]
    assert created["state"]["step"] == 0
    assert created["state"]["agents"][0]["state"] == "WAITING"

    state = client.post(f"/graph-env-api/sessions/{created['id']}/step", params={"n": 10}).json()

    assert state["step"] == 10
    assert not state["done"]
    agent = state["agents"][0]
    assert agent["state"] == "MOVING"
    assert {"handle", "edge", "fraction", "lat", "lon", "bearing", "remaining_path", "target"} <= set(agent)

    state = client.post(f"/graph-env-api/sessions/{created['id']}/step", params={"n": 10_000}).json()
    assert state["done"]
    assert state["agents"][0]["state"] == "DONE"


def test_each_session_is_its_own_env():
    first = client.post("/graph-env-api/sessions").json()["id"]
    client.post(f"/graph-env-api/sessions/{first}/step", params={"n": 5})

    second = client.post("/graph-env-api/sessions").json()

    assert second["state"]["step"] == 0
    assert client.post(f"/graph-env-api/sessions/{first}/step").json()["step"] == 6


def test_step_unknown_session():
    assert client.post("/graph-env-api/sessions/nope/step").status_code == 404


def test_step_count_validated():
    session_id = client.post("/graph-env-api/sessions").json()["id"]

    assert client.post(f"/graph-env-api/sessions/{session_id}/step", params={"n": 0}).status_code == 422
