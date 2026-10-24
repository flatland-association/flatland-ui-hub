from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["name"] == "Flatland Dispatcher API"


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_create_session():
    # Proven config (factory retries on seed glitches anyway).
    r = client.post("/session", json={
        "width": 25, "height": 25, "number_of_agents": 2,
        "seed": 42, "max_num_cities": 2,
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "id" in data
    assert data["num_agents"] == 2


def test_step_session():
    # Use the same proven config as our other tests (25x25, 2 agents, 2 cities).
    # The factory now retries on seed-dependent Flatland glitches, so this
    # is robust regardless.
    r = client.post("/session", json={
        "width": 25, "height": 25, "number_of_agents": 2,
        "seed": 42, "max_num_cities": 2,
    })
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    r2 = client.post(f"/session/{sid}/step", json={"policy": "random", "n_steps": 5})
    assert r2.status_code == 200, r2.text
    assert r2.json()["elapsed_steps"] >= 1
    assert r2.json()["state"]["elapsed_steps"] == r2.json()["elapsed_steps"]
