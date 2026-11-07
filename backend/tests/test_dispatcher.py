"""Reference-bound operator decisions and real Flatland command integration."""
import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import hmi
from app.api.sessions import create_session, delete_session, step
from app.core.dispatcher import DispatcherConfig, DispatcherRuntime
from app.core.session_manager import session_manager
from app.main import app
from app.models.session import SessionCreateRequest, StepRequest

pytestmark = pytest.mark.integration


def test_prepared_demo_recipes_are_complete_and_mode_compatible():
    recipes = TestClient(app).get('/dispatcher/demos').json()
    assert set(recipes) == {'recommendation', 'director', 'team'}
    for recipe in recipes.values():
        req = SessionCreateRequest.model_validate({
            **{k: v for k, v in recipe.items() if k not in ('open_at_step', 'play_speed_level')},
            'operator_type': recipe.get('operator_type', 'synthetic_dispatcher'),
        })
        assert req.interaction_mode == recipe['interaction_mode']
        assert req.scenario_preset_id == 'pf-ch-wn-wal-long-approach'
        assert req.seed == 42
    assert recipes['recommendation']['dispatcher']['profile'] == 'delayed'
    assert recipes['team']['operator_type'] == 'human_dispatcher_team'
    assert recipes['team']['interaction_mode'] == 'recommendation'
    assert recipes['team']['dispatcher']['profile'] == 'baseline'
    assert recipes['recommendation']['disturbance_ids'] == ['strategy-e1-breakdown-weesen']
    assert recipes['director']['dispatcher']['profile'] == 'goal-switch'
    assert recipes['director']['dispatcher']['switch_at'] > recipes['director']['open_at_step']
    from app.core.director_objectives import DIRECTOR_STRATEGY_PRESETS

    assert recipes['director']['dispatcher']['initial'] == DIRECTOR_STRATEGY_PRESETS[2]['weights']
    assert recipes['director']['dispatcher']['switched'] == DIRECTOR_STRATEGY_PRESETS[0]['weights']


def fake(profile="delayed", **params):
    session = SimpleNamespace(id="operator-test", env=SimpleNamespace(_elapsed_steps=7, agents=[object(), object()]))
    runtime = DispatcherRuntime(session, DispatcherConfig(profile=profile, **params), "recommendation")
    session.dispatcher = runtime
    option = {"id": "pp", "priority": [1, 0], "metrics": {"score": 2}, "passOrder": [1, 0]}
    observation = {"open_decisions": 1, "situation": "conflict-A", "preferred": "pp", "handles": [0, 1],
                   "alternatives": [option], "priority_available": False}
    runtime.observe = lambda _: deepcopy(observation)
    return session, runtime, observation


@pytest.mark.parametrize("reason", ["takeover", "stop", "reset", "session_end", "abort"])
def test_pending_is_cancelled_and_cannot_resurrect(reason, monkeypatch):
    session, runtime, obs = fake()
    assert not runtime.pulse(session)
    pending = deepcopy(runtime.pending)
    runtime.invalidate(session, reason, human=True)
    runtime.hand_back(session)
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: pytest.fail("old command executed"))
    result = runtime.execute(session, pending, obs)
    assert result["status"] == "cancelled"
    assert runtime.pending is None


def test_delay_revalidates_original_and_duplicate_executes_only_once(monkeypatch):
    session, runtime, obs = fake(delay=3)
    calls = []
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: calls.append(args) or {"applied": "pp"})
    assert not runtime.pulse(session)
    pending = deepcopy(runtime.pending)
    assert pending["due"] == 4
    assert not runtime.pulse(session)
    assert not runtime.pulse(session)
    assert calls == []
    assert runtime.pulse(session)
    assert len(calls) == 1
    assert runtime.execute(session, pending, obs)["status"] == "executed"
    assert len(calls) == 1
    assert runtime.events[-1]["result"]["response_ticks"] == 3


def test_stale_alternative_is_not_retargeted(monkeypatch):
    session, runtime, obs = fake(delay=1)
    runtime.pulse(session)
    obs["alternatives"][0]["id"] = "keep"
    obs["preferred"] = "keep"
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: pytest.fail("silently retargeted"))
    runtime.pulse(session)
    assert runtime.events[-1]["result"]["status"] == "stale"
    assert runtime.events[-1]["decision"]["command"]["strategy"] == "pp"


def test_passing_time_alone_does_not_expire_the_same_alternative(monkeypatch):
    session, runtime, _obs = fake(delay=1)
    calls = []
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: calls.append(args) or {})
    runtime.pulse(session)
    session.env._elapsed_steps += 100
    runtime.pulse(session)
    assert len(calls) == 1


def test_new_ranking_does_not_retarget_the_original_choice(monkeypatch):
    session, runtime, obs = fake(delay=1)
    calls = []
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda _, req: calls.append(req.strategy) or {})
    runtime.pulse(session)
    obs["alternatives"][0]["metrics"]["score"] = 99
    obs["alternatives"].append({"id": "keep", "priority": None, "metrics": {"score": 0}, "passOrder": [0, 1]})
    obs["preferred"] = "keep"
    runtime.pulse(session)
    assert calls == ["pp"]


def test_mutated_command_is_rejected(monkeypatch):
    session, runtime, obs = fake(delay=1)
    runtime.pulse(session)
    decision = deepcopy(runtime.pending)
    decision["command"]["priority"] = [99]
    runtime.clock = decision["due"]
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda *args: pytest.fail("unvalidated mutation"))
    assert runtime.execute(session, decision, obs)["reason"] == "unknown_or_mutated_command"


def test_no_action_waits_without_pending_or_repeated_events():
    session, runtime, obs = fake()
    obs.update(open_decisions=0, alternatives=[])
    for _ in range(20):
        assert runtime.pulse(session)
    assert runtime.pending is None
    assert [e["kind"] for e in runtime.events] == ["configured", "waiting"]


def test_unassessable_priority_uses_documented_fallback():
    _, runtime, obs = fake(profile="priority", priority=(0,))
    command, rule, fallback = runtime.choose(obs)
    assert command["strategy"] == "pp"
    assert rule == "preferred_strategy"
    assert fallback == "priority_not_available_use_preferred"


@pytest.mark.parametrize("config", [
    {"profile": "invented"}, {"profile": "delayed", "delay": -1},
    {"priority": [0, 0]}, {"initial": {"punctuality": 0, "connections": 0, "stability": 0}},
])
def test_invalid_parameters_rejected(config):
    with pytest.raises(ValidationError):
        DispatcherConfig.model_validate(config)


@pytest.mark.parametrize("profile,mode", [("goal-switch", "recommendation"), ("baseline", "co-learning")])
def test_incompatible_profiles_are_rejected(profile, mode):
    with pytest.raises(ValidationError):
        SessionCreateRequest(operator_type="synthetic_dispatcher", dispatcher={"profile": profile}, interaction_mode=mode)


PRESET = "pf-ch-wn-wal-long-approach"


def create(profile="delayed", **params):
    info = create_session(SessionCreateRequest(operator_type="synthetic_dispatcher", dispatcher={"profile": profile, **params},
        scenario_preset_id=PRESET, disturbance_ids=["strategy-e1-breakdown-weesen"]))
    return session_manager.get(info.id)


def test_real_delayed_decision_pause_two_readers_and_takeover():
    session = create(delay=3)
    client = TestClient(app)
    try:
        for _ in range(30):
            response = client.post(f"/session/{session.id}/step", json={"policy": session.policy})
            assert response.status_code == 200, response.text
            if session.dispatcher.pending:
                break
        assert session.dispatcher.pending, "scenario never produced a real decision"
        clock, sim_time = session.dispatcher.clock, session.env._elapsed_steps
        assert client.post(f"/session/{session.id}/pause").status_code == 200
        for _ in range(2):
            assert client.get(f"/session/{session.id}/dispatcher").status_code == 200
            assert client.get(f"/session/{session.id}/state").status_code == 200
        assert (session.dispatcher.clock, session.env._elapsed_steps) == (clock, sim_time)
        assert client.post(f"/session/{session.id}/agent/0/override", json={"action": 4}).status_code == 409
        assert client.post(f"/session/{session.id}/dispatcher/ownership", json={"owner": "human"}).status_code == 200
        assert session.dispatcher.pending is None
        for _ in range(4):
            asyncio.run(step(session.id, StepRequest(policy=session.policy)))
        assert not any(r["status"] == "executed" for r in session.dispatcher.results.values())
        assert session.dispatcher.snapshot(session)["operator_type"] == "mixed"
    finally:
        delete_session(session.id)


def test_direct_command_path_rejects_human_while_agent_owns_role():
    session = create()
    try:
        with pytest.raises(HTTPException) as exc:
            hmi.post_contention_strategy(session.id, hmi.StrategyApplyRequest(strategy="keep"))
        assert exc.value.status_code == 409
    finally:
        delete_session(session.id)


@pytest.mark.parametrize("action", ["stop", "reset", "delete"])
def test_real_lifecycle_invalidates_pending_commands(action):
    session = create(delay=3)
    runtime = session.dispatcher
    client = TestClient(app)
    try:
        for _ in range(30):
            asyncio.run(step(session.id, StepRequest(policy=session.policy)))
            if runtime.pending:
                break
        assert runtime.pending is not None
        decision = deepcopy(runtime.pending)
        if action == "delete":
            response = client.delete(f"/session/{session.id}")
        elif action == "reset":
            response = client.post(f"/session/{session.id}/reset")
        else:
            response = client.post(f"/session/{session.id}/dispatcher/stop")
        assert response.status_code == 200, response.text
        assert runtime.generation > decision["generation"]
        assert runtime.pending is None
        assert runtime.execute(session, decision, runtime.observation)["status"] == "cancelled"
    finally:
        if session_manager.get(session.id):
            delete_session(session.id)


def test_director_without_objective_models_is_not_presented_as_working(monkeypatch):
    from app.policies import goal_directed_policy

    monkeypatch.setattr(goal_directed_policy, "loaded_models", lambda: None)
    with pytest.raises(HTTPException) as exc:
        create_session(SessionCreateRequest(operator_type="synthetic_dispatcher", interaction_mode="director",
                                            scenario_preset_id=PRESET))
    assert exc.value.status_code == 422


@pytest.mark.parametrize("dispatcher", [None, {}, "invalid"])
def test_invalid_batch_condition_remains_visible_and_next_condition_runs(tmp_path, monkeypatch, dispatcher):
    import json

    from app import dispatcher_batch

    async def configured_run(config, _max_pulses):
        if config.get("invalid"):
            SessionCreateRequest(operator_type="synthetic_dispatcher", interaction_mode="co-learning")
        return {"profile": "baseline", "run_status": "finished", "abort_reason": None, "metrics": {"arrived": 3}}

    monkeypatch.setattr(dispatcher_batch, "run", configured_run)
    assert not asyncio.run(dispatcher_batch.main([{"invalid": True, "dispatcher": dispatcher}, {}], tmp_path, 1))
    rejected = json.loads((tmp_path / "01-unknown.json").read_text())
    assert rejected["technical_result"] == "invalid_configuration"
    assert rejected["metrics"] is None
    assert "input" not in rejected["errors"][0]
    comparison = json.loads((tmp_path / "comparison.json").read_text())
    assert [row["run_status"] for row in comparison] == ["error", "finished"]


def test_batch_exports_unexpected_step_failure(tmp_path, monkeypatch):
    from app import dispatcher_batch
    from app.config import settings

    async def failed_step(*_args):
        raise AssertionError("test runtime failure")

    monkeypatch.setattr(settings, "study_records_dir", str(tmp_path))
    monkeypatch.setattr(dispatcher_batch, "step", failed_step)
    result = asyncio.run(dispatcher_batch.run({
        "operator_type": "synthetic_dispatcher", "scenario_preset_id": PRESET,
    }))
    assert result["run_status"] == "error"
    assert result["technical_result"] == "error"
    assert "AssertionError" in result["abort_reason"]
    assert result["simulation_result"] != "complete"
    assert result["metrics"]["simulation_steps"] == 0


@pytest.mark.slow
@pytest.mark.parametrize("profile", ["baseline", "delayed"])
def test_batch_repeat_matches_http_with_two_observers(profile, tmp_path, monkeypatch):
    from app.config import settings
    from app.core.dispatcher import export_run
    from app.dispatcher_batch import run

    monkeypatch.setattr(settings, "study_records_dir", str(tmp_path))
    config = {"operator_type": "synthetic_dispatcher", "dispatcher": {"profile": profile},
              "scenario_preset_id": PRESET, "disturbance_ids": ["strategy-e1-breakdown-weesen"]}
    first = asyncio.run(run(config))
    second = asyncio.run(run(config))
    session = session_manager.get(create_session(SessionCreateRequest.model_validate(config)).id)
    client = TestClient(app)
    try:
        for _ in range(250):
            for _observer in range(2):
                assert client.get(f"/session/{session.id}/dispatcher").status_code == 200
            result = client.post(f"/session/{session.id}/step", json={"policy": session.policy}).json()
            if result.get("episode_done"):
                break
        browser = export_run(session)
    finally:
        delete_session(session.id)

    def normalize(value):
        if isinstance(value, dict):
            return {k: normalize(v) for k, v in value.items() if k != "session_id"}
        if isinstance(value, list):
            return [normalize(v) for v in value]
        return value

    assert first["technical_result"] == second["technical_result"] == browser["technical_result"] == "complete"
    assert first["metrics"] == second["metrics"] == browser["metrics"]
    assert normalize(first["events"]) == normalize(second["events"]) == normalize(browser["events"])


@pytest.mark.slow
def test_real_goal_switch_reaches_committed_controller_plan():
    from app.policies.goal_directed_policy import env_weights, plan_info, plan_player

    session = session_manager.get(create_session(SessionCreateRequest(
        operator_type="synthetic_dispatcher", interaction_mode="director",
        dispatcher={"profile": "goal-switch", "switch_at": 5}, scenario_preset_id=PRESET,
    )).id)
    try:
        for _ in range(6):
            asyncio.run(step(session.id, StepRequest(policy=session.policy)))
        assert env_weights(session.env) == (5, 1, 1)
        assert plan_player(session.env) is not None
        assert plan_info(session.env)["weights"] == [5, 1, 1]
        assert [e["phase"] for e in session.dispatcher.events if e["kind"] == "directive_effective"] == ["initial", "switched"]
    finally:
        delete_session(session.id)
