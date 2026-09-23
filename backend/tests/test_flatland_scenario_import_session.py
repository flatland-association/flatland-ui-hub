"""Session creation from a flatland-scenarios drawing-tool JSON export.

Mirrors test_infrastructure_scene_session.py's shape, for the native
ingestion path in app/core/flatland_scenario_import.py (see CLAUDE.md:
flatland-scenarios' own JSON keys are "the format to target").
"""

from app.core.session_manager import session_manager


def _straight_flatland_scenario():
    """A straight 1-agent line on an 8x5 grid, cols 1-6 of row 2.

    Transition ints computed the same way infrastructure_scene_adapter.py
    would for connections ["E"] / ["E", "W"] / ["W"] — 4 (dead end facing
    E), 1025 (straight E-W), 256 (dead end facing W).
    """
    grid = [[0] * 8 for _ in range(5)]
    grid[2][1] = 4
    grid[2][2] = 1025
    grid[2][3] = 1025
    grid[2][4] = 1025
    grid[2][5] = 1025
    grid[2][6] = 256

    return {
        "gridDimensions": {"rows": 5, "cols": 8, "cellSize": 28},
        "grid": grid,
        "overpasses": [],
        "stations": [],
        "nextStationId": 1,
        "lines": [],
        "timetables": [],
        "trainCategories": {},
        "flatlandLine": {
            # One pre-target waypoint group per agent; to_line_generator()
            # appends the final [Waypoint(target, None)] group itself.
            "agent_positions": [[[[2, 1]]]],
            "agent_directions": [[[3]]],
            "agent_targets": [[2, 6]],
            "agent_speeds": [1.0],
        },
        "flatlandTimetable": {
            "earliest_departures": [[0, 0]],
            "latest_arrivals": [[0, 20]],
            "max_episode_steps": 40,
        },
    }


def test_session_manager_uses_flatland_scenario_json_for_env_generation():
    session = session_manager.create(
        width=30,
        height=30,
        number_of_agents=3,
        seed=42,
        max_num_cities=2,
        max_rails_between_cities=2,
        max_rail_pairs_in_city=2,
        max_episode_steps=100,
        latest_departure_max=20,
        speed_profile="uniform_1_0",
        line_length=4,
        malfunction_rate=0,
        malfunction_min_duration=5,
        malfunction_max_duration=20,
        flatland_scenario_json=_straight_flatland_scenario(),
    )

    assert session.flatland_scenario_json is not None
    assert session.env.width == 8
    assert session.env.height == 5
    assert len(session.env.agents) == 1
    assert int((session.env.rail.grid != 0).sum()) == 6


def test_flatland_scenario_train_can_depart():
    session = session_manager.create(
        width=30,
        height=30,
        number_of_agents=1,
        seed=42,
        max_num_cities=2,
        max_rails_between_cities=2,
        max_rail_pairs_in_city=2,
        max_episode_steps=100,
        latest_departure_max=0,
        speed_profile="uniform_1_0",
        line_length=4,
        malfunction_rate=0,
        malfunction_min_duration=5,
        malfunction_max_duration=20,
        flatland_scenario_json=_straight_flatland_scenario(),
    )

    agent = session.env.agents[0]
    assert agent.initial_direction == 3
    assert session.env.rail.get_transitions((agent.initial_position, agent.initial_direction)) == (0, 1, 0, 0)

    session.env.step({0: 2})
    session.env.step({0: 2})
    session.env.step({0: 2})

    assert agent.position == (2, 2)
    assert agent.direction == 1
    assert getattr(agent.state, "name", str(agent.state)) == "MOVING"


def test_session_api_uses_payload_flatland_scenario_json_instead_of_random_generation():
    import pytest

    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    response = client.post("/session", json={
        "width": 30,
        "height": 30,
        "number_of_agents": 3,
        "seed": 42,
        "max_num_cities": 2,
        "flatland_scenario_json": _straight_flatland_scenario(),
    })

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["width"] == 8
    assert payload["height"] == 5
    assert payload["num_agents"] == 1


def test_session_api_returns_400_for_malformed_flatland_scenario_json():
    import pytest

    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from app.main import app

    # Passes the cheap scenario_dimensions() check (valid gridDimensions, one
    # agent) but is missing "grid" — Scenario(...) KeyErrors deep inside
    # session_manager.create(), which sessions.py must turn into a 400, not
    # an unhandled 500.
    malformed = _straight_flatland_scenario()
    del malformed["grid"]

    client = TestClient(app)
    response = client.post("/session", json={
        "width": 30,
        "height": 30,
        "number_of_agents": 3,
        "seed": 42,
        "max_num_cities": 2,
        "flatland_scenario_json": malformed,
    })

    assert response.status_code == 400, response.text
    assert "flatland scenario" in response.json()["detail"].lower()


def test_infrastructure_scene_and_flatland_scenario_json_are_mutually_exclusive():
    import pytest

    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    response = client.post("/session", json={
        "width": 30,
        "height": 30,
        "infrastructure_scene": {"id": "x", "grid": {"width": 8, "height": 5}, "cells": [], "agents": []},
        "flatland_scenario_json": _straight_flatland_scenario(),
    })

    assert response.status_code == 400
