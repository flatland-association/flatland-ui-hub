"""Play tempo: a second /play while playing retunes the running loop."""
import warnings

warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.play_manager import play_manager  # noqa: E402
from app.main import app  # noqa: E402

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
