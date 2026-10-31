"""Passenger connections a scene defines (scene `connections`, /hmi/geography).

The `pf-ch-wn-wal-connections` preset is the long-approach conflict plus a
connecting service: W1 (FMS->WN) feeds W2 (WN->ZB) at Weesen. The plan gives
the transfer 8 steps; the Kolb tour's disturbance delays W1 by 20, so the
connection only holds if the dispatcher holds W2.
"""
import json
import warnings

import pytest
from flatland.envs.step_utils.states import TrainState

warnings.filterwarnings("ignore")

from app.api.hmi import get_geography
from app.core.infrastructure_scene_adapter import scene_connections
from app.core.scenario_presets import select_disturbances
from app.core.session_manager import session_manager
PRESET = "pf-ch-wn-wal-connections"
SCENE = "app/fixtures/pf_ch/pf-ch-wn-wal-connections.scene.json"
W1, W2 = 2, 3


def _scene():
    with open(SCENE, encoding="utf-8") as f:
        return json.load(f)


def test_scene_ids_resolve_to_handles_in_line_order():
    assert scene_connections(_scene()) == [{
        "id": "conn_wn_w1_w2",
        "station": "WN",
        "feeder": W1,
        "connector": W2,
        "min_transfer": 2,
    }]


def test_unknown_agents_and_self_pairs_are_skipped():
    scene = _scene()
    scene["connections"] = [
        {"station": "WN", "feeder": "train_9", "connector": "train_4"},
        {"station": "WN", "feeder": "train_4", "connector": "train_4"},
        {"feeder": "train_3", "connector": "train_4"},
        "not a connection",
    ]
    assert scene_connections(scene) == []


def test_a_scene_without_connections_defines_none():
    scene = _scene()
    del scene["connections"]
    assert scene_connections(scene) == []


@pytest.mark.integration
def test_geography_serves_the_defined_connections():
    session = session_manager.create(
        scenario_preset_id=PRESET, disturbances=select_disturbances(PRESET, []),
    )
    geo = get_geography(session.id)
    assert geo["layout"] == "corridor"
    assert [(c["station"], c["feeder"], c["connector"]) for c in geo["connections"]] == [("WN", W1, W2)]


def _transfer(disturbance_ids):
    """(step W1 reaches Weesen, last step W2 stands there) under the plan."""
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    r = client.post("/session", json={"scenario_preset_id": PRESET, "disturbance_ids": disturbance_ids})
    assert r.status_code == 200, r.text
    session = session_manager.get(r.json()["id"])
    w1_at_wn = w2_at_wn = None
    for step in range(1, 181):
        client.post(f"/session/{session.id}/step", json={"policy": session.policy, "n_steps": 1})
        for handle, agent in enumerate(session.env.agents):
            pos = agent.position
            if pos is None:
                continue
            if handle == W1 and w1_at_wn is None and abs(pos[0] - 2) + abs(pos[1] - 87) <= 1:
                w1_at_wn = step
            if handle == W2 and abs(pos[0] - 4) + abs(pos[1] - 87) <= 1:
                w2_at_wn = step
        if all(a.state == TrainState.DONE for a in session.env.agents):
            break
    return w1_at_wn, w2_at_wn


@pytest.mark.integration
def test_the_plan_gives_the_transfer_eight_steps():
    assert _transfer([]) == (56, 64)


@pytest.mark.integration
def test_the_kolb_disturbance_breaks_the_connection_unless_w2_is_held():
    w1_at_wn, w2_at_wn = _transfer(["advanced-e2-breakdown-counter-train"])
    assert w2_at_wn == 64            # W2 leaves on schedule: nothing knows about the transfer
    assert w1_at_wn > w2_at_wn       # so W1's passengers arrive after it has gone