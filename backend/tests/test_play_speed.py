"""Play tempo: a second /play while playing retunes the running loop."""
import warnings

warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient  # noqa: E402
import pytest  # noqa: E402

import asyncio  # noqa: E402
import time  # noqa: E402
from types import SimpleNamespace  # noqa: E402

from app.api import websockets  # noqa: E402
from app.core.play_manager import play_manager  # noqa: E402
from app.main import app  # noqa: E402

pytestmark = pytest.mark.integration

client = TestClient(app)


def test_play_while_playing_updates_the_speed_of_the_running_loop():
    r = client.post("/session", json={
        "width": 25, "height": 25, "number_of_agents": 2,
        "seed": 42, "max_num_cities": 2,
    })
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    policy = "deadlock_avoidance"

    r = client.post(f"/session/{sid}/play", json={"policy": policy, "speed": 0.5})
    assert r.status_code == 200, r.text
    try:
        assert play_manager.get(sid).speed == 0.5
        r = client.post(f"/session/{sid}/play", json={"policy": policy, "speed": 10})
        assert r.status_code == 200, r.text
        assert r.json()["speed"] == 10
        assert play_manager.get(sid).speed == 10
    finally:
        client.post(f"/session/{sid}/pause")


def _timed_wait(state, during=None):
    async def run():
        started = time.monotonic()
        task = asyncio.create_task(websockets._wait_for_next_step(state))
        if during:
            await asyncio.sleep(0.05)
            during(state)
        await task
        return time.monotonic() - started
    return asyncio.run(run())


def test_a_slow_speed_waits_its_whole_step(monkeypatch):
    # Below the old 0.1 steps/s floor; shrunk in time so the test stays quick.
    monkeypatch.setattr(websockets, "_WAIT_SLICE_S", 0.01)
    elapsed = _timed_wait(SimpleNamespace(speed=1 / 0.3, running=True))
    assert 0.28 <= elapsed < 0.5


def test_a_speed_change_applies_during_a_long_wait():
    # 60 s per step, then the slider moves to 10 steps/s: the wait ends at once.
    elapsed = _timed_wait(SimpleNamespace(speed=1 / 60, running=True), during=lambda s: setattr(s, "speed", 10))
    assert elapsed < 0.5


def test_pausing_ends_the_wait():
    elapsed = _timed_wait(SimpleNamespace(speed=1 / 60, running=True), during=lambda s: setattr(s, "running", False))
    assert elapsed < 0.5


def test_speed_zero_is_refused():
    r = client.post("/session", json={"width": 25, "height": 25, "number_of_agents": 2, "seed": 42, "max_num_cities": 2})
    sid = r.json()["id"]
    assert client.post(f"/session/{sid}/play", json={"policy": "deadlock_avoidance", "speed": 0}).status_code == 422
