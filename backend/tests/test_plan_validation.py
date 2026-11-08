"""Actual physics and complete missions, independent of model utility scores."""
import copy
import json
from pathlib import Path

import pytest
from flatland.envs.rail_trainrun_data_structures import TrainrunWaypoint

from app.core.env_factory import create_env
from app.planners.plan_validation import (
    validate_execution,
    validate_player,
    validate_schedules,
    validate_trainruns,
)
from app.policies.goal_based_policies.infrastructure_graph import build_decision_point_graph
from app.policies.goal_based_policies.schedule import ScheduleEntry, SchedulePlayer, TrainSchedule, line_stops
from app.policies.plan_policy import PlanPolicy, trainruns_from_env

pytestmark = pytest.mark.integration


def _small_env():
    return create_env(scenario_preset_id="pf-ch-wn-wal-long-approach")


def _with_stop(*, dwell: int, earliest: int = 0):
    env = _small_env()
    runs = trainruns_from_env(env)
    stop = runs[0][10]
    agent = env.agents[0]
    agent.waypoints = [agent.waypoints[0], [stop.waypoint], agent.waypoints[-1]]
    agent.waypoints_earliest_departure = [agent.earliest_departure, earliest, None]
    agent.waypoints_latest_arrival = [None, 1000, agent.latest_arrival]
    shifted = {
        handle: [TrainrunWaypoint(w.scheduled_at + (dwell if handle == 0 and i > 10 else 0), w.waypoint)
                 for i, w in enumerate(run)]
        for handle, run in runs.items()
    }
    return env, shifted


def test_existing_executable_plan_is_accepted_without_advancing_source():
    env = _small_env()
    agents_before = copy.deepcopy([a.to_agent() for a in env.agents])
    random_before = env.np_random.get_state()

    result = validate_trainruns(env, trainruns_from_env(env))

    assert result.accepted
    assert result.arrived_handles == (0, 1, 2)
    assert result.end_step == 63
    assert env._elapsed_steps == 0
    assert [a.to_agent() for a in env.agents] == agents_before
    random_after = env.np_random.get_state()
    assert random_before[0] == random_after[0]
    assert (random_before[1] == random_after[1]).all()
    assert random_before[2:] == random_after[2:]


def test_all_arrivals_do_not_hide_a_skipped_required_stop():
    env, runs = _with_stop(dwell=0)

    result = validate_trainruns(env, runs)

    assert result.arrived_handles == (0, 1, 2)
    assert not result.accepted
    assert result.reason == "missed_required_stops"
    assert result.missed_stops_by_handle == {0: (1,)}


def test_a_real_stand_serves_the_call_and_preserves_source_mission_state():
    env, runs = _with_stop(dwell=6)

    result = validate_trainruns(env, runs)

    assert result.accepted, result.to_dict()
    assert result.trains[0].served_stops == (1,)
    assert not result.missed_stops_by_handle
    assert env._elapsed_steps == 0


def test_serving_a_stop_does_not_permit_early_departure():
    env, runs = _with_stop(dwell=6, earliest=100)

    result = validate_trainruns(env, runs)

    assert result.arrived_handles == (0, 1, 2)
    assert result.trains[0].served_stops == (1,)
    assert not result.accepted
    assert "early_stop_departure:1" in result.trains[0].violations


def test_stop_order_is_mandatory_even_when_both_calls_are_served():
    env = _small_env()
    runs = trainruns_from_env(env)
    agent = env.agents[0]
    agent.waypoints = [agent.waypoints[0], [runs[0][20].waypoint], [runs[0][10].waypoint], agent.waypoints[-1]]
    agent.waypoints_earliest_departure = [agent.earliest_departure, 0, 0, None]
    agent.waypoints_latest_arrival = [None, 1000, 1000, agent.latest_arrival]
    shifted = {
        handle: [TrainrunWaypoint(w.scheduled_at + (int(i > 10) + int(i > 20) if handle == 0 else 0), w.waypoint)
                 for i, w in enumerate(run)]
        for handle, run in runs.items()
    }

    result = validate_trainruns(env, shifted)

    assert result.trains[0].served_stops == (1, 2)
    assert result.arrived_handles == (0, 1, 2)
    assert not result.accepted
    assert "stop_order:2" in result.trains[0].violations


def test_one_physical_visit_cannot_serve_two_repeated_mandatory_calls():
    env, runs = _with_stop(dwell=6)
    agent = env.agents[0]
    agent.waypoints.insert(2, list(agent.waypoints[1]))
    agent.waypoints_earliest_departure.insert(2, 0)
    agent.waypoints_latest_arrival.insert(2, 1000)

    result = validate_trainruns(env, runs)

    assert result.arrived_handles == (0, 1, 2)
    assert not result.accepted
    assert result.trains[0].served_stops == (1,)
    assert result.missed_stops_by_handle == {0: (2,)}


@pytest.mark.parametrize("dwell", [0, 6])
def test_already_completed_trains_still_need_evidence_of_required_calls(dwell):
    env, runs = _with_stop(dwell=dwell)
    policy = PlanPolicy(env, runs)
    policy.reset(env)
    observations = {}
    while env._elapsed_steps < env._max_episode_steps:
        policy.start_step()
        observations, _, dones, _ = env.step(policy.act_many(env.get_agent_handles(), observations))
        policy.end_step()
        if dones.get("__all__"):
            break

    result = validate_trainruns(env, runs)

    assert result.arrived_handles == (0, 1, 2)
    assert result.simulated_steps == 0
    assert result.accepted == (dwell > 0)
    if not dwell:
        assert result.missed_stops_by_handle == {0: (1,)}
    else:
        assert result.trains[0].served_stops == (1,)
    assert result.to_dict()["history_scope"] == "served_stop_evidence_only"


def test_real_horizon_is_a_failure_when_trains_have_not_arrived():
    env = _small_env()

    result = validate_trainruns(env, trainruns_from_env(env), max_steps=5)

    assert not result.accepted
    assert result.reason == "incomplete_arrivals"
    assert result.simulated_steps == 5


def test_partial_plan_cannot_pass_via_a_fallback_policy():
    env = _small_env()

    result = validate_trainruns(env, {0: trainruns_from_env(env)[0]})

    assert not result.accepted
    assert result.reason == "incomplete_plan"
    assert result.simulated_steps == 0
    assert result.trains[1].violations == ("missing_plan",)
    assert result.trains[2].violations == ("missing_plan",)


def test_missing_mission_data_or_failed_adapter_never_passes():
    env = _small_env()
    env.agents[0].waypoints = None
    assert validate_trainruns(env, trainruns_from_env(env)).reason == "invalid_mission_data"

    def broken(_):
        raise RuntimeError("failed adapter")

    result = validate_execution(_small_env(), broken)
    assert not result.accepted
    assert result.reason == "execution_error"
    assert result.errors == ("RuntimeError: failed adapter",)


def _captured_conflict():
    evidence = Path(__file__).resolve().parents[2] / "docs/examples/dispatcher-agents/director-feasibility/captured-initial-plan-nodes.json"
    data = json.loads(evidence.read_text())
    env = create_env(scenario_preset_id="pf-ch-corridor-stops", max_episode_steps=320)
    graph = build_decision_point_graph(
        env, extra_station_cells={s for h in range(len(env.agents)) for s in line_stops(env, h)},
    )
    schedules = [TrainSchedule(int(h), [ScheduleEntry(e["node_id"], e["wait"]) for e in entries])
                 for h, entries in data["trains"].items()]
    return env, graph, schedules


def test_captured_opposing_train_conflict_cannot_be_admitted():
    env, graph, schedules = _captured_conflict()

    result = validate_schedules(env, graph, schedules)

    assert not result.accepted
    assert result.arrived_handles == (0,)
    assert {1, 12} <= set(result.incomplete_handles)
    assert result.end_step == 320
    assert result.missed_stops_by_handle
    assert env._elapsed_steps == 0


def test_player_validation_keeps_exact_waits_and_remaining_schedule():
    env, graph, schedules = _captured_conflict()
    player = SchedulePlayer(graph, env, schedules)
    for _ in range(35):
        env.step(player.act_many())
    before = player.snapshot()

    result = validate_player(env, player)

    assert not result.accepted
    assert result.start_step == 35
    assert result.end_step == 320
    assert player.snapshot() == before
    assert env._elapsed_steps == 35
