"""Off-grid reservations must survive scoring, search and residual capture."""
import copy
from dataclasses import replace

import pytest

from app.policies.goal_based_policies.branching import (
    arrival_time,
    initial_prefixes,
    next_decision,
)
from app.policies.goal_based_policies.dataset import (
    Layout,
    build_layout_env,
    edge_time_windows,
    encode_sample,
    plan_all_lines,
    schedule_departure,
)
from app.policies.goal_based_policies.infrastructure_graph import build_decision_point_graph
from app.policies.goal_based_policies.replan import (
    capture_progress,
    simulate_forward,
    splice_entries,
)
from app.policies.goal_based_policies.schedule import (
    SchedulePlayer,
    TrainSchedule,
    plan_avoiding_overlaps,
)

pytestmark = pytest.mark.integration


@pytest.fixture
def scenario():
    env = build_layout_env(Layout(index=0, seed=2001, size=30, cities=2), 4)
    graph = build_decision_point_graph(env)
    plans = plan_all_lines(env, graph)
    assert plans is not None
    return env, graph, plans


def _later(schedule, bound):
    return TrainSchedule(schedule.handle, [
        replace(schedule.entries[0], not_before=bound), *schedule.entries[1:],
    ])


def test_insertion_delay_reaches_edge_times_and_existing_model_features(scenario):
    env, graph, plans = scenario
    original = plans[0]
    departure = schedule_departure(env, original)
    delayed = _later(original, int(departure) + 17)
    before = edge_time_windows(env, graph, original)
    after = edge_time_windows(env, graph, delayed)
    assert before
    assert [(enter, exit) for _, enter, exit in after] == [
        (enter + 17, exit + 17) for _, enter, exit in before
    ]
    original_sample = encode_sample(env, graph, 0, [original])
    delayed_sample = encode_sample(env, graph, 0, [delayed])
    horizon = env._max_episode_steps
    assert delayed_sample.train_scalars[0, 0] == pytest.approx(
        original_sample.train_scalars[0, 0] + 17 / horizon)
    assert delayed_sample.train_scalars[0, 3] == pytest.approx(
        original_sample.train_scalars[0, 3] - 17 / horizon)
    # Off-grid holding moves insertion, without charging the same time
    # again as an occupied node wait or route duration.
    assert delayed_sample.train_scalars[0, 2] == original_sample.train_scalars[0, 2]
    assert (delayed_sample.waits == original_sample.waits).all()
    assert env.agents[original.handle].earliest_departure == departure


def test_a_bare_origin_has_the_reserved_insertion_time(scenario):
    env, graph, plans = scenario
    original = plans[0]
    bound = int(schedule_departure(env, original)) + 17
    prefix = (replace(original.entries[0], not_before=bound),)
    assert arrival_time(env, graph, original.handle, prefix) == bound


def test_search_holds_preserve_insertion_metadata(scenario):
    env, graph, _ = scenario
    prefixes = initial_prefixes(env, graph)
    decision = next_decision(env, graph, prefixes)
    assert decision is not None
    prefix = prefixes[decision.handle]
    bound = 29
    prefix = prefix[:-1] + (replace(prefix[-1], not_before=bound),)
    changed = next_decision(env, graph, {decision.handle: prefix})
    assert changed is not None
    assert all(option.prefix[len(prefix) - 1].not_before == bound
               for option in changed.options)


def test_pending_capture_and_continue_splice_preserve_the_actual_episode(scenario):
    env, graph, plans = scenario
    plans = plan_avoiding_overlaps(env, graph, plans)
    delayed = [_later(plan, int(schedule_departure(env, plan)) + 20)
               for plan in plans]
    player = SchedulePlayer(graph, env, delayed)
    for _ in range(5):
        env.step(player.act_many())
    progress = capture_progress(env, graph, player, delayed)
    fork = copy.deepcopy(env)
    changed = SchedulePlayer(graph, fork)
    changed.restore(player.snapshot())
    for schedule in delayed:
        captured = progress[schedule.handle]
        assert captured.status == "pending"
        assert list(captured.continue_entries) == schedule.entries
        tail = splice_entries(captured, TrainSchedule(
            schedule.handle, list(captured.continue_entries)))
        assert tail is not None
        assert tail[0].not_before == schedule.entries[0].not_before
        changed.set_schedule(TrainSchedule(schedule.handle, tail))
    assert changed.snapshot() == player.snapshot()
    reference_result = simulate_forward(env, player)
    changed_result = simulate_forward(fork, changed)
    assert reference_result["arrivals"]
    assert changed_result["arrivals"] == reference_result["arrivals"]
    assert changed_result["total_delay"] == reference_result["total_delay"]
