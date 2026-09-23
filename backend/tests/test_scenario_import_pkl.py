"""POST /scenario-import/pkl: convert a flatland-scenarios export to a
RailEnvPersister .pkl for download, without executing any user-supplied code
(see app/api/scenario_import.py)."""
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from flatland.envs.persistence import RailEnvPersister

from app.main import app
from tests.test_flatland_scenario_import_session import _straight_flatland_scenario


def test_flatland_scenario_to_pkl_returns_a_loadable_env():
    client = TestClient(app)
    response = client.post("/scenario-import/pkl", json={
        "flatland_scenario_json": _straight_flatland_scenario(),
        "filename": "my scenario!",
    })

    assert response.status_code == 200, response.text
    assert response.headers["content-disposition"] == 'attachment; filename="myscenario.pkl"'

    with tempfile.TemporaryDirectory() as tmp:
        pkl_path = Path(tmp) / "roundtrip.pkl"
        pkl_path.write_bytes(response.content)
        env, _ = RailEnvPersister.load_new(str(pkl_path))

    assert env.width == 8
    assert env.height == 5
    assert len(env.agents) == 1


def test_flatland_scenario_to_pkl_rejects_malformed_json():
    client = TestClient(app)
    response = client.post("/scenario-import/pkl", json={
        "flatland_scenario_json": {"not": "a scenario"},
    })

    assert response.status_code == 400


def test_flatland_scenario_to_pkl_sanitizes_filename_path_traversal():
    client = TestClient(app)
    response = client.post("/scenario-import/pkl", json={
        "flatland_scenario_json": _straight_flatland_scenario(),
        "filename": "../../../etc/passwd",
    })

    assert response.status_code == 200, response.text
    assert response.headers["content-disposition"] == 'attachment; filename="etcpasswd.pkl"'
