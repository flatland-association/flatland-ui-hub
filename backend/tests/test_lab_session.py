"""MARL lab step 4 (docs/plans/marl-lab-plan.md): the AI's choice at the next
switch, the origin snapshot, the strategy choice log and the AI Track Record."""
import json

import pytest
from fastapi.testclient import TestClient

from app.core.override_manager import override_manager
from app.core.session_manager import session_manager
from app.main import app


@pytest.fixture(autouse=True)
def runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_RUNS_DIR", str(tmp_path))
    return tmp_path


@pytest.fixture
def client():
    return TestClient(app)


def _session(client, policy="learned_ppo", **kw):
    body = {"width": 30, "height": 30, "number_of_agents": 3, "seed": 42, **kw}
    sid = client.post("/session", json=body).json()["id"]
    if policy:
        assert client.post(f"/session/{sid}/policy", json={"policy": policy}).status_code == 200
    return sid


def _step(client, sid, policy="learned_ppo", n=1):
    return client.post(f"/session/{sid}/step", json={"policy": policy, "n_steps": n}).json()


def _first_with_decision(client, sid):
    state = client.get(f"/session/{sid}/state").json()
    for a in state["agents"]:
        if a.get("next_decision"):
            return a
    return None


def test_count_ensemble_spread_is_computed_after_folding_raw_actions(monkeypatch):
    from app.core import lab_session

    monkeypatch.setattr(
        lab_session,
        "_fold_onto_options",
        lambda env, configuration, options, predictions: {
            10: predictions[0] + predictions[1],
            20: predictions[2],
        },
    )

    spread = lab_session._fold_ensemble_count_spread(
        None, None, [], [[1, 9, 4], [9, 1, 6]], [10, 20]
    )

    assert spread[10] == 0
    assert spread[20] == pytest.approx(1)


# ── gating ──────────────────────────────────────────────────────────────

def test_nothing_happens_outside_a_learned_session(client, runs_dir):
    sid = _session(client, policy=None)  # default DLA
    _step(client, sid, policy="deadlock_avoidance", n=5)
    assert client.get(f"/session/{sid}/lab/ai-choice/0").json() == {"available": False, "reason": "not-learned"}

    client.post(f"/session/{sid}/agent/0/override", json={"action": 4, "owner": "human"})
    assert session_manager.get(sid).lab_origin is None
    review = client.get(f"/session/{sid}/lab/review").json()
    assert review["learned"] is False and review["outcomes"] == []


def test_unknown_session_and_train(client):
    assert client.get("/session/nope/lab/review").status_code == 404
    sid = _session(client)
    assert client.get(f"/session/{sid}/lab/ai-choice/99").status_code == 404


# ── the AI's choice at the next switch ──────────────────────────────────

def test_ai_choice_is_one_of_the_options_at_the_next_decision(client):
    sid = _session(client)
    agent = None
    for _ in range(40):
        _step(client, sid)
        agent = _first_with_decision(client, sid)
        if agent:
            break
    assert agent, "no train reached a decision ahead within 40 steps"
    choice = client.get(f"/session/{sid}/lab/ai-choice/{agent['handle']}").json()
    if not choice["available"]:
        pytest.skip(f"train did not reach its switch under the AI: {choice['reason']}")
    assert choice["decisionPosition"] == agent["next_decision"]["decision_position"]
    assert abs(sum(choice["probabilities"]) - 1) < 1e-3
    # Raw actions are folded onto the options (DO_NOTHING goes where FORWARD
    # goes), so the shown choice is an option, or a hold, with the summed mass.
    per_option = {int(k): v for k, v in choice["optionProbabilities"].items()}
    option_actions = {o["action"] for o in agent["next_decision"]["options"]}
    assert set(per_option) == option_actions
    assert choice["action"] in option_actions | {4}
    assert choice["probability"] == max(per_option.values())
    assert sum(per_option.values()) <= 1 + 1e-3
    assert choice["policyAction"] == choice["action"]
    assert set(choice["actionSeenCounts"]).issubset(per_option)
    assert {int(action) for action in choice["actionSeenCountUncertainty"]} == set(per_option)
    assert all(0 <= value <= 100 for value in choice["actionSeenCountUncertainty"].values())
    assert 0 <= choice["rawPolicyAction"] <= 4
    assert choice["probabilities"][choice["rawPolicyAction"]] == max(choice["probabilities"])
    assert isinstance(choice["stateValue"], float)
    assert choice["bestAction"] in {int(k) for k, v in choice["actionValues"].items() if v is not None}
    assert set(choice["advantages"]) == set(choice["actionValues"])
    # The look-ahead leaves no override behind and does not move the session.
    assert not [k for k in override_manager._overrides if str(k).startswith("branch-lab-")]
    assert client.get(f"/session/{sid}/state").json()["elapsed_steps"] == choice["step"]


def test_online_ppo_evaluates_a_non_learned_running_policy(client):
    sid = _session(client, policy=None)
    _step(client, sid, policy="deadlock_avoidance", n=5)

    response = client.get(
        f"/session/{sid}/lab/ai-choice/0",
        params={"evaluationPolicy": "lab:online-ppo"},
    )

    assert response.status_code == 200
    choice = response.json()
    assert choice["available"] or choice.get("reason") in {"no-decision", "not-reached"}
    if choice["available"]:
        assert choice["policy"] == "lab:online-ppo"
        assert choice["simulationPolicy"] == "deadlock_avoidance"
        assert choice["simulationAction"] is None or 0 <= choice["simulationAction"] <= 4


# ── origin, review, choices ─────────────────────────────────────────────

def test_first_human_override_forks_the_origin_and_review_compares(client, runs_dir):
    sid = _session(client)
    _step(client, sid, n=3)
    # A system hold never starts the comparison.
    client.post(f"/session/{sid}/agent/0/override", json={"action": 4, "owner": "system"})
    assert session_manager.get(sid).lab_origin is None
    client.post(f"/session/{sid}/agent/0/override", json={"action": 2, "owner": "human", "mode": "director"})
    origin = session_manager.get(sid).lab_origin
    assert origin is not None and origin["step"] == 3
    client.post(f"/session/{sid}/agent/1/override", json={"action": 2, "owner": "human", "mode": "director"})
    assert session_manager.get(sid).lab_origin is origin  # only the first one
    _step(client, sid, n=20)

    review = client.get(f"/session/{sid}/lab/review").json()
    assert review["learned"] and review["originStep"] == 3
    ids = [o["id"] for o in review["outcomes"]]
    assert ids[:2] == ["with-you", "ai-alone"]
    for o in review["outcomes"]:
        assert 0 <= o["arrived"] <= o["trains"] == 3
    # Interventions come from the log the override policy writes at the
    # decision point; whatever was applied is counted, system holds are not.
    lines = []
    path = runs_dir / sid / "interventions.jsonl"
    if path.exists():
        lines = [json.loads(x) for x in path.read_text().splitlines()]
    assert review["interventions"] == sum(1 for x in lines if x["owner"] == "human")

    client.post(f"/session/{sid}/reset")
    assert session_manager.get(sid).lab_origin is None


def test_review_without_outcomes_is_cheap_and_has_no_rows(client):
    sid = _session(client)
    review = client.get(f"/session/{sid}/lab/review", params={"outcomes": "false"}).json()
    assert review["outcomes"] == [] and review["interventions"] == 0


def test_previous_checkpoint_row_for_a_lab_checkpoint(client, tmp_path, monkeypatch):
    from app.policies.learned.learned_ppo_policy import DEFAULT_CHECKPOINT

    lab = tmp_path / "ckpt"
    lab.mkdir()
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(lab))
    (lab / "mine.pt").write_bytes(DEFAULT_CHECKPOINT.read_bytes())
    (lab / "mine.json").write_text(json.dumps({"kind": "hg-dagger", "base": str(DEFAULT_CHECKPOINT)}))

    sid = _session(client, policy="lab:mine")
    _step(client, sid, policy="lab:mine", n=2)
    client.post(f"/session/{sid}/agent/0/override", json={"action": 2, "owner": "human"})
    _step(client, sid, policy="lab:mine", n=5)
    review = client.get(f"/session/{sid}/lab/review").json()
    rows = {o["id"]: o for o in review["outcomes"]}
    assert rows["previous-checkpoint"]["policy"] == "learned_ppo"
    assert rows["ai-alone"]["policy"] == "lab:mine"


def test_strategy_choice_is_logged_in_a_lab_session_only(client, runs_dir):
    from app.core import lab_session

    sid = _session(client)
    offered = {"recommended": "pp", "strategies": [
        {"id": "keep", "kind": "keep", "metrics": {"score": 3}},
        {"id": "pp", "kind": "pp", "metrics": {"score": 1}},
    ]}
    lab_session.record_choice(sid, session_manager.get(sid), "keep", offered, "co-learning")
    lines = [json.loads(x) for x in lab_session.choices_path(sid).read_text().splitlines()]
    assert lines[0]["kept_ai"] and lines[0]["recommended"] == "pp" and lines[0]["mode"] == "co-learning"
    review = client.get(f"/session/{sid}/lab/review", params={"outcomes": "false"}).json()
    assert review["choices"] == {"total": 1, "keptAi": 1, "followedRecommendation": 0}

    other = _session(client, policy=None)
    lab_session.record_choice(other, session_manager.get(other), "keep", offered)
    assert not lab_session.choices_path(other).exists()
