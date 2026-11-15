"""Native UC2 schema identity, current fractional motion and prefix/mask parity."""
import copy
from fractions import Fraction

import numpy as np
import pytest
from flatland.envs.rail_env_action import RailEnvActions

from app.core.env_factory import create_env
from app.core.native_env_cache import clear_native_environment_caches
from app.policies.learned.ecml_observation import FastTreeObsBuilder
from app.policies.learned.pf_ch_observation import OBSERVATION_DIM as CONTEXT_DIM
from app.policies.learned.pf_ch_observation import PFChObservationBuilder
from app.policies.learned.uc2_observation import (
    GEOMETRY_OFFSET,
    OBSERVATION_DIM,
    OBSERVATION_SCHEMA,
    OWN_MOTION_OFFSET,
    PEER_MOTION_OFFSET,
    SCENARIO_IDS,
    SCENARIO_OFFSET,
    UC2ObservationBuilder,
)

pytestmark = pytest.mark.integration


@pytest.fixture
def native_env():
    created = []

    def make(preset):
        env = create_env(scenario_preset_id=preset)
        created.append(env)
        return env

    yield make
    created.clear()
    clear_native_environment_caches()


def _prefix_builder(env):
    # Assemble the unchanged parent layout on the same physical UC2 state,
    # without modifying the parent's intentionally PF-CH-only reset contract.
    parent = PFChObservationBuilder()
    parent.env = env
    parent.base.reset(env)
    parent._rail_state = parent._rail_snapshot()
    return parent


@pytest.mark.parametrize("preset", SCENARIO_IDS)
def test_native_fixtures_have_313_features_and_exact_parent_prefix_masks(native_env, preset):
    env = native_env(preset)
    builder = UC2ObservationBuilder()
    builder.reset(env)
    parent = _prefix_builder(env)
    service = FastTreeObsBuilder()
    service.reset(env)
    assert OBSERVATION_DIM == 313 and builder.schema == OBSERVATION_SCHEMA
    assert builder.scenario_id == preset
    for handle, row in builder.get_many().items():
        assert row.shape == (318,) and row.dtype == np.float32 and np.isfinite(row).all()
        np.testing.assert_array_equal(row[:CONTEXT_DIM], parent.get(handle)[:CONTEXT_DIM])
        np.testing.assert_array_equal(row[-5:], parent.get(handle)[-5:])
        np.testing.assert_array_equal(row[-5:], service.get(handle)[-5:])
        np.testing.assert_array_equal(row, builder.get(handle))
        np.testing.assert_array_equal(row[SCENARIO_OFFSET:GEOMETRY_OFFSET], np.eye(5)[SCENARIO_IDS.index(preset)])
        np.testing.assert_allclose(row[GEOMETRY_OFFSET:OWN_MOTION_OFFSET], [env.height / 8, env.width / 78])
        peers = row[PEER_MOTION_OFFSET:OBSERVATION_DIM].reshape(16, 2)
        np.testing.assert_array_equal(peers[len(env.agents):], np.zeros((16 - len(env.agents), 2)))
    unmasked = UC2ObservationBuilder(with_action_mask=False)
    unmasked.reset(env)
    assert unmasked.get(0).shape == (313,)
    np.testing.assert_array_equal(unmasked.get(0), builder.get(0)[:313])
    with pytest.raises(ValueError, match="PF-CH geometry"):
        PFChObservationBuilder().reset(env)


def test_native_fractional_speed_and_live_cell_progress_are_visible_without_stale_cache(native_env):
    env = native_env("uc2-3")
    builder = UC2ObservationBuilder()
    builder.reset(env)
    initial = builder.get(0)
    assert initial[OWN_MOTION_OFFSET] == pytest.approx(.6)
    assert initial[OWN_MOTION_OFFSET + 1] == 0
    fractions = []
    for _ in range(12):
        env.step({0: RailEnvActions.MOVE_FORWARD, 1: RailEnvActions.DO_NOTHING, 2: RailEnvActions.DO_NOTHING})
        row = builder.get(0)
        fractions.append(row[OWN_MOTION_OFFSET + 1])
        assert row[OWN_MOTION_OFFSET] == pytest.approx(float(env.agents[0].speed_counter.speed))
        assert row[OWN_MOTION_OFFSET + 1] == pytest.approx(float(env.agents[0].speed_counter.distance))
        np.testing.assert_array_equal(row[OWN_MOTION_OFFSET:OWN_MOTION_OFFSET + 2],
                                      row[PEER_MOTION_OFFSET:PEER_MOTION_OFFSET + 2])
        np.testing.assert_array_equal(row, builder.get_many([0])[0])
    assert any(0 < fraction < 1 for fraction in fractions)
    env.agents[1].speed_counter.step(Fraction(1, 2))
    changed = builder.get_many([0])[0]
    assert changed[PEER_MOTION_OFFSET + 2] == pytest.approx(.5)
    assert changed[PEER_MOTION_OFFSET + 3] == pytest.approx(float(env.agents[1].speed_counter.distance))
    fresh = UC2ObservationBuilder()
    fresh.reset(env)
    np.testing.assert_array_equal(changed, fresh.get(0))


def test_future_effect_generators_do_not_enter_observations_but_current_faults_do(native_env):
    env = native_env("uc2-4")
    fork = copy.deepcopy(env)
    fork.effects_generator = object()  # observation must not inspect scheduled future effects
    normal, changed = UC2ObservationBuilder(), UC2ObservationBuilder()
    normal.reset(env)
    changed.reset(fork)
    np.testing.assert_array_equal(normal.get(0), changed.get(0))
    fork.agents[1].malfunction_handler.malfunction_down_counter = 8
    assert not np.array_equal(normal.get(0), changed.get(0))


@pytest.mark.parametrize("mutation", ["horizon", "rail", "stock", "handles"])
def test_unrecognised_geometry_or_stock_fails_closed(native_env, mutation):
    env = native_env("uc2-1")
    if mutation == "horizon":
        env._max_episode_steps += 1
    elif mutation == "rail":
        env.rail.grid[0, 0] ^= 1
    elif mutation == "stock":
        env.agents[0].initial_configuration = ((2, 6), 1)
    else:
        env.agents[0].handle = 7
    with pytest.raises(ValueError, match="uc2-context-v1"):
        UC2ObservationBuilder().reset(env)


def test_timetable_shifts_and_native_deepcopy_keep_fixture_identity(native_env):
    env = native_env("uc2-2")
    for handle, agent in enumerate(env.agents):
        agent.earliest_departure += handle + 1
        agent.latest_arrival += handle + 1
    env = copy.deepcopy(env)
    builder = UC2ObservationBuilder()
    builder.reset(env)
    assert builder.scenario_id == "uc2-2"
    assert builder.get(0).shape == (318,)


def test_failed_reset_cannot_reuse_previous_scene_identity(native_env):
    env = native_env("uc2-1")
    builder = UC2ObservationBuilder()
    builder.reset(env)
    env._max_episode_steps = 169
    with pytest.raises(ValueError, match="supported native"):
        builder.reset(env)
    assert builder.scenario_id is None
    with pytest.raises(ValueError, match="must be reset"):
        builder.get(0)
