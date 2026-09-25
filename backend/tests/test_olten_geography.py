"""Olten's names (fixtures/olten/olten.geography.json) and how /hmi/geography serves them."""
import warnings

import pytest

warnings.filterwarnings("ignore")

from app.api.hmi import get_geography
from app.core.scenario_presets import get_preset
from app.core.session_manager import session_manager
from app.core.station_names import network_geography

OLTEN_PRESETS = ["olten", "olten-disrupted", "olten-partially-closed", "olten-dense"]


def _stop_cells(env) -> set[tuple[int, int]]:
    cells = set()
    for agent in env.agents:
        for alternatives in agent.waypoints or []:
            for wp in alternatives:
                if wp.position is not None:
                    cells.add((int(wp.position[0]), int(wp.position[1])))
        cells.add((int(agent.target[0]), int(agent.target[1])))
    return cells


@pytest.mark.parametrize("preset", OLTEN_PRESETS)
def test_every_stop_and_target_cell_is_named(preset):
    session = session_manager.create(scenario_preset_id=preset)
    geo = get_geography(session.id)

    named = {tuple(s["cell"]) for s in geo["stations"]}
    assert _stop_cells(session.env) <= named
    assert geo["layout"] == "network"


def test_platforms_carry_the_real_track_numbers():
    geo = network_geography(get_preset("olten")["geography"])
    platforms = [s for s in geo["stations"] if s["kind"] == "platform"]
    assert [s["track"] for s in platforms] == [1, 2, 3, 4, 7, 8, 9, 10, 11, 12]
    assert all(s["name"] == "Olten" and s["cell"][0] == 37 for s in platforms)
    kinds = {s["kind"] for s in geo["stations"]}
    assert kinds == {"platform", "stop", "portal"}


def test_named_cells_are_rail():
    session = session_manager.create(scenario_preset_id="olten")
    rail = session.env.rail
    for s in get_geography(session.id)["stations"]:
        r, c = s["cell"]
        assert rail.grid[r][c] != 0, s


def test_corridor_scene_is_marked_as_corridor():
    from app.core.scenario_presets import select_disturbances

    session = session_manager.create(
        scenario_preset_id="pf-ch-wn-wal-long-approach",
        disturbances=select_disturbances("pf-ch-wn-wal-long-approach", []),
    )
    assert get_geography(session.id)["layout"] == "corridor"


def test_generated_network_has_no_layout():
    session = session_manager.create()
    geo = get_geography(session.id)
    assert geo["stations"] == [] and "layout" not in geo
