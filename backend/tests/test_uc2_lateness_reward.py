"""Punctuality shaping pays exactly for native accrued delay, never physics."""
from __future__ import annotations

import math

import numpy as np
import pytest

from lab.marl import train_ppo
from lab.marl.collect_pp_demonstrations import create_teacher
from lab.marl.common import ActorCritic
from lab.marl.pf_ch_episode import PFChCase, PFChEpisode


@pytest.mark.integration
@pytest.mark.parametrize("complete", [False, True])
def test_lateness_shaping_equals_final_delay_and_preserves_native_mission(complete):
    preset = "uc2-2" if complete else "tutorial"
    baseline = PFChEpisode(PFChCase(preset))
    shaped = PFChEpisode(PFChCase(preset), lateness_cost=0.01)
    try:
        teacher = (create_teacher(baseline.env, preset=preset, executor="trainruns", max_orders=4,
                                  replan_on_incidents=True, max_replans=8)[0] if complete else None)
        sums = [0.0, 0.0]
        while not baseline.done:
            actions = teacher.act_many(baseline.handles) if teacher else {h: 0 for h in baseline.handles}
            for index, episode in enumerate((baseline, shaped)):
                _, rewards, _, _ = episode.step(actions)
                sums[index] += sum(rewards.values())
        first, second = baseline.metrics(), shaped.metrics()
        assert first == second
        assert first["complete_mission"] is complete
        assert first["lateness"] > 0
        assert math.isclose(sums[0] - sums[1], first["lateness"] * 0.01, abs_tol=1e-8)
        assert baseline.episode_end_rewards() == shaped.episode_end_rewards()
    finally:
        baseline.close()
        shaped.close()


@pytest.mark.parametrize("cost", [-1, float("inf"), float("nan")])
def test_invalid_cost_is_rejected_before_environment_creation(monkeypatch, cost):
    def forbidden(**kwargs):
        pytest.fail("invalid cost must fail before loading a fixture")
    monkeypatch.setattr("lab.marl.pf_ch_episode.create_env", forbidden)
    with pytest.raises(ValueError, match="finite and nonnegative"):
        PFChEpisode(PFChCase("tutorial"), lateness_cost=cost)


@pytest.mark.parametrize("cost", [0.0, 0.01])
def test_rollout_worker_preserves_old_tasks_and_forwards_explicit_cost(monkeypatch, cost):
    model = ActorCritic()
    captured = []
    def fake_episode(*args, **kwargs):
        captured.append(kwargs)
        return "batch", "stats"
    monkeypatch.setattr(train_ppo, "run_pf_ch_episode", fake_episode)
    task = (model.state_dict(), PFChCase("tutorial"), 3, .997, .99, "ecml36-service-v1", .5)
    if cost:
        task += (cost,)
    assert train_ppo._collect_pf_ch(task) == ("batch", "stats")
    assert captured == ([{"lateness_cost": cost}] if cost else [{}])
    assert train_ppo.build_parser().parse_args(["--name", "test"]).lateness_cost == 0


def test_missing_deadline_does_not_create_synthetic_lateness():
    from types import SimpleNamespace
    from flatland.envs.step_utils.states import TrainState
    from lab.marl.pf_ch_episode import total_lateness
    env = SimpleNamespace(_elapsed_steps=50, agents=[
        SimpleNamespace(latest_arrival=None, state=TrainState.MOVING),
        SimpleNamespace(latest_arrival=10, state=TrainState.DONE, arrival_time=12),
        SimpleNamespace(latest_arrival=40, state=TrainState.STOPPED),
    ])
    assert np.isclose(total_lateness(env), 12)
