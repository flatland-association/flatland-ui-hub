"""KI courses computed for a step ahead (#230).

uc2-4 with seed 42: train 0 breaks down at step 20 for 20 steps and train 1,
behind it, is the affected one Plan B holds.
"""
import pytest
from fastapi.testclient import TestClient

from app.api import overrides
from app.core import proposal_preview
from app.core.session_manager import session_manager
from app.main import app

pytestmark = pytest.mark.integration

HELD = 1


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _held_session(client, at=21):
    body = {"scenario_preset_id": "uc2-4", "seed": 42, "proposal_agent": "uc2_rl",
            "enabled_policy_ids": ["deadlock_avoidance"]}
    sid = client.post("/session", json=body).json()["id"]
    client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance", "n_steps": at})
    assert client.post(f"/session/{sid}/agent/{HELD}/override", json={"action": 4}).status_code == 200
    return sid


def _step(client, sid, n=1):
    return client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance", "n_steps": n}).json()


def _ai(client, sid, lead):
    r = client.get(f"/session/{sid}/proposals", params={"handle": HELD, "alternatives": 3, "lead_steps": lead})
    assert r.status_code == 200, r.text
    body = r.json()
    return body, next(v for v in body["variants"] if v["id"] == "ai")


def _accept(client, sid, body, ai):
    return client.post(f"/session/{sid}/proposals/apply", json={
        "variant": "ai", "handle": HELD, "priority": ai["priority"], "preview_token": ai["preview_token"],
        "candidate_id": ai["candidate_id"], "source_step": body["source_step"]})


def test_fingerprints_tell_trains_on_different_cells_apart(client):
    sid = _held_session(client)
    rows = proposal_preview.fingerprint(session_manager.get(sid).env)
    placed = [(position, direction) for _, position, direction, _, _ in rows if position is not None]
    assert placed, "trains on the map must show their cell"
    assert all(direction is not None for _, direction in placed)
    assert len(set(placed)) == len(placed)


def test_forecast_fingerprints_match_the_live_run_through_a_breakdown(client):
    sid = _held_session(client, at=10)  # the breakdown starts at step 20, inside the window
    session = session_manager.get(sid)
    from app.api.overrides import _policy_factory_for_session, _roll_forward
    from app.core.override_manager import override_manager
    _, expected = _roll_forward(session.env, _policy_factory_for_session(session),
                                dict(override_manager.get_all(sid)), 20)
    for step, fingerprint in expected[1:]:
        _step(client, sid)
        assert int(session.env._elapsed_steps) == step
        assert proposal_preview.fingerprint(session.env) == fingerprint


def test_a_course_accepted_before_its_step_takes_over_exactly_at_it(client):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=5)
    assert body["ai_activation_step"] == 26 == ai["activation_step"]
    _step(client, sid)  # the participant reads for a step
    reply = _accept(client, sid, body, ai)
    assert reply.status_code == 200, reply.text
    assert reply.json()["pending"] is True and reply.json()["activation_step"] == 26
    state = client.get(f"/session/{sid}/state").json()
    assert state["pending_course"] == {"handle": HELD, "activation_step": 26}
    # Until the step the train stays held, as forecast.
    assert client.get(f"/session/{sid}/overrides").json()["overrides"] == {str(HELD): 4}
    _step(client, sid, 4)
    state = client.get(f"/session/{sid}/state").json()
    assert state["pending_course"] is None
    assert state["course_activation"]["outcome"] == "installed"
    assert client.get(f"/session/{sid}/overrides").json()["overrides"] == {}
    assert session_manager.get(sid).policy == "plan"


def test_a_new_decision_for_the_train_drops_the_pending_course(client):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=5)
    assert _accept(client, sid, body, ai).json()["pending"] is True
    client.delete(f"/session/{sid}/agent/{HELD}/override")
    assert client.get(f"/session/{sid}/state").json()["pending_course"] is None
    _step(client, sid, 6)
    assert client.get(f"/session/{sid}/state").json()["course_activation"] is None


def test_reset_drops_the_pending_course(client):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=5)
    assert _accept(client, sid, body, ai).json()["pending"] is True
    client.post(f"/session/{sid}/reset")
    assert client.get(f"/session/{sid}/state").json()["pending_course"] is None


def test_without_a_lead_the_exact_same_step_rule_is_unchanged(client):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=0)
    assert body["ai_activation_step"] is None
    _step(client, sid)
    assert _accept(client, sid, body, ai).status_code == 409


@pytest.mark.parametrize("still_works, status", [(True, 200), (False, 409)])
def test_a_late_accept_is_rechecked_from_the_live_state(client, monkeypatch, still_works, status):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=3)
    _step(client, sid, 5)  # past the activation step
    monkeypatch.setattr(overrides, "_course_still_works", lambda *a: still_works)
    reply = _accept(client, sid, body, ai)
    assert reply.status_code == status
    if status == 200:
        assert reply.json()["pending"] is False
        assert session_manager.get(sid).policy == "plan"


def test_a_pending_course_that_fails_its_recheck_is_rejected_not_installed(client, monkeypatch):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=5)
    assert _accept(client, sid, body, ai).json()["pending"] is True
    # The run leaves the forecast: the fingerprint at the step will not match.
    monkeypatch.setattr(proposal_preview, "matches_forecast", lambda *a: False)
    monkeypatch.setattr(overrides, "_course_still_works", lambda *a: False)
    _step(client, sid, 5)
    state = client.get(f"/session/{sid}/state").json()
    assert state["course_activation"]["outcome"] == "rejected"
    assert client.get(f"/session/{sid}/overrides").json()["overrides"] == {str(HELD): 4}
