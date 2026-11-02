"""Run and session folder names (docs/plans/experiment-logging-frontend-and-replay.md §4.2)."""

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from app.config import settings
from app.core import study_paths

T = datetime(2026, 10, 29, 8, 4, 0, tzinfo=timezone.utc)
RUN_START_MS = int(datetime(2026, 10, 29, 8, 3, 12, tzinfo=timezone.utc).timestamp() * 1000)


@pytest.fixture(autouse=True)
def _root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "study_records_dir", str(tmp_path))
    yield tmp_path


def _session(sid="a1b2c3d4", run=None, started=T):
    return SimpleNamespace(id=sid, run=run, started_at=started)


def test_guided_condition():
    run = {"kind": "condition", "id": "plan-b-p03", "run_id": "run-mh2k9q-x7f3a1", "run_started_at": RUN_START_MS}
    path = study_paths.session_dir(_session(run=run))
    assert path.parent.name == "2026-10-29_08-03-12Z_plan-b-p03_run-mh2k9q-x7f3a1"
    assert path.name == "2026-10-29_08-04-00Z_a1b2c3d4"


def test_tour_and_free_session():
    tour = {"kind": "tour", "id": "colearning-intro", "run_id": "run-1", "run_started_at": RUN_START_MS}
    assert study_paths.session_dir(_session(run=tour)).parent.name == "2026-10-29_08-03-12Z_tour-colearning-intro_run-1"
    assert study_paths.session_dir(_session()).parent.name == "2026-10-29_08-04-00Z_free_a1b2c3d4"


def test_two_legs_of_one_run_share_the_run_folder():
    run = {"kind": "condition", "id": "c", "run_id": "r", "run_started_at": RUN_START_MS}
    leg1 = study_paths.session_dir(_session("s1", run, T))
    leg2 = study_paths.session_dir(_session("s2", run, T.replace(minute=19)))
    assert leg1.parent == leg2.parent and leg1 != leg2


def test_unsafe_ids_are_cleaned():
    run = {"kind": "condition", "id": "../plan b/ü", "run_id": "run:1", "run_started_at": RUN_START_MS}
    name = study_paths.session_dir(_session(run=run)).parent.name
    assert name == "2026-10-29_08-03-12Z_plan-b_run-1"
    assert "/" not in name and ":" not in name


def test_find_session_dir_after_a_restart(tmp_path):
    folder = study_paths.session_dir(_session())
    folder.mkdir(parents=True)
    assert study_paths.find_session_dir("a1b2c3d4") == folder
    assert study_paths.find_session_dir("other") is None


def test_header_fallback_reuses_an_existing_run_folder(tmp_path):
    run = {"kind": "condition", "id": "c", "run_id": "r", "run_started_at": RUN_START_MS}
    study_paths.session_dir(_session("s1", run)).mkdir(parents=True)
    header = {"sessionId": "s2", "startedAt": RUN_START_MS + 60_000, "conditionId": "c", "experimentRunId": "r"}
    assert study_paths.session_dir_from_header(header).parent.name == "2026-10-29_08-03-12Z_c_r"
