"""A forecast never forks the live env mid-step (issue #117), and a deleted
session's forecasts stop at their next step (issue #118)."""
import threading
import time
from types import SimpleNamespace

import pytest

from app.core.env_guard import ForecastCancelled, cancel_forecasts, env_lock, raise_if_cancelled
from app.core.scenario_runner import TrajectoryBranchRunner


class _Env:
    """A plain env stand-in (weak-referenceable, hashable)."""


def test_fork_waits_for_a_step_in_progress(monkeypatch):
    env = _Env()
    saved_while_stepping = []
    stepping = threading.Event()

    def save(base, path):
        saved_while_stepping.append(stepping.is_set())
        raise RuntimeError("stop after the save")

    monkeypatch.setattr("app.core.scenario_runner.RailEnvPersister.save", staticmethod(save))

    def slow_step():
        with env_lock(env):
            stepping.set()
            time.sleep(0.3)
            stepping.clear()

    stepper = threading.Thread(target=slow_step)
    stepper.start()
    stepping.wait(1)
    with pytest.raises(RuntimeError):
        TrajectoryBranchRunner(env, None)._fork_env()
    stepper.join()
    assert saved_while_stepping == [False]


def test_env_lock_is_one_per_env_and_reentrant():
    a, b = _Env(), _Env()
    assert env_lock(a) is env_lock(a)
    assert env_lock(a) is not env_lock(b)
    with env_lock(a), env_lock(a):
        pass


def test_cancelled_forecast_does_not_fork():
    env = _Env()
    raise_if_cancelled(env)  # not cancelled: no-op
    cancel_forecasts(env)
    with pytest.raises(ForecastCancelled):
        TrajectoryBranchRunner(env, None)._fork_env()


def test_cancel_stops_a_running_branch_at_its_next_step(monkeypatch):
    import app.core.scenario_runner as sr

    env = _Env()
    steps = []

    class Fork:
        agents = []
        _elapsed_steps = 0

        def get_agent_handles(self):
            return []

        def step(self, actions):
            steps.append(1)
            if len(steps) == 2:
                cancel_forecasts(env)

    runner = TrajectoryBranchRunner(env, None)
    monkeypatch.setattr(runner, "_fork_env", lambda: Fork())
    monkeypatch.setattr(runner, "_all_done", lambda e: False)
    monkeypatch.setattr(runner, "_make_override_policy", lambda e, o: (SimpleNamespace(
        start_episode=lambda: None, start_step=lambda: None, act_many=lambda h, o: {},
        end_step=lambda: None), "s"))
    monkeypatch.setattr(sr, "ConflictDetectionCallbacks", lambda **k: SimpleNamespace(
        on_episode_start=lambda **k: None, on_episode_step=lambda **k: None))
    with pytest.raises(ForecastCancelled):
        runner.run_branch(max_steps=50)
    assert len(steps) == 2
