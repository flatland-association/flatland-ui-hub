"""Vehicle dynamics probe (docs/plans/train-dynamics-probe.md).

The physics port lives in backend/vendor_local/ and is not part of the
repository, so the tests that need it skip where it is missing (CI). The
gating — no port, no dynamics, nothing changes — is tested everywhere.
"""
import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.core import train_dynamics
from app.core.env_factory import create_env
from app.core.serializer import serialize_env
from app.main import app

needs_port = pytest.mark.skipif(not train_dynamics.available(), reason="local dynamics port not installed")


def _drive(env, steps):
    from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy

    policy = DeadLockAvoidancePolicy()
    policy.reset(env)
    for _ in range(steps):
        policy.start_step()
        actions = policy.act_many(env.get_agent_handles(), {})
        policy.end_step()
        _, _, dones, _ = env.step(actions)
        if dones["__all__"]:
            break


# ── gating ──────────────────────────────────────────────────────────────

def test_without_the_port_nothing_changes(monkeypatch):
    monkeypatch.setattr(train_dynamics, "_checked", True)
    monkeypatch.setattr(train_dynamics, "_port", None)
    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    assert train_dynamics.attach(env) is False
    assert not train_dynamics.is_active(env)
    assert all("dynamics" not in a for a in serialize_env(env)["agents"])

    client = TestClient(app)
    info = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 3, "dynamics": True}).json()
    assert info["dynamics"] is None


def test_plain_sessions_have_no_dynamics():
    client = TestClient(app)
    info = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 3}).json()
    assert info["dynamics"] is None


# ── with the port ───────────────────────────────────────────────────────

@needs_port
def test_trains_accelerate_and_hold_their_braking_distance():
    env = create_env(width=30, height=30, number_of_agents=5, seed=42)
    assert train_dynamics.attach(env)
    _drive(env, 30)
    views = [train_dynamics.agent_view(env, a.handle) for a in env.agents if a.position is not None]
    assert views, "no train on the map after 30 steps"
    assert any(v["speedKmh"] > 0 for v in views)
    assert all(v["speedKmh"] <= 100.5 for v in views)  # line speed 100 km/h
    assert any(len(v["occupiedCells"]) >= 2 for v in views)  # train + braking distance
    # The state goes to the HMI as JSON (generated envs hand out numpy ints).
    json.dumps(serialize_env(env))


@needs_port
def test_physics_makes_trains_slower_than_plain_flatland():
    plain = create_env(width=30, height=30, number_of_agents=5, seed=42)
    physical = create_env(width=30, height=30, number_of_agents=5, seed=42)
    train_dynamics.attach(physical)
    _drive(plain, 40)
    _drive(physical, 40)
    def arrived(env):
        return sum(str(a.state).endswith("DONE") for a in env.agents)
    assert arrived(physical) <= arrived(plain)


@needs_port
def test_a_deepcopy_steps_on_its_own():
    # The Director forks with copy.deepcopy; the copy must not step the original.
    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    train_dynamics.attach(env)
    _drive(env, 5)
    fork = copy.deepcopy(env)
    assert fork._dynamics is not env._dynamics and fork._dynamics.env is fork
    before = env._elapsed_steps
    _drive(fork, 5)
    assert env._elapsed_steps == before and fork._elapsed_steps > before


@needs_port
def test_what_if_forks_carry_the_dynamics():
    from app.core.scenario_runner import TrajectoryBranchRunner
    from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy

    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    train_dynamics.attach(env)
    _drive(env, 10)
    fork = TrajectoryBranchRunner(env, DeadLockAvoidancePolicy)._fork_env()
    assert train_dynamics.is_active(fork) and fork._dynamics is not env._dynamics
    for a in env.agents:
        assert train_dynamics.agent_view(fork, a.handle) == train_dynamics.agent_view(env, a.handle)


@needs_port
def test_session_with_dynamics_reports_profile_and_agent_views():
    client = TestClient(app)
    info = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 3, "dynamics": True}).json()
    assert info["dynamics"]["cellLengthM"] == 400
    assert abs(info["dynamics"]["timeStepS"] - 14.4) < 0.01
    sid = info["id"]
    for _ in range(3):
        client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance", "n_steps": 10})
    state = client.get(f"/session/{sid}/state").json()
    assert all("dynamics" in a for a in state["agents"])
