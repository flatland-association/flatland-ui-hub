"""A held train released at the end of a course that assumed it would stand.

uc2-4 with seed 42: train 0 breaks down at step 20, train 1 behind it is held.
An AI course taken for train 0 while train 1 is held lists only the cell train 1
stands on. Before the fix, releasing train 1 («Plan behalten») left it standing
there for the rest of the run. Now the course is dropped for every train once
the released train is at the end of its cut-short run, and deadlock avoidance
drives them all (`PlanPolicy._drop_exhausted_course`).
"""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from flatland.envs.rail_trainrun_data_structures import TrainrunWaypoint, Waypoint

from app.core.session_manager import session_manager
from app.main import app
from app.policies.plan_policy import PlanPolicy

pytestmark = pytest.mark.integration


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def _course_for_train_0_while_1_is_held(client):
    body = {"scenario_preset_id": "uc2-4", "seed": 42, "proposal_agent": "uc2_rl",
            "enabled_policy_ids": ["deadlock_avoidance"]}
    sid = client.post("/session", json=body).json()["id"]
    step = lambda n: client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance", "n_steps": n}).json()
    step(20)
    client.post(f"/session/{sid}/agent/1/override", json={"action": 4})
    step(4)
    p = client.get(f"/session/{sid}/proposals", params={"handle": 0, "alternatives": 3}).json()
    ai = next(v for v in p["variants"] if v["id"] == "ai")
    reply = client.post(f"/session/{sid}/proposals/apply", json={
        "variant": "ai", "handle": 0, "priority": ai["priority"], "preview_token": ai["preview_token"],
        "candidate_id": ai["candidate_id"], "source_step": p["source_step"]})
    assert reply.status_code == 200, reply.text
    env = session_manager.get(sid).env
    assert len(env._trainrun_plan[1]) == 1  # the course has train 1 stand where it was held
    return sid, step, env


def _run_to_end(client, sid, step):
    for _ in range(3):
        if step(100).get("all_done"):
            break
    return {a["handle"]: a["arrival_time"] for a in client.get(f"/session/{sid}/state").json()["agents"]}


def test_a_released_train_at_the_end_of_its_cut_short_run_does_not_stand_for_good(client):
    sid, step, env = _course_for_train_0_while_1_is_held(client)
    step(18)  # step 42, as in participant 203's run
    client.post(f"/session/{sid}/proposals/apply", json={"variant": "plan", "handle": 1})
    step(1)
    assert env._plan_off_plan == {0, 1, 2}  # the course no longer holds for anyone
    arrivals = _run_to_end(client, sid, step)
    assert all(arrivals[h] is not None for h in (0, 1, 2)), arrivals


def test_a_train_still_held_keeps_the_course(client):
    sid, step, env = _course_for_train_0_while_1_is_held(client)
    step(60)
    assert env._plan_off_plan == set()
    state = client.get(f"/session/{sid}/state").json()
    assert state["agents"][1]["position"] == [3, 10] and state["agents"][1]["state"] == "STOPPED"


def _next_to_target_env(held_at_takeover):
    """Train 1 stands on (3, 10), facing east, one cell before its target (3, 11)."""
    moving = SimpleNamespace(name="MOVING")
    agents = [SimpleNamespace(state=moving, current_configuration=((3, 2), 1), targets={((3, 20), 1)}),
              SimpleNamespace(state=moving, current_configuration=((3, 10), 1), targets={((3, 11), 1)})]
    return SimpleNamespace(agents=agents, _plan_off_plan=set(), _plan_course_holds=set(held_at_takeover))


def _course():
    return {0: [TrainrunWaypoint(30, Waypoint((3, 1), 1)), TrainrunWaypoint(31, Waypoint((3, 2), 1)),
                TrainrunWaypoint(32, Waypoint((3, 3), 1))],
            1: [TrainrunWaypoint(30, Waypoint((3, 10), 1))]}


def test_a_train_held_next_to_its_target_is_released_from_its_cut_short_run():
    env = _next_to_target_env(held_at_takeover={1})
    policy = PlanPolicy(None, _course())
    policy._env = env
    policy._drop_exhausted_course()  # released: no longer in the policy's holds
    assert env._plan_off_plan == {0, 1}


def test_a_complete_run_next_to_the_target_keeps_the_course():
    env = _next_to_target_env(held_at_takeover=set())
    policy = PlanPolicy(None, _course())
    policy._env = env
    policy._drop_exhausted_course()
    assert env._plan_off_plan == set()
