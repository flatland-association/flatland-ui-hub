"""Regression tests for HMI cache keys and Marey trajectory anchoring."""

import warnings

from fastapi.testclient import TestClient
import pytest

from app.main import app

pytestmark = pytest.mark.integration

warnings.filterwarnings("ignore")

client = TestClient(app)


def _make_session(num_agents: int = 2) -> str:
    r = client.post(
        "/session",
        json={
            "width": 25,
            "height": 25,
            "number_of_agents": num_agents,
            "seed": 42,
            "max_num_cities": 2,
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _drive_until_on_map(sid: str, max_tries: int = 6, step_chunk: int = 10) -> int:
    """Step until at least one agent is on-map; return current elapsed_steps."""
    for _ in range(max_tries):
        st = client.get(f"/session/{sid}/state")
        assert st.status_code == 200, st.text
        state = st.json()
        if any(a.get("position") is not None for a in state.get("agents", [])):
            return int(state.get("elapsed_steps", 0))
        r = client.post(
            f"/session/{sid}/step",
            json={"n_steps": step_chunk, "policy": "deadlock_avoidance"},
        )
        assert r.status_code == 200, r.text
    st = client.get(f"/session/{sid}/state")
    assert st.status_code == 200, st.text
    return int(st.json().get("elapsed_steps", 0))


def test_hmi_debug_override_hash_changes_on_override_update():
    sid = _make_session()

    d0 = client.get(f"/session/{sid}/hmi/debug")
    assert d0.status_code == 200, d0.text
    h0 = d0.json()["override_hash"]

    set_r = client.post(f"/session/{sid}/agent/0/override", json={"action": 1})
    assert set_r.status_code == 200, set_r.text

    d1 = client.get(f"/session/{sid}/hmi/debug")
    assert d1.status_code == 200, d1.text
    h1 = d1.json()["override_hash"]

    assert h1 != h0, "override hash should change after setting an override"

    clr_r = client.delete(f"/session/{sid}/agent/0/override")
    assert clr_r.status_code == 200, clr_r.text

    d2 = client.get(f"/session/{sid}/hmi/debug")
    assert d2.status_code == 200, d2.text
    h2 = d2.json()["override_hash"]

    assert h2 == h0, "override hash should return to base value after clearing"


def test_scenarios_trajectories_include_now_step_anchor():
    sid = _make_session(num_agents=2)
    now = _drive_until_on_map(sid)

    r = client.get(f"/session/{sid}/hmi/scenarios?horizon=30")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body, list)
    assert len(body) >= 1

    anchored = False
    for sc in body:
        trajectories = sc.get("trajectories") or {}
        for points in trajectories.values():
            for p in points:
                if int(p.get("step", -1)) == now:
                    anchored = True
                    break
            if anchored:
                break
        if anchored:
            break

    # For real scenario runs, the trajectory stream must include the current
    # state anchor at step=now (history/forecast join point).
    assert anchored, f"expected at least one trajectory point at now={now}"
