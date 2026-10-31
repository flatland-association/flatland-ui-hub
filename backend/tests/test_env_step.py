"""`step_env`: the one helper around `env.step` for a live session
(docs/plans/experiment-logging-frontend-and-replay.md §5.4.2, step 8)."""

from types import SimpleNamespace

from app.core import disturbances
from app.core.env_step import step_env


class _Env:
    def __init__(self):
        self.calls = []

    def step(self, actions):
        self.calls.append(actions)
        return {"obs": 1}, {0: -1}, {"__all__": False}, {"info": 2}


def test_steps_and_keeps_observations_and_info(monkeypatch):
    fired = []
    monkeypatch.setattr(disturbances, "apply_due_disturbances", lambda sid, s, env: fired.append(sid))
    session = SimpleNamespace(env=_Env(), last_observations=None, last_info=None)
    obs, rewards, dones, info = step_env("s1", session, {0: 2})
    assert session.env.calls == [{0: 2}]
    assert session.last_observations == {"obs": 1} and session.last_info == {"info": 2}
    assert dones == {"__all__": False} and rewards == {0: -1} and obs == {"obs": 1} and info == {"info": 2}
    assert fired == ["s1"]


def test_manual_action_fires_no_disturbances(monkeypatch):
    fired = []
    monkeypatch.setattr(disturbances, "apply_due_disturbances", lambda sid, s, env: fired.append(sid))
    session = SimpleNamespace(env=_Env(), last_observations=None, last_info=None)
    step_env("s1", session, {0: 2}, disturbances=False)
    assert fired == []
