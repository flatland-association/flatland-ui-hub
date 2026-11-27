"""The first Director plan of a session without the Director panel (e.g. the
direct-driver RL layouts in Director) is planned off the event loop, so a
minutes-long plan does not block Pause or any other request."""
import asyncio
import threading
import time

import httpx

from app.main import app


async def test_first_director_plan_keeps_the_server_responsive(monkeypatch):
    import app.policies.goal_directed_policy as gd

    planned = threading.Event()
    calls = []

    def slow_plan(env):
        calls.append(threading.current_thread() is threading.main_thread())
        time.sleep(1.0)
        planned.set()

    monkeypatch.setattr(gd, "GoalDirectedPolicy", slow_plan)
    monkeypatch.setattr(gd, "plan_player", lambda env: None)

    import app.api.sessions as sessions

    monkeypatch.setattr(sessions, "_step_sync", lambda session_id, req: {"session_id": session_id})

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 2, "seed": 1})
        sid = created.json()["id"]
        step = asyncio.create_task(client.post(f"/session/{sid}/step", json={"policy": "goal_directed", "n_steps": 1}))
        await asyncio.sleep(0.2)
        started = time.perf_counter()
        status = await client.get(f"/session/{sid}/play_status")
        assert status.status_code == 200
        assert time.perf_counter() - started < 0.5, "a request waited for the Director's plan"
        assert not planned.is_set()
        assert (await step).status_code == 200
        await client.delete(f"/session/{sid}")
    assert calls == [False], "the first plan ran once, off the event loop"
