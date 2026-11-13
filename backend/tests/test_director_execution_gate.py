"""Rejected initial/residual plans cannot enter through another policy path."""
from types import SimpleNamespace

import pytest

from app.policies import goal_directed_policy as director
from app.policies.goal_based_policies import dataset, step0_cache
from app.policies.goal_based_policies.dataset import Layout, build_layout_env
from app.policies.goal_based_policies.schedule import ScheduleEntry, SchedulePlayer
from app.utils.agent_compat import agent_position

pytestmark = pytest.mark.integration


@pytest.fixture
def mission(monkeypatch):
    monkeypatch.setattr(director, "_load_models", lambda: None)
    env = build_layout_env(Layout(index=0, seed=2001, size=30, cities=2), 1)
    graph = director._director_graph(env)
    schedules = dataset.plan_all_lines(env, graph)
    assert schedules
    return env, graph, schedules


def test_valid_fallback_has_actual_execution_evidence(mission):
    env, _, _ = mission
    director.GoalDirectedPolicy(env)
    info = director.plan_info(env)
    assert info["validation"]["accepted"]
    assert info["validation"]["arrived"] == info["validation"]["total"] == 1
    assert env._elapsed_steps == 0


def test_bad_cached_plan_and_fallback_do_not_report_success(monkeypatch, mission):
    env, _, _ = mission
    monkeypatch.setattr(director, "_load_models", lambda: (object(), object()))
    monkeypatch.setattr(step0_cache, "fingerprint", lambda *args: "bad-cache")
    monkeypatch.setattr(step0_cache, "load_plan", lambda key: ([], {"source": "search"}))
    from app.planners import director_pp
    from app.policies.goal_based_policies import search

    def failed_search(*args, **kwargs):
        raise RuntimeError("no candidate")

    monkeypatch.setattr(search, "director_plan", failed_search)
    monkeypatch.setattr(dataset, "plan_all_lines", lambda *args: [])
    monkeypatch.setattr(director_pp, "candidate_schedules", lambda *args: [])
    policy = director.GoalDirectedPolicy(env)
    info = director.plan_info(env)
    assert info["source"] == "no-executable-plan"
    assert not info["validation"]["accepted"]
    assert not info["rejected"]["cache"]["accepted"]
    assert director.plan_player(env) is None
    assert director.plan_schedules(env) is None
    assert int(policy.act_for_handle(0)) == 4  # STOP_MOVING, not continued motion
    assert env._elapsed_steps == 0


def test_objective_change_cannot_bypass_execution_gate(monkeypatch, mission):
    env, graph, schedules = mission
    player = SchedulePlayer(graph, env, schedules)
    for _ in range(1):
        env.step(player.act_many())
    director._PLAYERS[env] = player
    director._SCHEDULES[env] = schedules
    director._PLAN_INFO[env] = {"source": "search", "weights": [1, 1, 1]}
    before = player.snapshot()
    from app.policies.goal_based_policies import replan

    # A returned tail that cannot complete. The real execution validator must
    # reject it even when a weight change deliberately bypasses benefit checks.
    monkeypatch.setattr(replan, "splice_entries", lambda progress, schedule: [
        ScheduleEntry(schedule.entries[0].node_id, 10000)
    ])
    plan = SimpleNamespace(
        source="research", schedules=schedules, decisions=0, trace=[],
        event=lambda: {"source": "research", "reason": "weights change"},
        score=SimpleNamespace(weighted=1.0, breakdown={"utilities": {}}),
    )
    event = director._finish_replan(env, plan, gate=False)
    assert event is not None
    assert event["gate"] == "execution-veto"
    assert not event["validation"]["accepted"]
    assert event["source"] == "continue"
    assert player.snapshot() == before
    assert director.plan_schedules(env) is schedules
    assert env._elapsed_steps == 1


def test_no_plan_api_response_is_not_replanned(monkeypatch):
    from app.api.sessions import DirectorWeightsRequest, set_director_weights_for_session
    from app.core.session_manager import session_manager
    from app.planners import director_pp

    session = session_manager.create(width=25, height=25, number_of_agents=1, seed=42)
    monkeypatch.setattr(director, "_load_models", lambda: None)
    monkeypatch.setattr(dataset, "plan_all_lines", lambda *args: [])
    monkeypatch.setattr(director_pp, "candidate_schedules", lambda *args: [])
    try:
        response = set_director_weights_for_session(session.id, DirectorWeightsRequest(
            punctuality=1, connections=1, stability=1, plan=True,
        ))
        assert response["replanned"] is False
        assert response["plan"]["source"] == "no-executable-plan"
        assert response["paths"] is None
    finally:
        session_manager.delete(session.id)


def test_delayed_insertion_stays_off_grid_and_survives_player_replay(mission):
    from dataclasses import replace

    from app.planners.plan_validation import validate_player

    env, graph, schedules = mission
    bound = int(env.agents[0].earliest_departure or 0) + 7
    schedules[0].entries[0] = replace(schedules[0].entries[0], not_before=bound)
    player = SchedulePlayer(graph, env, schedules)
    assert player.future_path(0)[0]["step"] >= bound + 1
    while env._elapsed_steps < bound:
        env.step(player.act_many())
        assert agent_position(env.agents[0]) is None
    replay = SchedulePlayer(graph, env)
    replay.restore(player.snapshot())
    assert replay.remaining(0)[0].not_before == bound
    assert validate_player(env, replay).accepted
    env.step(player.act_many())
    assert agent_position(env.agents[0]) is not None


@pytest.mark.parametrize("change", ["step", "weights", "plan", "reset"])
def test_residual_proof_cannot_overwrite_a_changed_live_state(monkeypatch, mission, change):
    from app.planners import plan_validation

    env, graph, schedules = mission
    player = SchedulePlayer(graph, env, schedules)
    env.step(player.act_many())
    director._PLAYERS[env] = player
    director._SCHEDULES[env] = schedules
    director._PLAN_INFO[env] = {"source": "search", "weights": [1, 1, 1]}
    original_validation = plan_validation.validate_player
    snapshots = []

    def raced_validation(*args, **kwargs):
        report = original_validation(*args, **kwargs)
        assert report.accepted
        if change == "step":
            env.step(player.act_many())
        elif change == "weights":
            director.set_env_weights(env, 5, 2, 2)
        elif change == "reset":
            env.reset(regenerate_rail=False, regenerate_schedule=False)
        else:
            director._SCHEDULES[env] = list(schedules)
        snapshots.append(player.snapshot())
        return report

    monkeypatch.setattr(plan_validation, "validate_player", raced_validation)
    plan = SimpleNamespace(
        source="research", schedules=schedules, decisions=0, trace=[],
        event=lambda: {"source": "research", "reason": "weights change"},
        score=SimpleNamespace(weighted=1.0, breakdown={"utilities": {}}),
    )
    event = director._finish_replan(env, plan, gate=False)
    assert event is not None and event["gate"] == "execution-stale"
    assert event["source"] == "continue"
    assert player.snapshot() == snapshots[0]
    if change != "plan":
        assert director._replan_state(env)["weights_dirty"]


def test_stale_initial_proof_is_retryable_without_a_permanent_no_plan_cache(monkeypatch, mission):
    env, _, _ = mission
    original_plan = director.GoalDirectedPolicy._plan

    def raced_plan(self, env, graph):
        schedules, info = original_plan(self, env, graph)
        assert info["validation"]["accepted"]
        env.step(SchedulePlayer(graph, env, schedules).act_many())
        return schedules, info

    monkeypatch.setattr(director.GoalDirectedPolicy, "_plan", raced_plan)
    director.GoalDirectedPolicy(env)
    assert director.plan_player(env) is None
    assert director.plan_info(env)["validation"]["reason"] == "execution_stale"
    assert env not in director._UNROUTABLE
