"""Study record sink (interaction logging P4).

Mounts only the study router against a temporary directory. No session is
live, so a record lands in a folder built from its own header
(app.core.study_paths, docs/plans/experiment-logging-frontend-and-replay.md §4.2).
"""

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import study
from app.config import settings

pytestmark = pytest.mark.integration

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


def _stored(tmp_path):
    return sorted(tmp_path.glob("*/*/record.json"))


def test_disabled_sink_refuses_writes(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "study_sink_enabled", False)
    assert client.put("/study/records/abc123", json=_record()).status_code == 403
    assert not _stored(tmp_path)


def test_put_stores_one_file_and_replaces_it(tmp_path):
    assert client.put("/study/records/abc123", json=_record()).status_code == 200
    assert client.put("/study/records/abc123", json=_record(endedAt=5)).status_code == 200
    files = _stored(tmp_path)
    assert [f.relative_to(tmp_path).as_posix() for f in files] == [
        "1970-01-01_00-00-00Z_free_abc123/1970-01-01_00-00-00Z_abc123/record.json"
    ]
    assert json.loads(files[0].read_text())["header"]["endedAt"] == 5


def test_legs_of_one_run_share_the_run_folder(tmp_path):
    leg = dict(conditionId="plan-b-p03", experimentRunId="run-mh2k9q-x7f3a1")
    client.put("/study/records/leg1", json=_record("leg1", startedAt=1_793_000_000_000, **leg))
    client.put("/study/records/leg2", json=_record("leg2", startedAt=1_793_000_900_000, **leg))
    folders = {f.parent.parent.name for f in _stored(tmp_path)}
    assert folders == {"2026-10-26_07-33-20Z_plan-b-p03_run-mh2k9q-x7f3a1"}
    assert len(_stored(tmp_path)) == 2


def test_old_flat_records_are_still_read(tmp_path):
    (tmp_path / "old1.json").write_text(json.dumps(_record("old1")))
    listed = client.get("/study/records", headers={"X-Study-Token": "secret"}).json()
    assert [r["sessionId"] for r in listed] == ["old1"]
    assert client.get("/study/records/old1", headers={"X-Study-Token": "secret"}).status_code == 200


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
    assert not _stored(tmp_path)


def test_put_rejects_oversized_record(monkeypatch):
    monkeypatch.setattr(settings, "study_record_max_bytes", 10)
    assert client.put("/study/records/abc123", json=_record()).status_code == 413


def test_put_refuses_new_files_when_full(monkeypatch, tmp_path):
    # Old flat files count too.
    (tmp_path / "old.json").write_text(json.dumps(_record("old")))
    monkeypatch.setattr(settings, "study_records_max_files", 2)
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
