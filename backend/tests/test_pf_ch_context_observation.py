"""Optional PF-CH context preserves masks and reflects only current state."""
from types import SimpleNamespace

import numpy as np
import pytest

from app.core.env_factory import create_env
from app.policies.learned.ecml_observation import FastTreeObsBuilder
from app.policies.learned.pf_ch_observation import (
    BASE_FEATURES,
    CONTEXT_OFFSET,
    MAX_TRAINS,
    OBSERVATION_DIM,
    OWN_FEATURES,
    PEER_FEATURES,
    PFChObservationBuilder,
)
from app.core.env_step import step_env
from app.core.session_manager import SessionManager

PRESET = "pf-ch-wn-wal-long-approach"
pytestmark = pytest.mark.integration


def _episode(preset, disturbances=()):
    # Exercise the actual live step contract, without importing training code.
    session = SessionManager().create(scenario_preset_id=preset, max_episode_steps=320,
                                      disturbances=list(disturbances))
    builder = PFChObservationBuilder()
    builder.reset(session.env)
    return SimpleNamespace(env=session.env, builder=builder,
                           horizon=int(session.env._max_episode_steps),
                           handles=list(session.env.get_agent_handles()),
                           step=lambda actions: step_env(session.id, session, actions))


def test_layout_and_mask_match_service_builder_and_padding_is_zero():
    env = create_env(scenario_preset_id=PRESET)
    context = PFChObservationBuilder()
    context.reset(env)
    service = FastTreeObsBuilder()
    service.reset(env)
    rows = context.get_many(env.get_agent_handles())
    assert OBSERVATION_DIM == BASE_FEATURES + OWN_FEATURES + MAX_TRAINS * PEER_FEATURES == 272
    for handle, row in rows.items():
        baseline = service.get(handle)
        assert row.shape == (277,)
        assert row.dtype == np.float32 and np.isfinite(row).all()
        np.testing.assert_array_equal(row[:BASE_FEATURES], baseline[:BASE_FEATURES])
        np.testing.assert_array_equal(row[-5:], baseline[-5:])
        peers = row[CONTEXT_OFFSET:OBSERVATION_DIM].reshape(MAX_TRAINS, PEER_FEATURES)
        np.testing.assert_array_equal(peers[:3, 0], np.ones(3))
        np.testing.assert_array_equal(peers[3:], np.zeros((13, PEER_FEATURES)))
        assert row[BASE_FEATURES] == pytest.approx(handle / 15)
    unmasked = PFChObservationBuilder(with_action_mask=False)
    unmasked.reset(env)
    assert unmasked.get(0).shape == (272,)


def test_context_changes_with_a_peer_and_recreation_preserves_observations():
    episode = _episode(PRESET)
    before = episode.builder.get(0)
    for _ in range(2):
        episode.step({0: 0, 1: 2, 2: 0})
    after = episode.builder.get(0)
    peer = CONTEXT_OFFSET + PEER_FEATURES
    assert before[peer + 1] == 0 and after[peer + 1] == 1
    assert before[BASE_FEATURES] == after[BASE_FEATURES] == 0
    fresh = PFChObservationBuilder()
    fresh.reset(episode.env)
    np.testing.assert_array_equal(after, fresh.get(0))
    np.testing.assert_array_equal(after, episode.builder.get_many([0])[0])


def test_same_step_intervention_is_visible_without_stale_peer_cache():
    episode = _episode(PRESET)
    before = episode.builder.get_many([0])[0]
    episode.env.agents[1].malfunction_handler.malfunction_down_counter = 8
    after = episode.builder.get_many([0])[0]
    counter = CONTEXT_OFFSET + PEER_FEATURES + 9
    assert before[counter] == 0
    assert after[counter] == pytest.approx(8 / 32)
    assert episode.builder.get(1)[BASE_FEATURES + 11] == pytest.approx(8 / episode.horizon)
    fresh = PFChObservationBuilder()
    fresh.reset(episode.env)
    np.testing.assert_array_equal(after, fresh.get(0))


def test_future_script_does_not_leak_into_context():
    normal = _episode(PRESET)
    scripted = _episode(PRESET, disturbances=({"id": "hidden", "events": [
        {"step": 2, "type": "train_delay", "agent_handle": 1, "delay_steps": 8},
    ]},))
    np.testing.assert_array_equal(normal.builder.get(0), scripted.builder.get(0))
    for _ in range(2):
        normal.step({h: 2 for h in normal.handles})
        scripted.step({h: 2 for h in scripted.handles})
    counter = CONTEXT_OFFSET + PEER_FEATURES + 9
    assert normal.builder.get(0)[counter] == 0
    assert scripted.builder.get(0)[counter] == pytest.approx(8 / 32)


def test_base_topology_cache_is_refreshed_after_an_area_change():
    episode = _episode("pf-ch-corridor-stops")
    episode.builder.get(0)
    episode.env.rail.set_transitions((0, 96), 0)
    fresh = PFChObservationBuilder()
    fresh.reset(episode.env)
    np.testing.assert_array_equal(episode.builder.get(0), fresh.get(0))


@pytest.mark.parametrize("scene,agents", [("unknown", 3), ("scene_pf_ch_corridor", 17)])
def test_unsupported_scenes_and_oversized_context_fail_closed(scene, agents):
    env = SimpleNamespace(_infrastructure_scene={"id": scene}, width=191, height=9,
                          agents=[SimpleNamespace(handle=handle) for handle in range(agents)])
    with pytest.raises(ValueError):
        PFChObservationBuilder().reset(env)



def test_own_motion_state_does_not_require_selecting_a_peer_slot():
    episode = _episode(PRESET)
    for _ in range(2):
        episode.step({0: 2, 1: 0, 2: 0})
    moving = episode.builder.get(0)
    assert moving[BASE_FEATURES + 1] == 1
    assert moving[BASE_FEATURES + 9] == 0
    episode.step({0: 4, 1: 0, 2: 0})
    stopped = episode.builder.get(0)
    assert stopped[BASE_FEATURES + 1] == 0
    assert stopped[BASE_FEATURES + 9] == 1
