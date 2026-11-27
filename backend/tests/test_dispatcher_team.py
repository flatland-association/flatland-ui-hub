"""Real human consent, neutral observation and terminal-run measurement integrity."""
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import hmi, sessions
from app.core.dispatcher import ORIGIN, DispatcherConfig, DispatcherRuntime
from app.core.session_manager import session_manager
from app.main import app
from app.models.session import SessionCreateRequest

pytestmark = pytest.mark.integration
PRESET = "pf-ch-wn-wal-long-approach"


def fake(*, mode="recommendation", operator_type="human_dispatcher_team", session_id="team-unit", **config):
    env = SimpleNamespace(_elapsed_steps=7, _max_episode_steps=50,
                          agents=[SimpleNamespace(state=SimpleNamespace(name="MOVING")) for _ in range(2)])
    session = SimpleNamespace(id=session_id, env=env, policy="goal_directed" if mode == "director" else "random",
                              enabled_policy_ids={"goal_directed", "random"}, control_revision=0)
    runtime = DispatcherRuntime(session, DispatcherConfig(**config), mode, operator_type=operator_type)
    session.dispatcher = runtime
    observation = {"open_decisions": 1, "situation": "conflict-A", "preferred": "pp", "handles": [0, 1],
                   "alternatives": [{"id": "pp", "priority": [1, 0], "metrics": {}, "passOrder": [1, 0]}],
                   "priority_available": False}
    if mode == "director":
        observation = {"mode": mode, "weights": [1, 1, 1], "open_decisions": 0}
    if mode != "co-learning":
        runtime.observe = lambda _: deepcopy(observation)
    return session, runtime, observation


def respond(session, runtime, decision="approve", proposal=None):
    proposal = proposal or runtime.pending
    runtime.decide(session, proposal["command_id"], proposal["generation"], decision)


def test_team_proposal_never_executes_without_explicit_consent_and_approval_preserves_pause(monkeypatch):
    session, runtime, _ = fake(profile="delayed", delay=1)
    calls = []
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: calls.append(ORIGIN.get()) or {"applied": "pp"})
    for _ in range(8):
        assert not runtime.pulse(session)
    proposal = deepcopy(runtime.pending)
    assert calls == []
    assert runtime.snapshot(session)["awaiting_approval"]
    assert runtime.execute(session, proposal, runtime.observation)["status"] == "awaiting_approval"
    runtime.status = "paused"
    respond(session, runtime)
    assert runtime.status == "paused"
    assert calls == []
    assert runtime.snapshot(session)["approved_command_id"] == proposal["command_id"]
    respond(session, runtime, proposal=proposal)
    assert len([e for e in runtime.events if e["kind"] == "human_decision"]) == 1
    assert runtime.pulse(session)
    assert runtime.pulse(session)
    assert calls == ["digital_shift_partner"]
    assert runtime.metrics(session)["executed"] == 1
    respond(session, runtime, proposal=proposal)
    with pytest.raises(HTTPException) as exc:
        respond(session, runtime, "decline", proposal)
    assert exc.value.status_code == 409
    assert next(e for e in runtime.events if e["kind"] == "human_decision")["source"] == "human"


def test_decline_is_terminal_and_does_not_repeat_the_same_proposal(monkeypatch):
    session, runtime, _ = fake()
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: pytest.fail("declined proposal executed"))
    runtime.pulse(session)
    proposal = deepcopy(runtime.pending)
    respond(session, runtime, "decline")
    respond(session, runtime, "decline", proposal)
    for _ in range(6):
        assert runtime.pulse(session)
        assert runtime.pending is None
    assert runtime.metrics(session)["declined"] == 1
    assert runtime.metrics(session)["planned"] == 1
    assert runtime.metrics(session)["executed"] == 0


@pytest.mark.parametrize("approve_first", [False, True])
def test_takeover_cancels_proposal_and_rejects_old_consent(approve_first, monkeypatch):
    session, runtime, _ = fake()
    runtime.pulse(session)
    proposal = deepcopy(runtime.pending)
    if approve_first:
        respond(session, runtime)
    runtime.invalidate(session, "takeover", human=True)
    assert runtime.snapshot(session)["operator_type"] == "human_dispatcher_team"
    runtime.hand_back(session)
    with pytest.raises(HTTPException) as exc:
        respond(session, runtime, proposal=proposal)
    assert exc.value.status_code == 409
    assert runtime.metrics(session)["cancelled"] == 1
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: pytest.fail("old consent executed"))
    assert not runtime.pulse(session)
    assert runtime.pending["generation"] != proposal["generation"]
    assert runtime.awaiting_approval


def test_consent_does_not_retarget_a_changed_alternative(monkeypatch):
    session, runtime, observation = fake()
    runtime.pulse(session)
    respond(session, runtime)
    observation["alternatives"][0]["priority"] = [0, 1]
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: pytest.fail("changed alternative executed"))
    runtime.pulse(session)
    assert runtime.metrics(session)["stale"] == 1
    assert runtime.metrics(session)["executed"] == 0


def test_matching_local_sequence_cannot_replay_consent_into_another_session():
    first, first_runtime, _ = fake(session_id="team-first")
    second, second_runtime, _ = fake(session_id="team-second")
    first_runtime.pulse(first)
    second_runtime.pulse(second)
    with pytest.raises(HTTPException) as exc:
        respond(second, second_runtime, proposal=first_runtime.pending)
    assert exc.value.status_code == 409
    assert second_runtime.awaiting_approval


def test_neutral_co_learning_never_selects_or_accepts_consent(monkeypatch):
    session, runtime, _ = fake(mode="co-learning")
    monkeypatch.setattr(hmi, "get_contentions", lambda *_: {"groups": [{"handles": [1, 0]}]})
    monkeypatch.setattr(runtime, "choose", lambda *_: pytest.fail("Co-Learning selected a choice"))
    monkeypatch.setattr("app.core.contention_strategies.contention_strategies", lambda *_: pytest.fail("Co-Learning ranked options"))
    assert runtime.pulse(session)
    snapshot = runtime.snapshot(session)
    assert snapshot["owner"] == "human"
    assert snapshot["observation"]["neutral"]
    assert snapshot["observation"]["allowed_commands"] == []
    assert "preferred" not in snapshot["observation"]
    assert not snapshot["requires_approval"]
    assert snapshot["pending"] is None
    with pytest.raises(HTTPException):
        runtime.decide(session, "invented", runtime.generation, "approve")
    with pytest.raises(HTTPException):
        runtime.hand_back(session)


@pytest.mark.parametrize("operator_type", ["human", "synthetic_dispatcher", "human_dispatcher_team"])
def test_staffing_validation_preserves_defaults_and_separates_study_runs(operator_type):
    request = SessionCreateRequest(operator_type=operator_type)
    assert (request.dispatcher is None) == (operator_type == "human")
    if operator_type != "human":
        with pytest.raises(ValidationError):
            SessionCreateRequest(operator_type=operator_type, run={"kind": "condition", "id": "human-study", "run_id": "real"})


def test_team_co_learning_only_accepts_neutral_baseline():
    assert SessionCreateRequest(operator_type="human_dispatcher_team", interaction_mode="co-learning").dispatcher.profile == "baseline"
    with pytest.raises(ValidationError):
        SessionCreateRequest(operator_type="human_dispatcher_team", interaction_mode="co-learning", dispatcher={"profile": "priority"})
    with pytest.raises(ValidationError):
        SessionCreateRequest(operator_type="synthetic_dispatcher", interaction_mode="co-learning")


@pytest.mark.parametrize("operator_type", ["synthetic_dispatcher", "human_dispatcher_team"])
def test_director_delegation_restores_controller_and_rejects_disabled_controller(operator_type, monkeypatch):
    session, runtime, _ = fake(mode="director", operator_type=operator_type)
    monkeypatch.setattr("app.policies.goal_directed_policy.loaded_models", lambda: (object(), object()))
    monkeypatch.setattr(sessions, "_invalidate_scenario_forecasts", lambda *_: None)
    runtime.invalidate(session, "takeover", human=True)
    session.policy = "random"
    runtime.hand_back(session)
    assert session.policy == "goal_directed"
    generation = runtime.generation
    runtime.hand_back(session)
    assert runtime.generation == generation
    runtime.invalidate(session, "takeover", human=True)
    session.enabled_policy_ids.remove("goal_directed")
    with pytest.raises(HTTPException) as exc:
        runtime.hand_back(session)
    assert exc.value.status_code == 409
    assert runtime.owner == "human"


def test_director_consent_effectiveness_and_identical_goal_change(monkeypatch):
    session, runtime, _ = fake(mode="director", profile="goal-switch", switch_at=2,
                               switched={"punctuality": 1, "connections": 1, "stability": 1})
    calls = []
    info = {"source": "research", "weights": [1, 1, 1]}
    monkeypatch.setattr("app.policies.goal_directed_policy.env_weights", lambda *_: (1, 1, 1))
    monkeypatch.setattr("app.policies.goal_directed_policy.plan_info", lambda *_: info)
    monkeypatch.setattr("app.policies.goal_directed_policy.plan_player", lambda *_: object())
    monkeypatch.setattr(sessions, "set_director_weights_for_session", lambda *args: calls.append(args) or {"replanned": True, "plan": info})
    assert runtime.pulse(session)
    assert calls == []
    respond(session, runtime)
    assert calls == []
    runtime.pulse(session)
    session.policy = "random"
    runtime.after_step(session, False)
    assert runtime.metrics(session)["effective_directives"] == 0
    session.policy = "goal_directed"
    runtime.after_step(session, False)
    assert runtime.metrics(session)["effective_directives"] == 1
    runtime.pulse(session)
    assert runtime.pending["command"]["phase"] == "switched"
    assert len(calls) == 1
    respond(session, runtime)
    runtime.pulse(session)
    runtime.after_step(session, False)
    assert runtime.metrics(session)["effective_directives"] == 2
    assert runtime.metrics(session)["effective_goal_changes"] == 0


@pytest.mark.parametrize("reason,status,human", [("reset", "aborted", True), ("run_error", "error", False)])
def test_terminal_measurements_cannot_mix_with_a_later_episode(reason, status, human):
    session, runtime, _ = fake()
    runtime.pulse(session)
    runtime.invalidate(session, reason, human=human)
    runtime.run_status = status
    frozen = runtime.metrics(session)
    session.env._elapsed_steps = 50
    for agent in session.env.agents:
        agent.state.name = "DONE"
    runtime.after_step(session, True)
    assert runtime.run_status == status
    assert runtime.metrics(session) == frozen
    assert runtime.simulation_result(session) == "unfinished"
    assert runtime.pulse(session) is human
    assert runtime.metrics(session)["simulation_steps"] == 7


@pytest.fixture
def real_session(tmp_path, monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "study_records_dir", str(tmp_path))
    created = []
    def create(operator_type="human_dispatcher_team", mode="recommendation"):
        info = sessions.create_session(SessionCreateRequest(operator_type=operator_type, interaction_mode=mode,
            scenario_preset_id=PRESET, disturbance_ids=["strategy-e1-breakdown-weesen"]))
        session = session_manager.get(info.id)
        created.append(session)
        return session, info
    yield create
    for session in created:
        sessions.delete_session(session.id)


def test_real_proposal_approval_is_bound_idempotent_and_does_not_resume(real_session):
    session, info = real_session()
    assert info.operator_type == "human_dispatcher_team"
    client = TestClient(app)
    for _ in range(30):
        response = client.post(f"/session/{session.id}/step", json={"policy": session.policy})
        assert response.status_code == 200, response.text
        if session.dispatcher.pending:
            break
    proposal = deepcopy(session.dispatcher.pending)
    assert proposal is not None
    elapsed = session.env._elapsed_steps
    for _ in range(3):
        assert client.post(f"/session/{session.id}/step", json={"policy": session.policy}).status_code == 200
    assert session.env._elapsed_steps == elapsed
    assert session.dispatcher.metrics(session)["executed"] == 0
    body = {"command_id": proposal["command_id"], "generation": proposal["generation"], "decision": "approve"}
    url = f"/session/{session.id}/dispatcher/decision"
    assert client.post(url, json={**body, "generation": proposal["generation"] + 1}).status_code == 409
    assert client.post(url, json={**body, "command_id": "other-proposal"}).status_code == 409
    assert client.post(f"/session/{session.id}/pause").status_code == 200
    assert client.post(url, json=body).status_code == 200
    assert client.post(url, json=body).status_code == 200
    assert not client.get(f"/session/{session.id}/play_status").json()["playing"]
    assert session.env._elapsed_steps == elapsed
    assert session.dispatcher.metrics(session)["executed"] == 0
    assert client.post(f"/session/{session.id}/step", json={"policy": session.policy}).status_code == 200
    assert session.dispatcher.metrics(session)["executed"] == 1
    assert client.post(url, json={**body, "decision": "decline"}).status_code == 409
    assert client.post(f"/session/{session.id}/dispatcher/ownership", json={"owner": "human"}).status_code == 200
    assert client.post(url, json=body).status_code == 409


@pytest.mark.parametrize("operator_type,mode", [("synthetic_dispatcher", "recommendation"), ("human_dispatcher_team", "co-learning")])
def test_decision_endpoint_rejects_non_consent_modes(real_session, operator_type, mode):
    session, _ = real_session(operator_type, mode)
    response = TestClient(app).post(f"/session/{session.id}/dispatcher/decision",
        json={"command_id": "not-a-proposal", "generation": 0, "decision": "approve"})
    assert response.status_code == 409


@pytest.mark.parametrize("action", ["stop", "reset"])
def test_error_export_and_final_measurements_survive_stop_or_reset(real_session, monkeypatch, action):
    session, _ = real_session()
    client = TestClient(app, raise_server_exceptions=False)
    url = f"/session/{session.id}"
    assert client.post(f"{url}/step", json={"policy": session.policy}).status_code == 200
    assert session.env._elapsed_steps == 1

    def fail_observation(_session):
        raise RuntimeError("injected operator observation failure")

    monkeypatch.setattr(session.dispatcher, "observe", fail_observation)
    assert client.post(f"{url}/step", json={"policy": session.policy}).status_code == 500
    before = client.get(f"{url}/dispatcher/export").json()
    assert before["technical_result"] == "error"
    assert before["metrics"]["simulation_steps"] == 1
    control_path = "/reset" if action == "reset" else "/dispatcher/stop"
    assert client.post(url + control_path).status_code == 200
    assert client.post(f"{url}/step", json={"policy": session.policy}).status_code == 409
    after = client.get(f"{url}/dispatcher/export").json()
    assert after["technical_result"] == "error"
    assert after["run_status"] == "error"
    assert after["abort_reason"] == before["abort_reason"]
    assert after["metrics"] == before["metrics"]
    assert after["simulation_result"] == before["simulation_result"]


@pytest.mark.parametrize("failure_site", ["act_many", "step_env"])
def test_step_execution_failures_are_terminal_and_preserve_final_evidence(real_session, monkeypatch, failure_site):
    session, _ = real_session()
    client = TestClient(app, raise_server_exceptions=False)
    url = f"/session/{session.id}"
    assert client.post(f"{url}/step", json={"policy": session.policy}).status_code == 200
    calls = []

    def fail(*_args, **_kwargs):
        calls.append(failure_site)
        raise RuntimeError(f"injected {failure_site} execution failure")

    if failure_site == "act_many":
        policy = SimpleNamespace(start_step=lambda: None, act_many=fail, end_step=lambda: None)
        monkeypatch.setattr(sessions, "_build_policy", lambda *_args: policy)
    else:
        monkeypatch.setattr(sessions, "step_env", fail)
    assert client.post(f"{url}/step", json={"policy": session.policy}).status_code == 500
    before = client.get(f"{url}/dispatcher/export").json()
    assert before["technical_result"] == "error"
    assert before["run_status"] == "error"
    assert failure_site in before["abort_reason"]
    assert before["metrics"]["simulation_steps"] == 1
    assert client.post(f"{url}/step", json={"policy": session.policy}).status_code == 409
    assert client.post(f"{url}/dispatcher/stop").status_code == 200
    after = client.get(f"{url}/dispatcher/export").json()
    assert after["technical_result"] == "error"
    assert after["metrics"] == before["metrics"]
    assert after["simulation_result"] == before["simulation_result"]
    assert calls == [failure_site]
