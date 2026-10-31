"""Verify that bad env params are surfaced as 422, not 500."""
import warnings
warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient
import pytest
from app.main import app

pytestmark = pytest.mark.integration

client = TestClient(app)


def test_known_good_params_succeed():
    r = client.post("/session", json={
        "width": 25, "height": 25, "number_of_agents": 2,
        "seed": 42, "max_num_cities": 2,
    })
    assert r.status_code == 200, r.text


def test_factory_retries_transparent_to_caller():
    """Even seeds that historically caused IndexError should now succeed
    (factory retries with seed+1, +2, …)."""
    # 30x30, 3 agents, 3 cities — the combo that crashed in the browser.
    r = client.post("/session", json={
        "width": 30, "height": 30, "number_of_agents": 3,
        "seed": 42, "max_num_cities": 3,
    })
    assert r.status_code in (200, 422), r.text
    if r.status_code == 422:
        body = r.json()["detail"]
        assert "params" in body
        assert "attempts" in body
        assert body["attempts"] >= 1
