"""Live runs: random breakdowns on a scenario preset, reproducible by seed
(env_factory.apply_live_malfunctions; docs/plans/live-tours-shift-rounds.md)."""
import warnings

from fastapi.testclient import TestClient

warnings.filterwarnings("ignore")

from app.core.scenario_runner import TrajectoryBranchRunner  # noqa: E402
from app.core.session_manager import session_manager  # noqa: E402
from app.main import app  # noqa: E402

PRESET = "pf-ch-wn-wal-long-approach"


def _breakdowns(client, sid, steps=120):
    """(step, handle) of every breakdown start over `steps` steps."""
    out = []
    session = session_manager.get(sid)
    down = {h: 0 for h in range(len(session.env.agents))}
    for _ in range(steps):
        client.post(f"/session/{sid}/step", json={"policy": session.policy, "n_steps": 1})
        for h, a in enumerate(session.env.agents):
            c = a.malfunction_handler.malfunction_down_counter
            if c > 0 and down[h] == 0:
                out.append((session.env._elapsed_steps, h))
            down[h] = c
    return out


def _live(client, seed):
    r = client.post("/session", json={
        "scenario_preset_id": PRESET, "seed": seed,
        "malfunction_rate": 0.01, "malfunction_min_duration": 10, "malfunction_max_duration": 30,
    })
    assert r.status_code == 200, r.text
    return r.json()


def test_a_live_run_breaks_down_and_its_seed_reproduces_it():
    client = TestClient(app)
    a = _live(client, 7)
    assert a["live_seed"] == 7
    first = _breakdowns(client, a["id"])
    assert first, "a live run at this rate should see a breakdown"
    assert _breakdowns(client, _live(client, 7)["id"]) == first
    assert _breakdowns(client, _live(client, 8)["id"]) != first


def test_a_reset_replays_the_same_breakdowns():
    client = TestClient(app)
    sid = _live(client, 7)["id"]
    first = _breakdowns(client, sid)
    client.post(f"/session/{sid}/reset")
    assert _breakdowns(client, sid) == first


def test_the_scripted_preset_stays_without_random_breakdowns():
    client = TestClient(app)
    r = client.post("/session", json={"scenario_preset_id": PRESET})
    assert r.json()["live_seed"] is None
    assert _breakdowns(client, r.json()["id"]) == []


def test_a_forecast_does_not_foresee_random_breakdowns():
    client = TestClient(app)
    session = session_manager.get(_live(client, 7)["id"])
    runner = TrajectoryBranchRunner(session.env, lambda env: None)
    fork = runner._fork_env()
    assert type(fork.malfunction_generator).__name__ == "NoMalfunctionGen"
