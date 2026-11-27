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


TICKS = []  # (scheduler id, step), shared by every copy of _RecordingScheduler


class _RecordingScheduler:
    """Stands in for the session's disturbance scheduler: records who is ticked at which step."""

    def __bool__(self):
        return True

    def tick(self, env, step):
        TICKS.append((id(self), step))
        return []


def test_the_forecast_ticks_a_private_copy_of_the_disturbance_scheduler(client):
    sid = _held_session(client)
    session = session_manager.get(sid)
    live = session.disturbance_scheduler = _RecordingScheduler()
    captured = overrides._capture_proposal_source(session, HELD, None, None, 3, lead_steps=3)
    root, factory, committed, snapshot = captured[0], captured[1], captured[2], captured[5]
    TICKS.clear()
    overrides._roll_forward(root, factory, committed, 3, snapshot.disturbance_scheduler)
    start = int(root._elapsed_steps)
    assert [step for _, step in TICKS] == [start + 1, start + 2, start + 3]
    assert id(live) not in {who for who, _ in TICKS}  # the live scheduler is not ticked by a forecast


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
    state = client.get(f"/session/{sid}/state").json()
    assert state["pending_course"] is None
    # Reported, so the panel stops waiting for it.
    assert state["course_activation"] == {"handle": HELD, "step": 21, "activation_step": 26, "outcome": "cancelled"}
    _step(client, sid, 6)
    assert client.get(f"/session/{sid}/state").json()["course_activation"]["outcome"] == "cancelled"


def test_a_refused_reroute_leaves_the_pending_course(client):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=5)
    assert _accept(client, sid, body, ai).json()["pending"] is True
    refused = client.post(f"/session/{sid}/agent/{HELD}/override",
                          json={"action": overrides.REROUTE_ACTION, "via": [[1, 2, 3]]})
    assert refused.status_code == 400
    assert client.get(f"/session/{sid}/state").json()["pending_course"] is not None


def test_a_refused_token_leaves_the_pending_course(client):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=5)
    assert _accept(client, sid, body, ai).json()["pending"] is True
    expired = client.post(f"/session/{sid}/proposals/apply", json={
        "variant": "ai", "handle": HELD, "priority": ai["priority"], "preview_token": "expired",
        "candidate_id": ai["candidate_id"], "source_step": body["source_step"]})
    assert expired.status_code == 409
    assert client.get(f"/session/{sid}/state").json()["pending_course"] is not None


def test_reset_drops_the_pending_course(client):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=5)
    assert _accept(client, sid, body, ai).json()["pending"] is True
    client.post(f"/session/{sid}/reset")
    state = client.get(f"/session/{sid}/state").json()
    assert state["pending_course"] is None
    assert state["course_activation"]["outcome"] == "cancelled"


def test_every_state_broadcast_carries_the_course_state(client, monkeypatch):
    from app.api import sessions
    sent = []

    async def record(session_id, message):
        sent.append(message)

    monkeypatch.setattr(sessions.ws_manager, "broadcast", record)
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=1)
    assert _accept(client, sid, body, ai).json()["pending"] is True
    sent.clear()
    _step(client, sid)  # a manual step reaches the activation step
    state = sent[-1]["state"]
    assert state["pending_course"] is None
    assert state["course_activation"]["outcome"] in ("installed", "rechecked")


def test_a_lead_token_from_before_a_reset_is_refused(client):
    sid = _held_session(client)
    body, ai = _ai(client, sid, lead=3)
    client.post(f"/session/{sid}/reset")
    _step(client, sid, body["source_step"])  # same step number, other episode
    assert _accept(client, sid, body, ai).status_code == 409
    assert proposal_preview.pending_course(session_manager.get(sid)) is None


def test_proposals_computed_across_a_reset_are_not_published(client):
    sid = _held_session(client)
    session = session_manager.get(sid)
    captured = overrides._capture_proposal_source(session, HELD, None, None, 3, lead_steps=3)
    evaluated = overrides._evaluate_proposals(captured)
    client.post(f"/session/{sid}/reset")
    with pytest.raises(overrides.HTTPException) as refused:
        overrides._publish_proposals(session, captured, evaluated)
    assert refused.value.status_code == 409
    assert not getattr(session, "_proposal_previews", {})


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
