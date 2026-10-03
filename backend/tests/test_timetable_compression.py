"""Olten dense: the same timetable with departures compressed threefold
(env_factory.compress_timetable, preset `olten-dense`)."""
import warnings

warnings.filterwarnings("ignore")

from app.core.env_factory import load_preset_env


def _runs(env):
    out = {}
    for a in env.agents:
        out[a.handle] = (
            int(a.earliest_departure),
            int(a.latest_arrival),
            list(a.waypoints_earliest_departure or []),
            list(a.waypoints_latest_arrival or []),
        )
    return out


def test_every_train_is_shifted_as_a_whole():
    original = _runs(load_preset_env("olten"))
    dense = _runs(load_preset_env("olten-dense"))

    assert max(v[0] for v in dense.values()) <= max(v[0] for v in original.values()) / 3 + 1
    for h, (ed, la, wed, wla) in original.items():
        ded, dla, dwed, dwla = dense[h]
        shift = ed - ded
        assert shift >= 0
        assert la - dla == shift                      # running time kept
        assert [None if t is None else t - shift for t in wed] == dwed
        assert [None if t is None else t - shift for t in wla] == dwla


def test_dense_preset_has_its_own_horizon_and_the_original_is_untouched():
    dense = load_preset_env("olten-dense")
    original = load_preset_env("olten")
    assert dense._max_episode_steps == 700
    assert original._max_episode_steps == 1300
    assert max(a.earliest_departure for a in original.agents) == 1140
