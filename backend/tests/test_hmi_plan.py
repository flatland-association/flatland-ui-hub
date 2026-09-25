"""GET /hmi/plan — the baseline timetable the Zug-Weg-Diagramm measures delay against."""
import warnings

import pytest
from fastapi import HTTPException

warnings.filterwarnings("ignore")

from app.api.hmi import get_plan
from app.core.plans import load_plan
from app.core.scenario_presets import select_disturbances
from app.core.session_manager import session_manager
from app.policies.plan_policy import install_trainrun_plan

PRESET = "pf-ch-wn-wal-long-approach"
PLAN = "app/fixtures/pf_ch/pf-ch-wn-wal-long-approach.plan.json"


def _session():
    return session_manager.create(
        scenario_preset_id=PRESET, disturbances=select_disturbances(PRESET, []),
    )


def test_serves_the_scenario_plan_cell_by_cell():
    session = _session()

    plan = get_plan(session.id)

    assert plan["hasPlan"] is True
    expected = load_plan(PLAN)
    assert set(plan["trainruns"]) == {str(h) for h in expected}
    run0 = plan["trainruns"]["0"]
    assert len(run0) == len(expected[0])
    first = expected[0][0]
    assert run0[0] == {
        "step": int(first.scheduled_at),
        "row": int(first.waypoint.position[0]),
        "col": int(first.waypoint.position[1]),
    }
    steps = [e["step"] for e in run0]
    assert steps == sorted(steps)


def test_stays_on_the_timetable_after_a_replan():
    session = _session()
    before = get_plan(session.id)

    # An accepted replan swaps the plan the trains run on; the yardstick must not move.
    replan = {h: run[:1] for h, run in load_plan(PLAN).items()}
    install_trainrun_plan(session.env, replan)

    assert get_plan(session.id) == before


def test_generated_network_has_no_plan():
    session = session_manager.create()

    assert get_plan(session.id) == {"hasPlan": False, "trainruns": {}}


def test_unknown_session_is_404():
    with pytest.raises(HTTPException) as exc:
        get_plan("no-such-session")
    assert exc.value.status_code == 404
