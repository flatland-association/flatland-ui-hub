"""Tests for ETA / visibility fields in serialize_agent."""
import warnings
warnings.filterwarnings("ignore")

import pytest
from flatland.core.env_observation_builder import DummyObservationBuilder
from flatland.envs.line_generators import sparse_line_generator
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_generators import sparse_rail_generator

from app.core.serializer import serialize_agent, serialize_env


def _make_env(num_agents: int = 2, seed: int = 42) -> RailEnv:
    e = RailEnv(
        width=25, height=25, number_of_agents=num_agents, random_seed=seed,
        rail_generator=sparse_rail_generator(max_num_cities=2, seed=seed),
        line_generator=sparse_line_generator(),
        obs_builder_object=DummyObservationBuilder(),
    )
    e.reset()
    return e


def test_agent_has_eta_fields():
    env = _make_env()
    payload = serialize_agent(env, env.agents[0])
    for key in ("eta_to_depart", "time_to_deadline", "delay", "is_visible"):
        assert key in payload, f"missing {key}"


def test_eta_decreases_over_time():
    env = _make_env()
    a0 = env.agents[0]
    if a0.earliest_departure is None or a0.earliest_departure == 0:
        pytest.skip("agent 0 starts immediately; no countdown visible")

    p0 = serialize_agent(env, a0)
    eta0 = p0["eta_to_depart"]
    assert eta0 is not None and eta0 >= 0

    # Step once with no actions; elapsed_steps advances.
    env.step({h: 0 for h in env.get_agent_handles()})
    p1 = serialize_agent(env, env.agents[0])
    eta1 = p1["eta_to_depart"]
    if eta0 > 0:
        assert eta1 == eta0 - 1, f"ETA should decrement by 1 (got {eta0} → {eta1})"


def test_visibility_hides_waiting_and_done():
    env = _make_env()
    a0 = env.agents[0]
    # Force-set WAITING.
    try:
        from flatland.envs.step_utils.states import TrainState
        a0._state = TrainState.WAITING
        try:
            a0.state = TrainState.WAITING
        except Exception:
            pass
        p = serialize_agent(env, a0)
        # Note: direct attribute setting is best-effort; only assert if it stuck.
        if p["state"] == "WAITING":
            assert p["is_visible"] is False
        # And DONE.
        a0._state = TrainState.DONE
        try:
            a0.state = TrainState.DONE
        except Exception:
            pass
        p = serialize_agent(env, a0)
        if p["state"] == "DONE":
            assert p["is_visible"] is False
    except ImportError:
        pytest.skip("TrainState not available")


@pytest.mark.integration
def test_visibility_shows_ready_to_depart_and_moving():
    env = _make_env()
    # Step a few times so at least one agent enters the map.
    for _ in range(20):
        env.step({h: 2 for h in env.get_agent_handles()})  # 2 = MOVE_FORWARD
    payload = serialize_env(env)
    visible = [a for a in payload["agents"] if a["is_visible"]]
    # In a freshly running episode at least one agent should be visible.
    assert len(visible) >= 1, "expected at least one visible agent after 20 steps"


def test_delay_is_zero_when_within_deadline():
    env = _make_env()
    payload = serialize_agent(env, env.agents[0])
    # Just-reset env: elapsed=0, latest_arrival is far in the future.
    assert payload["delay"] == 0


def test_serialize_env_includes_eta_per_agent():
    env = _make_env(num_agents=3)
    payload = serialize_env(env)
    assert all("eta_to_depart" in a for a in payload["agents"])
    assert all("is_visible" in a for a in payload["agents"])
