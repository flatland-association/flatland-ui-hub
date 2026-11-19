"""The trained UC2 model as the KI proposal agent (docs/plans/uc2-rl-proposal-agent.md)."""
import copy

import pytest
from fastapi.testclient import TestClient

from app.core.proposal_agents.registry import get_proposal_agent, proposal_agent_for
from app.core.proposal_agents.uc2_rl import rollout_trainruns
from app.core.session_manager import session_manager
from app.main import app
from app.policies.plan_policy import plan_accepted

WALENSEE = "pf-ch-wn-wal-long-approach"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _session(client, preset, agent="uc2_rl", steps=0):
    body = {"scenario_preset_id": preset, "seed": 42, "enabled_policy_ids": ["deadlock_avoidance"]}
    if agent:
        body["proposal_agent"] = agent
    response = client.post("/session", json=body)
    assert response.status_code == 200, response.text
    sid = response.json()["id"]
    if steps:
        client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance", "n_steps": steps})
    return sid


def _arrived(client, sid):
    agents = client.get(f"/session/{sid}/state").json()["agents"]
    return sum(str(a.get("state", "")).upper() == "DONE" for a in agents), len(agents)


def test_unknown_proposal_agent_is_refused(client):
    response = client.post("/session", json={"scenario_preset_id": "tutorial", "proposal_agent": "nope"})
    assert response.status_code == 400 and "proposal agent" in response.text


@pytest.mark.integration
@pytest.mark.parametrize("preset, agent, expected", [
    ("tutorial", "uc2_rl", "uc2_rl"),
    ("uc2-3", "uc2_rl", "uc2_rl"),
    ("tutorial", None, "pp_replan"),          # sessions that do not ask keep the default
    (WALENSEE, "uc2_rl", "pp_replan"),        # another infrastructure falls back
])
def test_ki_column_uses_the_sessions_agent_where_it_applies(client, preset, agent, expected):
    sid = _session(client, preset, agent, steps=4)
    try:
        payload = client.get(f"/session/{sid}/proposals", params={"handle": 0}).json()
        assert payload["ai_agent"]["id"] == expected
        assert proposal_agent_for(session_manager.get(sid)).id == expected
        if expected == "uc2_rl":
            ai = next(v for v in payload["variants"] if v["id"] == "ai")
            assert ai["priority"] == []
            assert len(payload["ai_alternatives"]) <= 7
            assert all(v["priority"] == [] for v in payload["ai_alternatives"])
    finally:
        client.delete(f"/session/{sid}")


@pytest.mark.integration
def test_rollout_leaves_the_session_env_alone_and_replays_exactly(client):
    sid = _session(client, "tutorial", steps=6)
    try:
        env = session_manager.get(sid).env
        before = (int(env._elapsed_steps), [copy.deepcopy(a.current_configuration) for a in env.agents])
        trainruns = rollout_trainruns(env)
        assert (int(env._elapsed_steps), [a.current_configuration for a in env.agents]) == before
        assert set(trainruns) == {0, 1}
        assert all(run[i].scheduled_at < run[i + 1].scheduled_at for run in trainruns.values() for i in range(len(run) - 1))
        # The KI course shown is the replayed rollout: both trains arrive, where the
        # DLA plan from here loses one (the case Plan B's tutorial leg runs into).
        payload = client.get(f"/session/{sid}/proposals", params={"handle": 0}).json()
        plan, ai = payload["variants"][0], next(v for v in payload["variants"] if v["id"] == "ai")
        assert ai["system"]["done"] == 2 and plan["system"]["done"] == 1
    finally:
        client.delete(f"/session/{sid}")


@pytest.mark.integration
def test_an_accepted_plan_keeps_running_while_the_client_pins_its_policy(client):
    sid = _session(client, "tutorial", steps=6)
    try:
        payload = client.get(f"/session/{sid}/proposals", params={"handle": 0}).json()
        ai = next(v for v in payload["variants"] if v["id"] == "ai")
        applied = client.post(f"/session/{sid}/proposals/apply",
                              json={"variant": "ai", "handle": 0, "priority": ai["priority"]}).json()
        assert applied["policy"] == "plan"
        env = session_manager.get(sid).env
        assert plan_accepted(env)
        # Plan B keeps sending its pinned policy with every step.
        for _ in range(4):
            client.post(f"/session/{sid}/step", json={"policy": "deadlock_avoidance", "n_steps": 10})
        assert session_manager.get(sid).policy == "plan"
        assert _arrived(client, sid) == (2, 2)
        assert ai["train"]["arrival_step"] == next(
            a.get("arrival_time") for a in client.get(f"/session/{sid}/state").json()["agents"] if a["handle"] == 0)
        # A deliberate switch and a reset both end the accepted plan.
        client.post(f"/session/{sid}/policy", json={"policy": "deadlock_avoidance"})
        assert not plan_accepted(env)
    finally:
        client.delete(f"/session/{sid}")


@pytest.mark.integration
def test_reset_returns_to_the_sessions_own_course(client):
    sid = _session(client, "tutorial", steps=6)
    try:
        client.post(f"/session/{sid}/proposals/apply", json={"variant": "ai", "handle": 0, "priority": []})
        env = session_manager.get(sid).env
        assert plan_accepted(env)
        client.post(f"/session/{sid}/reset")
        assert not plan_accepted(env) and getattr(env, "_trainrun_plan", None) is None
    finally:
        client.delete(f"/session/{sid}")


def test_agent_is_registered_and_bound_to_its_fixtures():
    agent = get_proposal_agent("uc2_rl")
    assert agent is not None and agent.label == "UC2 RL"
    from app.core.env_factory import create_env
    assert agent.available(create_env(scenario_preset_id="uc2-2"))
    assert not agent.available(create_env(scenario_preset_id=WALENSEE))
