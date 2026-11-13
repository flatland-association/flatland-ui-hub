"""Real native environments are released; other live sessions keep working."""
import asyncio
from fractions import Fraction
import gc
import inspect
import weakref

import numpy as np
import pytest

from flatland.core.env_observation_builder import DummyObservationBuilder
from flatland.core.transition_map import GridTransitionMap
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_grid_transition_map import RailGridTransitionMap
from flatland.envs.step_utils.states import TrainState

from app.api.sessions import reset_session
from app.core.native_env_cache import _NATIVE_CACHE_METHODS, clear_native_environment_caches
from app.core.session_manager import SessionManager, session_manager

pytestmark = pytest.mark.integration


def _wrappers():
    return [getattr(owner, name) for owner, names in _NATIVE_CACHE_METHODS for name in names]


def _private_observations(env):
    # Native RailEnv's shared default GlobalObs builder retains its most recent
    # env independently of the caches. Isolate that bounded, different root.
    builder = DummyObservationBuilder()
    builder.reset(env)
    env.obs_builder = builder


def _populate(env):
    rail = env.rail
    configuration = env.agents[0].initial_configuration
    position, direction = configuration
    rail.get_full_transitions(*position)
    rail.get_transitions(configuration)
    rail.get_transition(configuration, direction)
    rail.get_successor_configurations(configuration)
    rail.get_predecessor_configurations(configuration)
    rail.apply_action_independent(2, configuration)
    rail.is_dead_end(position)
    rail.is_simple_turn(position)
    env._is_speed_zero(Fraction(0))
    env._fast_state_position_sync_check(TrainState.WAITING, None, True)


def test_allowlist_covers_every_pinned_native_instance_lru_including_base_env():
    wrapped = set(_wrappers())
    discovered = set()
    for cls in (RailEnv, RailGridTransitionMap, GridTransitionMap):
        for owner in cls.__mro__:
            for method in vars(owner).values():
                if callable(getattr(method, 'cache_clear', None)):
                    parameters = list(inspect.signature(method).parameters)
                    if parameters and parameters[0] == 'self':
                        discovered.add(method)
    assert len(wrapped) == 17
    assert discovered == wrapped
    assert RailEnv._is_speed_zero in wrapped
    assert RailEnv.action_required not in wrapped


def test_delete_releases_a_native_environment_and_rail_without_changing_another_live_env():
    clear_native_environment_caches()
    manager = SessionManager()
    deleted = manager.create(scenario_preset_id='pf-ch-wn-wal-conflict')
    _private_observations(deleted.env)
    live = manager.create(scenario_preset_id='pf-ch-wn-wal-conflict')
    _private_observations(live.env)
    # The last constructor rebinds Flatland's shared default to the live env,
    # so no global default builder points at the environment being deleted.
    _populate(deleted.env)
    _populate(live.env)
    env_ref, rail_ref = weakref.ref(deleted.env), weakref.ref(deleted.env.rail)
    live_rail = live.env.rail
    live_uuid = live_rail.uuid
    live_grid = live_rail.grid.copy()
    configuration = live.env.agents[0].initial_configuration
    expected = live_rail.get_transitions(configuration)
    assert any(method.cache_info().currsize for method in _wrappers())
    sid = deleted.id
    del deleted
    assert manager.delete(sid)
    gc.collect()
    assert env_ref() is None and rail_ref() is None
    assert all(method.cache_info().currsize == 0 for method in _wrappers())
    assert manager.get(live.id) is live
    assert live_rail.uuid == live_uuid
    np.testing.assert_array_equal(live_rail.grid, live_grid)
    assert live_rail.get_transitions(configuration) == expected
    live.env.step({handle: 2 for handle in live.env.get_agent_handles()})
    assert live.env._elapsed_steps == 1
    manager.delete(live.id)


def test_repeated_reset_releases_retired_native_rails(monkeypatch):
    clear_native_environment_caches()
    manager = SessionManager()
    session = manager.create(width=35, height=35, number_of_agents=2, max_num_cities=2, seed=42)
    # The no-seed branch resets with native regeneration of the rail map.
    session.seed = None
    _private_observations(session.env)
    monkeypatch.setattr(session_manager, '_sessions', {session.id: session})
    retired = []
    for _ in range(4):
        _populate(session.env)
        retired.append(weakref.ref(session.env.rail))
        before = session.env.rail
        result = asyncio.run(reset_session(session.id))
        assert result['reset'] and result['elapsed_steps'] == 0
        assert session.env.rail is not before
        del before
        gc.collect()
        assert all(reference() is None for reference in retired)
    assert manager.delete(session.id)
