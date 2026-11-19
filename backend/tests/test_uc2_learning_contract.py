"""The offline UC2 adapter must execute the actual locked native scenarios."""
from __future__ import annotations

import numpy as np
import pytest

from app.core.env_factory import create_env
from app.core.native_env_cache import clear_native_environment_caches
from app.core.scenario_presets import get_preset
from app.utils.agent_compat import agent_direction, agent_position
from lab.marl.pf_ch_episode import PFChCase, PFChEpisode

pytestmark = pytest.mark.integration

NATIVE = {
    "tutorial": (25, 6, 2, 40),
    "uc2-1": (78, 8, 3, 168),
    "uc2-2": (78, 8, 3, 102),
    "uc2-3": (78, 8, 3, 240),
    "uc2-4": (78, 8, 3, 180),
}


def _physical_state(env):
    return (
        env._elapsed_steps,
        env._max_episode_steps,
        tuple((int(a.state), agent_position(a), agent_direction(a),
               int(a.malfunction_handler.malfunction_down_counter),
               float(a.speed_counter.speed)) for a in env.agents),
        dict(env.dones),
    )


@pytest.mark.parametrize("preset", NATIVE)
def test_offline_adapter_preserves_locked_native_physics_and_faults(preset):
    episode = PFChEpisode(PFChCase(preset=preset, case_id=f"contract-{preset}"))
    native = create_env(scenario_preset_id=preset)
    try:
        assert get_preset(preset)["locked"]
        assert (episode.env.width, episode.env.height, len(episode.handles), episode.horizon) == NATIVE[preset]
        assert np.array_equal(episode.env.rail.grid, native.rail.grid)
        assert _physical_state(episode.env) == _physical_state(native)
        counter_spikes = []
        for _ in range(min(45, episode.horizon)):
            if episode.done:
                break
            _, masks = episode.observe()
            actions = {h: 2 if mask[2] else int(np.flatnonzero(mask)[0])
                       for h, mask in zip(episode.handles, masks, strict=True)}
            before = [int(a.malfunction_handler.malfunction_down_counter) for a in native.agents]
            native.step(actions)
            episode.step(actions)
            assert _physical_state(episode.env) == _physical_state(native)
            for h, agent in enumerate(native.agents):
                counter = int(agent.malfunction_handler.malfunction_down_counter)
                if counter > before[h]:
                    counter_spikes.append((native._elapsed_steps, h, before[h], counter))
        observed = episode.metrics()["observed_malfunction_counter_increases"]
        assert [(x["step"], x["handle"], x["counter_before"], x["counter_after"]) for x in observed] == counter_spikes
        assert counter_spikes, "This native scripted fault must remain active during the test"
        assert episode.metrics()["native_on_map_positive_counter_steps"] > 0
    finally:
        episode.close()
        clear_native_environment_caches()


@pytest.mark.parametrize("preset", NATIVE)
def test_uc2_horizon_cannot_be_extended_to_make_a_failed_demo_pass(preset):
    with pytest.raises(ValueError, match="native locked episode horizon"):
        PFChCase(preset=preset, horizon=NATIVE[preset][-1] + 100)


def test_case_adapter_still_rejects_unreviewed_presets():
    with pytest.raises(ValueError, match="named UC2"):
        PFChCase(preset="some-other-map")
