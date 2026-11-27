"""Frozen preview, real execution proof and exact/idempotent native adoption."""
import asyncio
from copy import deepcopy
from dataclasses import replace
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.core import dispatcher
from app.core.dispatcher import DispatcherConfig, DispatcherRuntime
from app.core.play_manager import PlayState, play_manager
from app.core.session_manager import Session, session_manager
from app.main import app
from app.planners.plan_validation import validate_schedules
from app.policies import goal_directed_policy as director
from app.policies.goal_based_policies import branching, dataset, replan
from app.policies.goal_based_policies.dataset import Layout, build_layout_env
from app.policies.goal_based_policies.schedule import SchedulePlayer

pytestmark = pytest.mark.integration


@pytest.fixture
def held(monkeypatch):
    # Model selection is deterministic here; execution/mission proof and
    # splice/adoption are the real native implementations, not mocked gates.
    env = build_layout_env(Layout(index=0, seed=2001, size=30, cities=2), 1)
    graph = director._director_graph(env)
    schedules = dataset.plan_all_lines(env, graph)
    player = SchedulePlayer(graph, env, schedules)
    env.step(player.act_many())
    # Reuse the native route choices/completion; pick a real executable detour
    # so the positive gate covers drawable geometry rather than a fake marker.
    decision = branching.next_decision(env, graph, branching.initial_prefixes(env, graph), wait_menu=(0,))
    alternatives = [branching.complete_from(env, graph, 0, option.prefix) for option in decision.options]
    changed = next((candidate for candidate in alternatives
                    if candidate and candidate.entries != schedules[0].entries
                    and validate_schedules(env, graph, [candidate]).accepted), None)
    assert changed is not None, "Native fixture has no executable detour"
    session = Session("comparison-test", env, enabled_policy_ids={"goal_directed"})
    session.policy = "goal_directed"
    director._PLAYERS[env] = player
    director._SCHEDULES[env] = schedules
    director._ENV_WEIGHTS[env] = (2.0, 2.0, 5.0)
    director._PLAN_INFO[env] = {"source": "search", "weights": [2, 2, 5], "utilities": {"stability": 0.7}}
    director._replan_state(env)["weights_dirty"] = True
    monkeypatch.setattr(dispatcher, "capture_provenance", dict)
    config = DispatcherConfig(**dispatcher.PREPARED_DEMOS["director"]["dispatcher"])
    session.dispatcher = runtime = DispatcherRuntime(session, config, "director")
    runtime.clock = 1
    runtime.directives.add("initial")
    monkeypatch.setitem(session_manager._sessions, session.id, session)
    monkeypatch.setattr(director, "loaded_models", lambda: (object(), object()))
    searches = []

    def residual(fork, *_args, schedules, **_kwargs):
        assert fork is not env
        searches.append(fork)
        chosen = [deepcopy(changed)]
        return replan.ResidualPlan(
            schedules=chosen, tails={}, source="research", considered={"research": 0.9, "continue": 0.8},
            score=SimpleNamespace(weighted=0.9, breakdown={"utilities": {"punctuality": 0.9, "connections": 1, "stability": 0.6}}),
            trace=[], decisions=1, step=int(fork._elapsed_steps), reason="weights change",
        )

    monkeypatch.setattr(replan, "residual_plan", residual)
    assert not runtime.pulse(session)
    assert runtime.comparison.data["phase"] == "waiting"
    yield session, runtime, searches
    play_manager._states.pop(session.id, None)


def body(runtime):
    return {key: runtime.comparison.data[key] for key in ("command_id", "generation")}


def ready(session, runtime):
    runtime.comparison.prepare(session, **body(runtime))
    assert runtime.comparison.data["phase"] == "ready", (runtime.comparison.data["reason"], runtime.comparison.data["validation"],
                                                         (runtime.comparison.data["alternative"] or {}).get("divergence"))
    return {**body(runtime), "token": runtime.comparison.data["token"]}


def test_prepared_only_setting_and_unsupported_staffing_are_rejected(monkeypatch):
    assert dispatcher.PREPARED_DEMOS["director"]["dispatcher"]["comparison"] is True
    assert all(not recipe["dispatcher"]["comparison"] for key, recipe in dispatcher.PREPARED_DEMOS.items() if key != "director")
    with pytest.raises(ValueError, match="goal-switch"):
        DispatcherConfig(comparison=True)
    cfg = DispatcherConfig(profile="goal-switch", comparison=True)
    for mode, operator in [("recommendation", "synthetic_dispatcher"), ("director", "human_dispatcher_team")]:
        with pytest.raises(ValueError, match="synthetic Director"):
            DispatcherRuntime(SimpleNamespace(), cfg, mode, operator_type=operator)


def test_reads_held_steps_and_batched_steps_never_advance_either_clock(held):
    from app.api.sessions import StepRequest, _step_sync
    from app.api.websockets import _dispatcher_pulse

    session, runtime, searches = held
    before = (session.env._elapsed_steps, runtime.clock, director.plan_player(session.env).snapshot())
    for _ in range(3):
        assert runtime.snapshot(session)["comparison"]["phase"] == "waiting"
        assert not runtime.pulse(session)
    _step_sync(session.id, StepRequest(n_steps=10, policy="goal_directed"))
    state = PlayState(session.id, 5, session.policy)
    state.running = True
    _dispatcher_pulse(session, state, None, None)
    assert not state.running
    assert (session.env._elapsed_steps, runtime.clock, director.plan_player(session.env).snapshot()) == before
    assert searches == []


def test_prepared_opening_builds_only_after_its_explicit_initial_directive(held, monkeypatch):
    from app.api import sessions

    session, runtime, _ = held
    env = session.env
    player, schedules = director.plan_player(env), director.plan_schedules(env)
    runtime.comparison = runtime.pending = None
    runtime.clock = 0
    runtime.directives.clear()
    env._elapsed_steps = 0
    director._ENV_WEIGHTS[env] = (1, 1, 1)
    director._PLAYERS.pop(env)
    director._SCHEDULES.pop(env)
    director._PLAN_INFO.pop(env)
    builds = []

    def initial(_sid, request):
        weights = (request.punctuality, request.connections, request.stability)
        assert weights == (2, 2, 5)
        assert not builds
        director._ENV_WEIGHTS[env] = weights
        director._PLAYERS[env] = player
        director._SCHEDULES[env] = schedules
        director._PLAN_INFO[env] = {"source": "search", "weights": list(weights)}
        return {"replanned": True, "plan": director.plan_info(env)}

    def build(*_args):
        builds.append(director.env_weights(env))
        return SimpleNamespace(start_step=lambda: None, end_step=lambda: None,
                               act_many=lambda handles, observations: player.act_many(handles))

    monkeypatch.setattr(sessions, "set_director_weights_for_session", initial)
    monkeypatch.setattr(sessions, "_build_policy", build)
    sessions._step_sync(session.id, sessions.StepRequest(n_steps=1, policy="goal_directed"))
    assert builds == [(2, 2, 5)]
    assert env._elapsed_steps == 1 and runtime.clock == 1
    assert runtime.metrics(session)["executed"] == 1


def test_real_proof_preserves_live_state_then_installs_exact_candidate_once(held):
    session, runtime, searches = held
    env = session.env
    player = director.plan_player(env)
    original = deepcopy(player.snapshot())
    original_schedules = deepcopy(director.plan_schedules(env))
    original_info = deepcopy(director.plan_info(env))
    commit = ready(session, runtime)
    comparison = runtime.comparison.snapshot()
    assert comparison["validation"]["accepted"]
    assert comparison["validation"]["arrived"] == comparison["validation"]["total"] == 1
    assert comparison["alternative"]["divergence"]["reroutes"]
    assert comparison["current"]["utilities"] is comparison["current"]["reported"] is None
    assert player.snapshot() == original
    assert director.plan_schedules(env) == original_schedules
    assert director.plan_info(env) == original_info
    assert director._replan_state(env)["weights_dirty"]
    assert director.env_weights(env) == (2, 2, 5)
    runtime.comparison.prepare(session, **body(runtime))
    assert len(searches) == 1
    runtime.comparison.commit(session, **commit)
    assert director.plan_paths(env) == comparison["alternative"]["paths"]
    assert director.env_weights(env) == (5, 2, 2)
    assert not director._replan_state(env)["weights_dirty"]
    assert env._elapsed_steps == 1 and runtime.clock == 2
    assert runtime.pending is None
    assert runtime.metrics(session)["executed"] == 1
    assert runtime.metrics(session)["effective_goal_changes"] == 1
    runtime.comparison.commit(session, **commit)
    runtime.comparison.commit(session, **commit)
    assert len(searches) == 1 and runtime.metrics(session)["executed"] == 1


@pytest.mark.parametrize("mutation", ["step", "player", "schedule", "weights", "control", "policy", "physical", "malfunction", "plan_info"])
def test_stale_prepared_candidate_cannot_write_weights_or_player(held, mutation):
    session, runtime, _ = held
    commit = ready(session, runtime)
    env = session.env
    if mutation == "step":
        env._elapsed_steps += 1
    elif mutation == "player":
        director._PLAYERS[env] = SchedulePlayer(director.plan_player(env).graph, env)
    elif mutation == "schedule":
        director.plan_schedules(env)[0].entries.append(director.plan_schedules(env)[0].entries[-1])
    elif mutation == "weights":
        director.set_env_weights(env, 1, 5, 1)
    elif mutation == "control":
        session.control_revision += 1
    elif mutation == "policy":
        session.policy = "random"
    elif mutation == "physical":
        env.agents[0].earliest_departure += 1
    elif mutation == "malfunction":
        env.agents[0].malfunction_handler.malfunction_down_counter = 7
    else:
        director.plan_info(env)["source"] = "different-plan"
    weights, snapshot = director.env_weights(env), director.plan_player(env).snapshot()
    with pytest.raises(HTTPException) as exc:
        runtime.comparison.commit(session, **commit)
    assert exc.value.status_code == 409
    assert runtime.comparison.data["phase"] == "cancelled"
    assert director.env_weights(env) == weights
    assert director.plan_player(env).snapshot() == snapshot
    assert runtime.metrics(session)["executed"] == 0


def test_bad_token_and_wrong_request_do_not_cancel_or_mutate_ready_candidate(held):
    session, runtime, _ = held
    commit = ready(session, runtime)
    for changed in ({"token": "wrong"}, {"generation": commit["generation"] + 1}, {"command_id": "wrong"}):
        with pytest.raises(HTTPException) as exc:
            runtime.comparison.commit(session, **{**commit, **changed})
        assert exc.value.status_code == 409
    assert runtime.comparison.data["phase"] == "ready"
    assert director.env_weights(session.env) == (2, 2, 5)


@pytest.mark.parametrize("case", ["execution", "identical"])
def test_unchecked_or_undrawable_candidate_is_unavailable(held, monkeypatch, case):
    session, runtime, searches = held
    original = replan.residual_plan

    def candidate(*args, **kwargs):
        result = original(*args, **kwargs)
        if case == "execution":
            result.schedules[0].entries[0] = replace(result.schedules[0].entries[0], wait=10000)
        else:
            result.schedules = deepcopy(kwargs["schedules"])
        return result

    monkeypatch.setattr(replan, "residual_plan", candidate)
    runtime.comparison.prepare(session, **body(runtime))
    assert runtime.comparison.data["phase"] == "unavailable"
    assert runtime.comparison.data["token"] is None
    if case == "execution":
        assert not runtime.comparison.data["validation"]["accepted"]
    with pytest.raises(HTTPException):
        runtime.comparison.commit(session, **body(runtime), token="invented")
    assert len(searches) == 1 and director.env_weights(session.env) == (2, 2, 5)


def test_failed_native_adoption_rolls_back_every_driving_cache(held, monkeypatch):
    session, runtime, _ = held
    commit = ready(session, runtime)
    env = session.env
    player = director.plan_player(env)
    before = deepcopy(player.snapshot()), deepcopy(director.plan_info(env)), director.plan_schedules(env)
    original = director._adopt_replan_candidate

    def fail_after_install(*args):
        original(*args)
        raise RuntimeError("failed after native installation")

    monkeypatch.setattr(director, "_adopt_replan_candidate", fail_after_install)
    with pytest.raises(HTTPException):
        runtime.comparison.commit(session, **commit)
    assert director.env_weights(env) == (2, 2, 5)
    assert player.snapshot() == before[0] and director.plan_info(env) == before[1]
    assert director.plan_schedules(env) is before[2]
    assert director._replan_state(env)["weights_dirty"]
    assert runtime.metrics(session)["executed"] == 0


def test_public_prepare_commit_idempotence_and_invalid_play_purity(held):
    session, runtime, searches = held
    client = TestClient(app)
    url = f"/session/{session.id}/dispatcher/comparison"
    assert client.post(url + "/prepare", json={**body(runtime), "generation": 50}).status_code == 409
    assert runtime.comparison.data["phase"] == "waiting" and searches == []
    response = client.post(url + "/prepare", json=body(runtime))
    assert response.status_code == 200, response.text
    state = response.json()
    assert state["comparison"]["phase"] == "ready"
    assert client.post(f"/session/{session.id}/play", json={"speed": "invalid"}).status_code == 422
    assert client.post(f"/session/{session.id}/play", content='{"policy":"goal_directed"}',
                       headers={"content-type": "text/plain"}).status_code == 422
    assert client.post(f"/session/{session.id}/play", json={"policy": "do_nothing"}).status_code == 400
    assert runtime.comparison.data["phase"] == "ready"
    request = {**body(runtime), "token": state["comparison"]["token"]}
    for _ in range(3):
        response = client.post(url + "/commit", json=request)
        assert response.status_code == 200, response.text
        assert response.json()["comparison"]["phase"] == "committed"
    assert len(searches) == runtime.metrics(session)["executed"] == 1
    assert not play_manager.is_playing(session.id)


def test_automatic_resume_capability_is_one_use_and_manual_pause_revokes_it(held):
    session, runtime, _ = held
    commit = ready(session, runtime)
    runtime.comparison.commit(session, **commit)
    client = TestClient(app)
    request = {"policy": "goal_directed", "speed": 1, "comparison_token": commit["token"]}
    response = client.post(f"/session/{session.id}/play", json=request)
    assert response.status_code == 200, response.text
    assert not runtime.comparison.resume_allowed
    client.post(f"/session/{session.id}/pause")
    state = session.env._elapsed_steps, runtime.clock
    response = client.post(f"/session/{session.id}/play", json=request)
    assert response.status_code == 409
    assert not play_manager.is_playing(session.id)
    assert (session.env._elapsed_steps, runtime.clock) == state


@pytest.mark.parametrize("operation", ["pause", "takeover", "manual_play", "reset"])
def test_late_dispatched_automatic_play_cannot_undo_human_control(held, operation):
    session, runtime, _ = held
    commit = ready(session, runtime)
    runtime.comparison.commit(session, **commit)
    client = TestClient(app)
    if operation == "takeover":
        client.post(f"/session/{session.id}/dispatcher/ownership", json={"owner": "human"})
    elif operation == "manual_play":
        response = client.post(f"/session/{session.id}/play", json={"policy": "goal_directed"})
        assert response.status_code == 200
        client.post(f"/session/{session.id}/pause")
    else:
        client.post(f"/session/{session.id}/{operation}")
    if operation == "pause":
        # Retrying Commit remains idempotent and cannot re-arm auto resume.
        runtime.comparison.commit(session, **commit)
    assert not runtime.comparison.resume_allowed
    before = session.env._elapsed_steps, runtime.clock, director.env_weights(session.env)
    response = client.post(f"/session/{session.id}/play", json={
        "policy": "goal_directed", "comparison_token": commit["token"],
    })
    assert response.status_code == 409, response.text
    assert not play_manager.is_playing(session.id)
    assert (session.env._elapsed_steps, runtime.clock, director.env_weights(session.env)) == before


@pytest.mark.parametrize("change", ["step", "plan", "control"])
def test_post_adoption_resume_is_bound_to_unchanged_native_state(held, change):
    session, runtime, _ = held
    commit = ready(session, runtime)
    runtime.comparison.commit(session, **commit)
    if change == "step":
        session.env._elapsed_steps += 1
    elif change == "plan":
        director.plan_player(session.env)._waited[0] += 1
    else:
        session.control_revision += 1
    response = TestClient(app).post(f"/session/{session.id}/play", json={
        "policy": "goal_directed", "comparison_token": commit["token"],
    })
    assert response.status_code == 409
    assert not play_manager.is_playing(session.id)
    assert runtime.comparison.data["phase"] == "committed"


def test_automatic_play_cannot_release_an_uncommitted_preview(held):
    session, runtime, _ = held
    commit = ready(session, runtime)
    response = TestClient(app).post(f"/session/{session.id}/play", json={
        "policy": "goal_directed", "comparison_token": commit["token"],
    })
    assert response.status_code == 409
    assert runtime.comparison.data["phase"] == "ready" and runtime.pending is not None
    assert director.env_weights(session.env) == (2, 2, 5)


@pytest.mark.parametrize("adopted", [False, True])
def test_fresh_delegation_uses_normal_director_after_one_shot_comparison(held, monkeypatch, adopted):
    from app.planners.plan_validation import validate_player

    session, runtime, searches = held
    old_token = ready(session, runtime)
    old_comparison = runtime.comparison
    original_config = runtime.config
    if adopted:
        old_comparison.commit(session, **old_token)
    executed_before = runtime.metrics(session)["executed"]
    runtime.invalidate(session, "takeover", human=True)
    runtime.hand_back(session)
    assert runtime.mixed and runtime.snapshot(session)["mixed"] is True
    assert runtime.config is original_config and runtime.config.comparison is True
    with pytest.raises(HTTPException):
        old_comparison.commit(session, **old_token)
    with pytest.raises(HTTPException):
        old_comparison.validate_resume(session, old_token["token"])

    # Normal Director directives still use the native human command operation.
    # Only model selection is controlled; native splice/adoption and its real
    # execution gate remain in place for the fresh delegated command.
    original_search = replan.residual_plan

    def native_choice(source, *args, **kwargs):
        return original_search(deepcopy(source) if source is session.env else source, *args, **kwargs)

    monkeypatch.setattr(director, "_load_models", lambda: (object(), object()))
    monkeypatch.setattr(replan, "residual_plan", native_choice)
    assert runtime.pulse(session)
    assert runtime.comparison is old_comparison and not old_comparison.held
    assert runtime.pending is None
    assert director.env_weights(session.env) == (5, 2, 2)
    assert runtime.metrics(session)["executed"] == executed_before + 1
    assert validate_player(session.env, director.plan_player(session.env)).accepted
    runtime.after_step(session, False)
    assert runtime.pulse(session)
    assert len(searches) == 2
    assert sum(event["kind"] == "comparison_waiting" for event in runtime.events) == 1
    assert runtime.comparison is old_comparison and runtime.pending is None


def test_new_weights_during_malfunction_proof_remain_dirty_after_stale_veto(held, monkeypatch):
    from app.planners import plan_validation

    session, runtime, _ = held
    env = session.env
    before = director.plan_player(env).snapshot()
    plan = replan.residual_plan(deepcopy(env), schedules=deepcopy(director.plan_schedules(env)))
    plan.reason = "malfunction"
    original = plan_validation.validate_player

    def changed_during_proof(*args, **kwargs):
        result = original(*args, **kwargs)
        assert result.accepted
        director.set_env_weights(env, 1, 5, 1)
        return result

    monkeypatch.setattr(plan_validation, "validate_player", changed_during_proof)
    event = director._finish_replan(env, plan, gate=False)
    assert event["gate"] == "execution-stale"
    assert event["source"] == "continue"
    assert director.plan_player(env).snapshot() == before
    assert director._replan_state(env)["weights_dirty"]
    assert director.env_weights(env) == (1, 5, 1)
    assert runtime.metrics(session)["executed"] == 0


@pytest.mark.parametrize("operation", ["pause", "play", "takeover", "reset"])
def test_explicit_native_control_invalidates_ready_preview(held, operation):
    session, runtime, _ = held
    commit = ready(session, runtime)
    client = TestClient(app)
    if operation == "takeover":
        response = client.post(f"/session/{session.id}/dispatcher/ownership", json={"owner": "human"})
    elif operation == "play":
        response = client.post(f"/session/{session.id}/play", json={"policy": "goal_directed", "speed": 1})
        client.post(f"/session/{session.id}/pause")
    else:
        response = client.post(f"/session/{session.id}/{operation}")
    assert response.status_code == 200, response.text
    assert runtime.comparison.data["phase"] == "cancelled"
    assert runtime.pending is None
    with pytest.raises(HTTPException):
        runtime.comparison.commit(session, **commit)
    assert runtime.metrics(session)["executed"] == 0


def test_takeover_during_native_preparation_prevents_late_ready_or_commit(held, monkeypatch):
    async def exercise():
        session, runtime, _ = held
        original = replan.residual_plan
        entered, release = Event(), Event()

        def blocked(*args, **kwargs):
            entered.set()
            assert release.wait(3)
            return original(*args, **kwargs)

        monkeypatch.setattr(replan, "residual_plan", blocked)
        task = asyncio.create_task(asyncio.to_thread(runtime.comparison.prepare, session, **body(runtime)))
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            runtime.invalidate(session, "takeover", human=True)
            release.set()
            await task
            assert runtime.comparison.data["phase"] == "cancelled"
            assert runtime.comparison.data["token"] is None
            assert runtime.owner == "human" and runtime.pending is None
            assert director.env_weights(session.env) == (2, 2, 5)
            assert runtime.metrics(session)["executed"] == 0
        finally:
            release.set()
            await task

    asyncio.run(exercise())
