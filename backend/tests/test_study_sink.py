"""Study record sink (interaction logging P4).

Mounts only the study router against a temporary directory, so these tests
need neither Flatland nor a session.
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import study
from app.config import settings

app = FastAPI()
app.include_router(study.router)
client = TestClient(app)


def _record(sid="abc123", **header):
    return {
        "schema": "flatland-session-record",
        "version": 2,
        "header": {"sessionId": sid, "participantId": "P01", "conditionId": "c1", "startedAt": 1, **header},
        "decisions": [],
    }


@pytest.fixture(autouse=True)
def _sink(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "study_sink_enabled", True)
    monkeypatch.setattr(settings, "study_records_dir", str(tmp_path))
    monkeypatch.setattr(settings, "study_admin_token", "secret")
    yield tmp_path


def test_status_reports_sink_and_version():
    body = client.get("/study/status").json()
    assert body["sinkEnabled"] is True
    assert body["backendVersion"]


def test_disabled_sink_refuses_writes(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "study_sink_enabled", False)
    assert client.put("/study/records/abc123", json=_record()).status_code == 403
    assert not list(tmp_path.glob("*.json"))


def test_put_stores_one_file_and_replaces_it(tmp_path):
    assert client.put("/study/records/abc123", json=_record()).status_code == 200
    assert client.put("/study/records/abc123", json=_record(endedAt=5)).status_code == 200
    files = list(tmp_path.glob("*.json"))
    assert [f.name for f in files] == ["abc123.json"]
    assert json.loads(files[0].read_text())["header"]["endedAt"] == 5


@pytest.mark.parametrize(
    "sid, body, status",
    [
        ("abc123", {"schema": "other", "header": {"sessionId": "abc123"}}, 422),
        ("abc123", _record("different"), 422),
        ("a.b", _record("a.b"), 400),
    ],
)
def test_put_rejects_foreign_or_mismatched_records(sid, body, status, tmp_path):
    assert client.put(f"/study/records/{sid}", json=body).status_code == status
    assert not list(tmp_path.glob("*.json"))


def test_put_rejects_oversized_record(monkeypatch):
    monkeypatch.setattr(settings, "study_record_max_bytes", 10)
    assert client.put("/study/records/abc123", json=_record()).status_code == 413


def test_put_refuses_new_files_when_full(monkeypatch):
    monkeypatch.setattr(settings, "study_records_max_files", 1)
    assert client.put("/study/records/one", json=_record("one")).status_code == 200
    assert client.put("/study/records/two", json=_record("two")).status_code == 507
    # An existing record may still be updated.
    assert client.put("/study/records/one", json=_record("one", endedAt=2)).status_code == 200


def test_reading_needs_the_token():
    client.put("/study/records/abc123", json=_record())
    assert client.get("/study/records").status_code == 401
    assert client.get("/study/records", headers={"X-Study-Token": "wrong"}).status_code == 401
    listed = client.get("/study/records", headers={"X-Study-Token": "secret"}).json()
    assert listed[0]["sessionId"] == "abc123" and listed[0]["participantId"] == "P01"
    got = client.get("/study/records/abc123", headers={"X-Study-Token": "secret"})
    assert got.json()["header"]["conditionId"] == "c1"


def test_reading_is_off_without_a_configured_token(monkeypatch):
    monkeypatch.setattr(settings, "study_admin_token", "")
    assert client.get("/study/records", headers={"X-Study-Token": ""}).status_code == 403
