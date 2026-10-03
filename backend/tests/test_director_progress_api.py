"""/director/progress: which planning step the Director is in, for the
strategy tiles' progress (first plan → A → B → C)."""
import warnings

from fastapi.testclient import TestClient

warnings.filterwarnings("ignore")

from app.api import sessions as sessions_api  # noqa: E402
from app.core.session_manager import session_manager  # noqa: E402
from app.main import app  # noqa: E402


def _session():
    return session_manager.create(scenario_preset_id="pf-ch-wn-wal-long-approach")


def test_idle_when_nothing_is_being_planned():
    client = TestClient(app)
    sid = _session().id
    assert client.get(f"/session/{sid}/director/progress").json() == {"phase": "idle"}


def test_reports_the_option_being_planned_and_resets_on_a_new_phase():
    client = TestClient(app)
    sid = _session().id
    sessions_api._progress(sid, phase="strategies", done=0, total=3, current="focus_delay")
    sessions_api._progress(sid, done=1, current="focus_connections")
    body = client.get(f"/session/{sid}/director/progress").json()
    assert body["phase"] == "strategies"
    assert (body["done"], body["total"], body["current"]) == (1, 3, "focus_connections")
    assert body["elapsed_s"] >= 0
    sessions_api._progress(sid, phase="first-plan")
    assert client.get(f"/session/{sid}/director/progress").json()["done"] is None
    sessions_api._DIRECTOR_PROGRESS.pop(sid, None)


def test_unknown_session_is_404():
    assert TestClient(app).get("/session/nope/director/progress").status_code == 404
