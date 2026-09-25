"""Route axis between two stations (app/core/route_axis.py, GET /hmi/route-axis)."""
import warnings

import pytest
from fastapi import HTTPException

warnings.filterwarnings("ignore")

from app.api.hmi import get_route_axis
from app.core.scenario_presets import select_disturbances
from app.core.session_manager import session_manager

WALENSEE = "pf-ch-wn-wal-long-approach"


@pytest.fixture(scope="module")
def walensee():
    return session_manager.create(scenario_preset_id=WALENSEE, disturbances=select_disturbances(WALENSEE, []))


@pytest.fixture(scope="module")
def olten():
    return session_manager.create(scenario_preset_id="olten")


def _tick(axis, code):
    return next(t for t in axis["ticks"] if t["code"] == code)


def test_corridor_route_reproduces_the_column_axis(walensee):
    """Acceptance check of the plan: SIB→LQ is (almost) the v1 column axis."""
    axis = get_route_axis(walensee.id, from_="SIB", to="LQ")

    assert axis["length"] == 158
    sib_col = 17
    for code, col in {"RG": 39, "BIL": 53, "ZB": 71, "WN": 87, "WAL": 124, "FMS": 136, "LQ": 175}.items():
        assert abs(_tick(axis, code)["pos"] - (col - sib_col)) <= 2, code
    # Places without tracks come along from the scene's columns.
    names = [t["name"] for t in axis["ticks"]]
    assert "Mühlehorn" in names and "Tiefenwinkel" in names


def test_ticks_are_ordered_along_the_route(walensee):
    axis = get_route_axis(walensee.id, from_="SIB", to="LQ")
    pos = [t["pos"] for t in axis["ticks"]]
    assert pos == sorted(pos)
    assert [t["code"] for t in axis["ticks"]][0] == "SIB"


def test_reverse_route_mirrors(walensee):
    fwd = get_route_axis(walensee.id, from_="SIB", to="LQ")
    rev = get_route_axis(walensee.id, from_="LQ", to="SIB")
    assert rev["length"] == fwd["length"]
    assert rev["ticks"][0]["code"] == "LQ" and rev["ticks"][-1]["code"] == "SIB"


def test_network_route_through_olten(olten):
    axis = get_route_axis(olten.id, from_="P-BERN", to="P-BASEL")
    order = [t["code"] for t in axis["ticks"]]
    assert order.index("P-BERN") < order.index("OL") < order.index("P-BASEL")
    # All of Olten's platforms on the route share one tick.
    assert order.count("OL") == 1


def test_route_via_hammer(olten):
    axis = get_route_axis(olten.id, from_="P-SOLOTHURN", to="P-AARAU")
    order = [t["code"] for t in axis["ticks"]]
    assert order.index("OL-HAMMER") < order.index("OL") < order.index("P-AARAU")


def test_cell_reference_and_unreachable(olten):
    axis = get_route_axis(olten.id, from_="0,0", to="P-BASEL")  # (0,0) is no rail
    assert axis["length"] is None and axis["cells"] == []


def test_unknown_reference_is_400(olten):
    with pytest.raises(HTTPException) as exc:
        get_route_axis(olten.id, from_="NOWHERE", to="P-BASEL")
    assert exc.value.status_code == 400
