"""Queue fairness, referenced native operations and measured-run evidence."""
import asyncio
from copy import deepcopy
from datetime import datetime
from threading import Event
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.api import hmi, sessions
from app.config import settings
from app.core import contention_strategies as strategies
from app.core import dispatcher
from app.core.contention_identity import contention_identity
from app.core.contention_strategies import contention_strategies as real_strategies
from app.core.dispatcher import DispatcherConfig, DispatcherRuntime, export_run
from app.core.play_manager import PlayState, play_manager
from app.core.session_manager import session_manager
from app.main import app
from app.models.session import SessionCreateRequest

pytestmark = pytest.mark.integration


def group(handles, window, step=10):
    return {"handles": handles, "window": window, "step": step,
            "location": {"kind": "cell", "name": None, "cell": window[0]}}


FIRST = group([0, 1], [[1, 2], [1, 3]])
SECOND = group([2, 3], [[5, 6]], 12)


def fake(monkeypatch, *, team=False, mode="recommendation", **config):
    manifest = {"code_version": "code-a", "controller_version": "code-a",
                "controller_models": {"model": "model-a"}, "flatland_version": "test",
                "provenance": {"capture": "runtime_creation", "captured_at": "start"}}
    monkeypatch.setattr(dispatcher, "capture_provenance", lambda: deepcopy(manifest))
    session = SimpleNamespace(id="queue-test", env=SimpleNamespace(_elapsed_steps=7, _max_episode_steps=100,
        agents=[SimpleNamespace(state=SimpleNamespace(name="MOVING"), latest_arrival=20) for _ in range(4)]),
        policy="goal_directed" if mode == "director" else "random", enabled_policy_ids={"random", "goal_directed"},
        enabled_scenario_policies={"random"}, command_lock=asyncio.Lock(), control_revision=0,
        seed=42, scenario_preset_id="test", disturbances=[], run=None, started_at=datetime.now().astimezone())
    runtime = DispatcherRuntime(session, DispatcherConfig(**config), mode,
        operator_type="human_dispatcher_team" if team or mode == "co-learning" else "synthetic_dispatcher")
    session.dispatcher = runtime
    runtime.planned_arrivals = {0: 10}
    visible = [deepcopy(FIRST), deepcopy(SECOND)]
    monkeypatch.setattr(hmi, "get_contentions", lambda _: {"groups": deepcopy(visible)})
    applied, offered = [], []

    def options(_sid, _session, _priority=None, contention_id=None):
        offered.append(contention_id)
        return {"contention_id": contention_id, "recommended": "pp", "horizonSteps": 100, "step": _session.env._elapsed_steps,
                "forecast_reference": {"source": "plan", "reference_steps": {0: 18}},
                "strategies": [
                    {"id": "keep", "priority": None, "passOrder": [0, 1], "metrics": {"lateness": 20, "arrived": 2, "deadlocks": 0}},
                    {"id": "pp", "priority": [0, 1] if contention_id == contention_identity(FIRST) else [2, 3],
                     "passOrder": [1, 0], "metrics": {"lateness": 8, "arrived": 4, "deadlocks": 0}}]}

    monkeypatch.setattr(strategies, "contention_strategies", options)
    monkeypatch.setattr(hmi, "post_contention_strategy", lambda _sid, request: applied.append(request) or {"applied": request.strategy})
    return session, runtime, visible, applied, offered, manifest


def test_contention_identity_ignores_time_order_and_duplicate_cells():
    original = group([0, 1], [[1, 2], [1, 3]])
    reordered = group([1, 0, 1], [[1, 3], [1, 2], [1, 2]], 99)
    assert contention_identity(original) == contention_identity(reordered)
    assert contention_identity(original) != contention_identity(group([0, 2], [[1, 2], [1, 3]]))
    assert contention_identity(original) != contention_identity(group([0, 1], [[1, 2]]))


def test_answered_first_group_cannot_starve_second_and_reference_reaches_apply(monkeypatch):
    session, runtime, _, applied, offered, _ = fake(monkeypatch)
    assert runtime.pulse(session)
    assert runtime.pulse(session)
    expected = [contention_identity(FIRST), contention_identity(SECOND)]
    assert offered == expected
    assert [request.contention_id for request in applied] == expected
    assert [entry["status"] for entry in runtime.queue] == ["answered", "answered"]
    assert runtime.metrics(session)["planned"] == 2
    assert runtime.metrics(session)["opportunities"] == 2


def test_absent_answered_group_can_recur_while_other_group_remains(monkeypatch):
    session, runtime, visible, applied, _, _ = fake(monkeypatch)
    runtime.pulse(session)
    visible[:] = [deepcopy(SECOND)]
    runtime.pulse(session)
    visible[:] = [deepcopy(FIRST), deepcopy(SECOND)]
    runtime.pulse(session)
    assert [request.contention_id for request in applied] == [contention_identity(FIRST), contention_identity(SECOND), contention_identity(FIRST)]
    assert runtime.metrics(session)["planned"] == 3


def test_unavailable_first_group_is_explicit_and_does_not_starve_second(monkeypatch):
    session, runtime, _, applied, _, _ = fake(monkeypatch)
    existing = strategies.contention_strategies

    def options(*args, contention_id=None):
        if contention_id == contention_identity(FIRST):
            return {"strategies": []}
        return existing(*args, contention_id=contention_id)

    monkeypatch.setattr(strategies, "contention_strategies", options)
    assert runtime.pulse(session)
    assert applied[0].contention_id == contention_identity(SECOND)
    assert runtime.queue[0]["status"] == "unavailable"
    assert any(event["kind"] == "contention_unavailable" for event in runtime.events)
    monkeypatch.setattr(strategies, "contention_strategies", existing)
    session.env._elapsed_steps += 1
    runtime.pulse(session)
    assert applied[-1].contention_id == contention_identity(FIRST)


def test_team_pending_survives_urgency_reordering_but_never_retargets_a_disappeared_group(monkeypatch):
    session, runtime, visible, applied, _, _ = fake(monkeypatch, team=True)
    assert not runtime.pulse(session)
    pending = deepcopy(runtime.pending)
    visible.reverse()
    assert not runtime.pulse(session)
    assert runtime.pending == pending
    runtime.decide(session, pending["command_id"], pending["generation"], "approve")
    visible[:] = [deepcopy(SECOND)]
    assert runtime.pulse(session)
    assert applied == []
    assert runtime.metrics(session)["stale"] == 1
    assert not runtime.pulse(session)
    assert runtime.pending["command"]["contention_id"] == contention_identity(SECOND)
    assert runtime.pending["command_id"] != pending["command_id"]
    assert runtime.awaiting_approval


def test_declined_first_group_yields_next_team_proposal_without_automatic_execution(monkeypatch):
    session, runtime, _, applied, _, _ = fake(monkeypatch, team=True)
    runtime.pulse(session)
    pending = deepcopy(runtime.pending)
    runtime.decide(session, pending["command_id"], pending["generation"], "decline")
    assert not runtime.pulse(session)
    assert runtime.pending["command"]["contention_id"] == contention_identity(SECOND)
    assert applied == []
    assert runtime.metrics(session)["declined"] == 1


def test_co_learning_queue_does_not_choose_or_generate_ranked_options(monkeypatch):
    session, runtime, _, _, _, _ = fake(monkeypatch, mode="co-learning")
    monkeypatch.setattr(runtime, "choose", lambda *_: pytest.fail("neutral partner chose"))
    monkeypatch.setattr(strategies, "contention_strategies", lambda *_args, **_kwargs: pytest.fail("neutral partner scored"))
    assert runtime.pulse(session)
    assert len(runtime.queue) == 2
    assert runtime.owner == "human"
    assert runtime.pending is None
    assert "preferred" not in runtime.observation


def test_forecast_explanation_and_actual_effects_are_separate_and_noncausal(monkeypatch):
    session, runtime, _, _, _, _ = fake(monkeypatch)
    runtime.pulse(session)
    planned = next(event for event in runtime.events if event["kind"] == "planned")["decision"]
    evidence = planned["explanation"]
    assert evidence["forecast_step"] == 7  # When this forecast was computed.
    assert evidence["conflict_step"] == 10  # The later predicted incident.
    assert evidence["horizon_steps"] == 100
    assert evidence["baseline_metrics"]["lateness"] == 20
    assert evidence["selected_metrics"]["lateness"] == 8
    assert evidence["forecast_delta"]["lateness"] == -12
    assert evidence["forecast_reference"] == {"source": "plan", "reference_steps": {0: 18}}
    assert runtime.snapshot(session)["arrival_reference_source"] == "latest_arrival"
    # A later observer cannot change the reference attached to this decision.
    runtime.observation["strategy_offer"]["forecast_reference"]["reference_steps"][0] = 99
    assert evidence["forecast_reference"]["reference_steps"] == {0: 18}
    session.env._elapsed_steps = 23
    session.env.agents[0].state.name = "DONE"
    runtime.after_step(session, False)
    effect = runtime.effects[planned["command_id"]]
    assert effect["causal_claim"] is False
    assert effect["scope"] == "observed_since_command"
    assert effect["after"]["arrived"] == 1
    assert effect["after"]["total_arrival_delay"] == 13
    assert effect["after"]["delay_denominator"] == 1
    assert effect["delta"]["arrived"] == 1
    assert effect["contention_observation"]["simulation_time"] == 7


def test_monotonic_receipt_records_pause_time_without_advancing_either_clock(monkeypatch):
    now = [1_000_000_000]
    monkeypatch.setattr(dispatcher, "monotonic_ns", lambda: now[0])
    session, runtime, _, applied, _, _ = fake(monkeypatch, team=True)
    now[0] += 200_000_000
    runtime.pulse(session)
    proposal = deepcopy(runtime.pending)
    assert proposal["elapsed_ms"] == 200
    runtime.status = "paused"
    clocks = (runtime.clock, session.env._elapsed_steps)
    now[0] += 600_000_000
    runtime.decide(session, proposal["command_id"], proposal["generation"], "approve")
    assert runtime.approvals[proposal["command_id"]]["elapsed_ms"] == 800
    assert runtime.events[-1]["elapsed_ms"] == 800
    assert (runtime.clock, session.env._elapsed_steps) == clocks
    assert applied == []


def test_proportional_director_weights_do_not_count_as_a_changed_goal(monkeypatch):
    session, runtime, _, _, _, _ = fake(monkeypatch, mode="director", profile="goal-switch", switch_at=2,
        switched={"punctuality": 2, "connections": 2, "stability": 2})
    weights = [1, 1, 1]
    info = {"weights": weights[:], "source": "research"}

    def apply(_sid, request):
        weights[:] = [request.punctuality, request.connections, request.stability]
        info["weights"] = weights[:]
        return {"replanned": True, "plan": deepcopy(info)}

    monkeypatch.setattr("app.policies.goal_directed_policy.env_weights", lambda _: tuple(weights))
    monkeypatch.setattr("app.policies.goal_directed_policy.plan_info", lambda _: deepcopy(info))
    monkeypatch.setattr("app.policies.goal_directed_policy.plan_player", lambda _: object())
    monkeypatch.setattr(sessions, "set_director_weights_for_session", apply)
    for _ in range(2):
        runtime.pulse(session)
        runtime.after_step(session, False)
    assert runtime.metrics(session)["effective_directives"] == 2
    assert runtime.metrics(session)["effective_goal_changes"] == 0
    for _ in range(35):
        runtime.event(session, "later_observation")
    snapshot = runtime.snapshot(session)
    assert not any(event["kind"] in ("result", "directive_effective") for event in snapshot["events"])
    assert snapshot["last_result"]["result"]["status"] == "executed"
    assert snapshot["last_effective"]["weights"] == [2, 2, 2]


def test_final_policy_and_start_versions_are_not_relabelled_by_later_operation(monkeypatch, tmp_path):
    session, runtime, _, _, _, manifest = fake(monkeypatch)
    monkeypatch.setattr(settings, "study_records_dir", str(tmp_path))
    runtime.pulse(session)
    runtime.invalidate(session, "stop", human=True)
    runtime.run_status, runtime.abort_reason = "aborted", "stop"
    before = export_run(session)
    manifest["code_version"] = "code-b"
    manifest["controller_models"]["model"] = "model-b"
    session.policy = "goal_directed"
    after = export_run(session)
    assert after["code_version"] == before["code_version"] == "code-a"
    assert after["controller_models"] == before["controller_models"] == {"model": "model-a"}
    assert after["policy"] == before["policy"] == "random"
    assert after["current_policy"] == "goal_directed"
    assert after["metrics"] == before["metrics"]
    assert after["summary"] == before["summary"]


def test_deadlines_are_frozen_when_no_authored_plan_and_nonarrivals_are_not_zero_delay(monkeypatch, tmp_path):
    session, _, _, _, _, _ = fake(monkeypatch)
    monkeypatch.setattr("app.policies.plan_policy.planned_arrival_steps", lambda _: {})
    runtime = DispatcherRuntime(session, DispatcherConfig(), "recommendation")
    session.dispatcher = runtime
    assert runtime.planned_arrivals == {0: 20, 1: 20, 2: 20, 3: 20}
    assert runtime.metrics(session)["total_arrival_delay"] is None
    assert runtime.metrics(session)["delay_denominator"] == 0
    # A later deadline mutation cannot relabel the original timetable reference.
    session.env.agents[0].latest_arrival = 99
    session.env._elapsed_steps = 23
    session.env.agents[0].state.name = "DONE"
    runtime.after_step(session, False)
    assert runtime.metrics(session)["total_arrival_delay"] == 3
    assert runtime.metrics(session)["delay_denominator"] == 1
    assert runtime.metrics(session)["arrived"] == 1
    monkeypatch.setattr("app.core.study_paths.session_dir", lambda _: tmp_path)
    assert export_run(session)["arrival_reference"] == {"source": "latest_arrival",
        "reference_steps": {0: 20, 1: 20, 2: 20, 3: 20}, "actual_arrival_steps": {0: 23}}


def test_authored_plan_arrivals_take_precedence_over_generated_deadlines(monkeypatch):
    session, _, _, _, _, _ = fake(monkeypatch)
    monkeypatch.setattr("app.policies.plan_policy.planned_arrival_steps", lambda _: {0: 12})
    runtime = DispatcherRuntime(session, DispatcherConfig(), "recommendation")
    assert runtime.planned_arrivals == {0: 12}
    assert runtime.arrival_reference_source == "authored_plan"


def test_missing_plan_and_deadlines_are_explicitly_unavailable(monkeypatch, tmp_path):
    session, _, _, _, _, _ = fake(monkeypatch)
    monkeypatch.setattr("app.policies.plan_policy.planned_arrival_steps", lambda _: {})
    for agent in session.env.agents:
        agent.latest_arrival = None
    session.dispatcher = runtime = DispatcherRuntime(session, DispatcherConfig(), "recommendation")
    session.env.agents[0].state.name = "DONE"
    runtime.after_step(session, False)
    monkeypatch.setattr("app.core.study_paths.session_dir", lambda _: tmp_path)
    exported = export_run(session)
    assert exported["arrival_reference"] == {"source": "unavailable", "reference_steps": {},
                                            "actual_arrival_steps": {0: 7}}
    assert exported["metrics"]["arrived"] == 1
    assert exported["metrics"]["total_arrival_delay"] is None
    assert exported["metrics"]["delay_denominator"] == 0


@pytest.mark.parametrize("path,payload,method,expected", [
    ("/dispatcher/ownership", {"owner": "invalid"}, "POST", 422),
    ("/dispatcher/ownership", None, "POST", 422),
    ("/dispatcher/stop", {"reason": "invalid"}, "POST", 422),
    ("/dispatcher/ownership", {"owner": "human"}, "PUT", 405),
    ("/unknown", None, "DELETE", 404),
])
def test_rejected_controls_do_not_stop_or_cancel_work(monkeypatch, path, payload, method, expected):
    session = SimpleNamespace(id="invalid-control-test", command_lock=asyncio.Lock(), command_cancel=Event(),
                              dispatcher=SimpleNamespace(owner="agent", event=lambda *_args, **_kwargs: None))
    monkeypatch.setitem(session_manager._sessions, session.id, session)
    state = PlayState(session.id, 1, "random")
    state.running = True
    play_manager.register(state)
    try:
        response = TestClient(app).request(method, f"/session/{session.id}{path}", json=payload)
        assert response.status_code == expected, response.text
        assert state.running
        assert not session.command_cancel.is_set()
    finally:
        play_manager._states.pop(session.id, None)


@pytest.mark.parametrize("case", ["neutral", "terminal", "director_missing", "director_disabled"])
def test_rejected_delegation_preserves_playback_and_never_waits_for_the_writer_lock(monkeypatch, case):
    mode = "co-learning" if case == "neutral" else "director" if case.startswith("director") else "recommendation"
    session, runtime, _, _, _, _ = fake(monkeypatch, mode=mode)
    runtime.owner = "human"
    session.command_cancel = Event()
    if case == "terminal":
        runtime.run_status, runtime.abort_reason = "aborted", "stop"
        runtime.freeze_measurements(session)
    if case == "director_disabled":
        session.enabled_policy_ids.discard("goal_directed")
    monkeypatch.setattr("app.policies.goal_directed_policy.loaded_models", lambda: None)

    class UnavailableWriterLock:
        async def __aenter__(self):
            pytest.fail("A rejected delegation must not wait for the writer lock")

        async def __aexit__(self, *_):
            pass

    session.command_lock = UnavailableWriterLock()
    monkeypatch.setitem(session_manager._sessions, session.id, session)
    state = PlayState(session.id, 1, session.policy)
    state.running = True
    play_manager.register(state)
    event_count = len(runtime.events)
    try:
        response = TestClient(app).post(f"/session/{session.id}/dispatcher/ownership", json={"owner": "agent"})
        assert response.status_code == 409, response.text
        assert isinstance(response.json()["detail"], str)
        assert state.running and not session.command_cancel.is_set()
        assert runtime.owner == "human" and len(runtime.events) == event_count
    finally:
        play_manager._states.pop(session.id, None)


def test_generated_pp_plan_enables_its_policy_only_after_successful_install(monkeypatch):
    session = SimpleNamespace(id="generated-plan", env=object(), dispatcher=None,
                              policy="random", enabled_policy_ids={"random"})
    from app.policies.registry import PLAN_POLICY_ID
    installed = []
    monkeypatch.setattr("app.planners.replan.replan_from_state", lambda *_args, **_kwargs: None)
    with pytest.raises(LookupError):
        strategies.apply_strategy(session.id, session, "pp", [0, 1])
    assert PLAN_POLICY_ID not in session.enabled_policy_ids
    monkeypatch.setattr("app.planners.replan.replan_from_state", lambda *_args, **_kwargs: {0: ["route"]})
    monkeypatch.setattr("app.policies.plan_policy.install_trainrun_plan", lambda env, plan: installed.append(plan))
    monkeypatch.setattr(sessions, "_invalidate_scenario_forecasts", lambda *_: None)
    result = strategies.apply_strategy(session.id, session, "pp", [0, 1])
    assert installed == [{0: ["route"]}]
    assert result["policy"] == PLAN_POLICY_ID
    assert PLAN_POLICY_ID in session.enabled_policy_ids


def test_native_apply_defaults_are_preserved_and_optional_group_is_validated(monkeypatch):
    session = SimpleNamespace(id="native-reference", env=SimpleNamespace(_elapsed_steps=1), dispatcher=None, policy="random")
    monkeypatch.setattr(session_manager, "get", lambda _: session)
    monkeypatch.setattr(hmi, "get_contentions", lambda _: {"groups": [FIRST, SECOND]})
    assert hmi.post_contention_strategy(session.id, hmi.StrategyApplyRequest(strategy="keep"))["applied"] == "keep"
    selected = hmi.post_contention_strategy(session.id, hmi.StrategyApplyRequest(strategy="keep", contention_id=contention_identity(SECOND)))
    assert selected["contention_id"] == contention_identity(SECOND)
    with pytest.raises(HTTPException) as exc:
        hmi.post_contention_strategy(session.id, hmi.StrategyApplyRequest(strategy="keep", contention_id="expired"))
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException) as exc:
        hmi.post_contention_strategy(session.id, hmi.StrategyApplyRequest(
            strategy="pp", priority=[0, 1], contention_id=contention_identity(SECOND)))
    assert exc.value.status_code == 400


def test_real_strategy_selection_and_cache_are_scoped_to_the_requested_group(monkeypatch):
    session, _, _, _, _, _ = fake(monkeypatch)
    monkeypatch.setattr(strategies, "_cache", {})
    outcome = SimpleNamespace(agent_outcomes={}, success_count=0, snapshots=[])
    monkeypatch.setattr("app.core.scenario_runner.TrajectoryBranchRunner",
        lambda *_: SimpleNamespace(run_branch=lambda **_kwargs: outcome))
    monkeypatch.setattr("app.planners.replan.replan_from_state", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(hmi, "_rollout_baseline", lambda *_: ("random", lambda: None))
    first = real_strategies(session.id, session)
    second = real_strategies(session.id, session, contention_id=contention_identity(SECOND))
    assert first["handles"] == [0, 1]
    assert second["handles"] == [2, 3]
    assert second["contention_id"] == contention_identity(SECOND)
    assert real_strategies(session.id, session) is first
    assert len(strategies._cache) == 2
    session.policy = "deadlock_avoidance"
    changed_policy = real_strategies(session.id, session)
    assert changed_policy is not first
    assert changed_policy["strategies"][0]["policy"] == "deadlock_avoidance"
    session.control_revision += 1
    changed_revision = real_strategies(session.id, session)
    assert changed_revision is not changed_policy
    assert len(strategies._cache) == 4


@pytest.mark.parametrize("source,planned,deadline,references", [
    ("plan", {0: 12}, 20, {0: 12}),
    ("latest_arrival", {}, 20, {0: 20, 1: 20, 2: 20, 3: 20}),
    ("unavailable", {}, None, {}),
])
def test_native_forecast_discloses_its_existing_reference_without_changing_choices(monkeypatch, source, planned, deadline, references):
    session, runtime, _, _, _, _ = fake(monkeypatch)
    monkeypatch.setattr(strategies, "_cache", {})
    monkeypatch.setattr("app.policies.plan_policy.planned_arrival_steps", lambda _: dict(planned))
    for agent in session.env.agents:
        agent.latest_arrival = deadline
    outcome = SimpleNamespace(agent_outcomes={}, success_count=0, snapshots=[])
    monkeypatch.setattr("app.core.scenario_runner.TrajectoryBranchRunner",
        lambda *_: SimpleNamespace(run_branch=lambda **_kwargs: outcome))
    monkeypatch.setattr("app.planners.replan.replan_from_state", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(hmi, "_rollout_baseline", lambda *_: ("random", lambda: None))
    payload = real_strategies(session.id, session)
    assert payload["forecast_reference"] == {"source": source, "reference_steps": references}
    assert payload["recommended"] == "keep"
    assert runtime.snapshot(session)["arrival_reference_source"] == "latest_arrival"


def test_native_preview_forwards_the_group_reference_without_changing_the_default(monkeypatch):
    session = SimpleNamespace(id="native-preview")
    monkeypatch.setattr(session_manager, "get", lambda _: session)
    requested = []
    monkeypatch.setattr(strategies, "contention_strategies", lambda _sid, _session, _order, reference: requested.append(reference) or {})
    hmi.get_contention_strategies(session.id)
    hmi.get_contention_strategies(session.id, contention_id=contention_identity(SECOND))
    assert requested == [None, contention_identity(SECOND)]


def test_preset_explicit_horizon_overrides_but_default_horizon_is_preserved(monkeypatch):
    captured = []
    class CapturedCreation(Exception):
        pass

    def capture(**kwargs):
        captured.append(kwargs)
        raise CapturedCreation

    monkeypatch.setattr(session_manager, "create", capture)
    for values in [{}, {"max_episode_steps": 320}]:
        with pytest.raises(CapturedCreation):
            sessions.create_session(SessionCreateRequest(scenario_preset_id="pf-ch-corridor-stops", **values))
    assert captured[0]["max_episode_steps"] is None
    assert captured[1]["max_episode_steps"] == 320
