from app.core.scenario_presets import list_presets, select_disturbances

PRESET = "pf-ch-wn-wal-long-approach"
TOUR_ID = "interview-e1-breakdown-single-track"


def test_tour_disturbance_is_selectable_by_id():
    selected = select_disturbances(PRESET, [TOUR_ID])
    assert [d["id"] for d in selected] == [TOUR_ID]


def test_tour_disturbance_is_not_offered_in_the_picker():
    preset = next(p for p in list_presets() if p["id"] == PRESET)
    assert TOUR_ID not in {d["id"] for d in preset["disturbances"]}
    assert "tour_disturbances" not in preset


def test_study_disturbances_are_still_offered():
    preset = next(p for p in list_presets() if p["id"] == PRESET)
    assert "e1-late-into-the-section" in {d["id"] for d in preset["disturbances"]}


def test_olten_tour_breakdown_blocks_a_train_on_the_tour_section():
    """The Olten tour's disruption must produce a contention on its section."""
    import warnings
    warnings.filterwarnings("ignore")
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.hmi import get_contentions, get_route_axis
    from app.core.session_manager import session_manager

    assert "olten-breakdown-south" not in {d["id"] for d in next(p for p in list_presets() if p["id"] == "olten")["disturbances"]}
    session = session_manager.create(
        scenario_preset_id="olten", disturbances=select_disturbances("olten", ["olten-breakdown-south"]),
    )
    TestClient(app).post(f"/session/{session.id}/step", json={"policy": "deadlock_avoidance", "n_steps": 56})
    route = {(r, c) for r, c, _ in get_route_axis(session.id, from_="P-BERN", to="P-BASEL")["cells"]}
    groups = get_contentions(session.id)["groups"]
    assert any(len(g["handles"]) >= 2 and any(tuple(w) in route for w in g["window"]) for g in groups)
