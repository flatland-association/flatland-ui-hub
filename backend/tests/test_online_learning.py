"""Online PPO learning (docs/plans/online-ppo-learning.md)."""
import json
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.core.env_factory import create_env
from app.core.online_learning import candidates as cand
from app.core.online_learning.buffers import OffPolicyDataError, PpoRolloutBuffer, make_buffers
from app.core.online_learning.config import OnlineConfig
from app.core.online_learning.records import PolicyPrediction, RolloutStep

torch = pytest.importorskip("torch")


def tiny_config(**kw) -> OnlineConfig:
    base = dict(scenarios=["gen:25x25:2:*"], eval_scenarios=["gen:25x25:2:1", "gen:25x25:2:2"],
                min_rollout_steps=120, epochs=1, batch_size=64, cf_horizon=6, cf_every=2, seed=3)
    base.update(kw)
    return OnlineConfig(**base)


@pytest.fixture
def dirs(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(tmp_path / "ckpt"))
    return tmp_path


@pytest.fixture
def learner(dirs):
    from app.core.online_learning.learner import OnlineLearner

    lrn = OnlineLearner(tiny_config(), dirs / "online")
    yield lrn
    lrn.close()


def _collect(lrn):
    for _ in range(5000):
        if lrn.ready_for_update():
            return
        lrn.step()
    raise AssertionError("never collected enough rollout steps")


def _step(**kw):
    base = dict(obs=[0.0] * 36, mask=[1, 0, 1, 0, 1], action=2, log_prob=-0.5, value=0.1, reward=0.0,
                done=False, policy_version=0, episode_id=1, step=0, handle=0)
    base.update(kw)
    return RolloutStep(**base)


# ── buffers: PPO only takes on-policy data ──────────────────────────────

def test_rollout_buffer_refuses_off_policy_and_stale_data():
    buf = PpoRolloutBuffer(10, version=3)
    buf.add(_step(policy_version=3))
    with pytest.raises(OffPolicyDataError):
        buf.add(PolicyPrediction("deadlock_avoidance", "static", "s", 1, 0, 0, None, 2))
    with pytest.raises(OffPolicyDataError):
        buf.add(_step(policy_version=3, source="deadlock_avoidance"))
    with pytest.raises(OffPolicyDataError):
        buf.add(_step(policy_version=2))
    buf.reset(4)
    assert len(buf) == 0 and buf.version == 4


def test_five_separate_bounded_buffers():
    buffers = make_buffers(OnlineConfig(prediction_buffer_size=3))
    assert set(buffers) == {"ppo_rollout_buffer", "multi_policy_prediction_buffer", "user_interaction_buffer",
                            "counterfactual_evaluation_buffer", "distillation_buffer"}
    pred = buffers["multi_policy_prediction_buffer"]
    for i in range(5):
        pred.add(PolicyPrediction("x", "static", "s", 1, i, 0, None, 2))
    assert len(pred) == 3
    with pytest.raises(TypeError):
        buffers["distillation_buffer"].add(_step())


# ── several active policies, parallel predictions, failures ────────────

class _Fake:
    def __init__(self, pid, fn):
        self.policy_id = pid
        self.predict = fn


def test_parallel_query_survives_failing_and_missing_predictions():
    from concurrent.futures import ThreadPoolExecutor

    def good(handles):
        return {h: cand.Prediction(2, 0.9) for h in handles}

    def broken(handles):
        raise RuntimeError("boom")

    def partial(handles):
        return {handles[0]: cand.Prediction(1)}

    with ThreadPoolExecutor(3) as pool:
        out = cand.query_all([_Fake("good", good), _Fake("broken", broken), _Fake("partial", partial)], [0, 1], pool)
    assert out["good"][1].action == 2
    assert out["broken"][0].action is None and "boom" in out["broken"][0].error
    assert 1 not in out["partial"]  # missing: the learner records it as "missing"


def test_unknown_policy_is_reported_not_fatal():
    env = create_env(width=25, height=25, number_of_agents=2, seed=1)
    built, errors = cand.build_active_policies(["deadlock_avoidance", "no_such_policy"], env)
    assert [p.policy_id for p in built] == ["deadlock_avoidance"]
    assert "no_such_policy" in errors


def test_every_active_policy_is_asked_each_step(learner):
    for _ in range(5):
        learner.step()
    ids = {p.policy_id for p in learner.buffers["multi_policy_prediction_buffer"]}
    assert {"online-ppo", "deadlock_avoidance", "shortest_path", "learned_ppo"} <= ids


# ── candidates: compared by simulated outcome, not confidence ──────────

def test_candidates_include_unproposed_valid_actions_and_drop_invalid_ones():
    mask = np.array([1, 0, 1, 1, 1], dtype=np.float32)
    got = cand.collect_candidates(mask, {"learner": 2, "deadlock_avoidance": 2, "shortest_path": 1, "user": 4})
    assert got[2] == ["learner", "deadlock_avoidance"]
    assert 1 not in got  # LEFT is not valid here
    assert got[3] == ["unproposed"] and got[0] == ["unproposed"]
    assert got[4] == ["user"]


def test_best_candidate_is_the_best_feasible_score():
    results = [
        {"action": 2, "sources": ["learned_ppo"], "score": 0.9, "feasible": False},  # creates a deadlock
        {"action": 4, "sources": ["unproposed"], "score": 0.5, "feasible": True},
        {"action": 0, "sources": ["deadlock_avoidance"], "score": 0.1, "feasible": True},
    ]
    assert cand.best_candidate(results)["action"] == 4


def test_forks_score_candidates_without_touching_the_env():
    env = create_env(width=25, height=25, number_of_agents=2, seed=1)
    for _ in range(3):
        env.step({h: 2 for h in env.get_agent_handles()})
    before = env._elapsed_steps
    results = cand.evaluate_candidates(env, 0, {2: ["learner"], 4: ["unproposed"]},
                                       lambda e: _ForwardAll(), horizon=5)
    assert env._elapsed_steps == before
    assert {r["action"] for r in results} == {2, 4}
    assert all({"punctuality", "arrivals", "delay", "waiting", "new_deadlocks"} <= set(r["components"]) for r in results)


class _ForwardAll:
    def act_many(self, handles, obs):
        return {h: 2 for h in handles}


# ── real vs simulated rewards ──────────────────────────────────────────

def test_only_executed_learner_actions_become_ppo_samples(learner):
    _collect(learner)
    rollout = learner.buffers["ppo_rollout_buffer"]
    assert all(s.source == "learner_rollout" and s.policy_version == learner.weights_version for s in rollout)
    # forks scored candidates, but none of them got into the rollout
    assert len(learner.buffers["counterfactual_evaluation_buffer"]) > 0
    assert all(isinstance(s, RolloutStep) for s in rollout)


# ── update, versioning, evaluation, accept and rollback ────────────────

def test_online_update_creates_a_version_and_an_audit_line(learner, dirs):
    _collect(learner)
    n = len(learner.buffers["ppo_rollout_buffer"])
    entry = learner.update()
    assert entry["version"] == 1 and entry["stats"]["rollout_steps"] == n
    assert (learner.run_dir / "versions" / "v1.pt").is_file()
    assert entry["decision"] in {"accepted", "rolled_back", "collapsed"}
    assert entry["baseline"]["episodes"] == 2 and "stable_before" in entry
    audit = [json.loads(x) for x in learner.audit_path.read_text().splitlines()]
    assert [a["event"] for a in audit][:1] == ["start"] and audit[-1]["event"] == "update"
    # a new version empties the on-policy buffer
    assert len(learner.buffers["ppo_rollout_buffer"]) == 0


def _fake_eval(score, deadlocks=0.0):
    return lambda factory: {"episodes": 2, "score": score, "arrival_rate": score, "lateness_per_train": 0,
                            "deadlocks_per_episode": deadlocks, "per_episode": []}


def test_better_version_is_accepted_and_published(learner, dirs, monkeypatch):
    from app.policies.learned import lab_checkpoints

    _collect(learner)
    monkeypatch.setattr(learner, "evaluate", _fake_eval(learner.stable_eval["score"] + 0.5))
    entry = learner.update()
    assert entry["decision"] == "accepted" and entry["improved"]
    assert learner.stable_version == learner.weights_version == 1
    meta = lab_checkpoints.read_meta(lab_checkpoints.checkpoint_path("online-ppo"))
    assert meta["version"] == 1 and meta["label"] == "Online PPO (v1)"


def test_worse_version_rolls_back_to_the_stable_weights(learner, monkeypatch):
    _collect(learner)
    stable = {k: v.clone() for k, v in learner.model.state_dict().items()}
    monkeypatch.setattr(learner, "evaluate", _fake_eval(learner.stable_eval["score"] - 0.5))
    entry = learner.update()
    assert entry["decision"] == "rolled_back"
    assert learner.weights_version == learner.stable_version == 0 and learner.version == 1
    for k, v in learner.model.state_dict().items():
        assert torch.equal(v, stable[k])


def test_slightly_worse_version_keeps_training_but_is_not_published(learner, monkeypatch):
    _collect(learner)
    monkeypatch.setattr(learner, "evaluate", _fake_eval(learner.stable_eval["score"] - learner.cfg.accept_tolerance / 2))
    entry = learner.update()
    assert entry["decision"] == "kept_training"
    assert learner.weights_version == 1 and learner.stable_version == 0
    assert learner.buffers["ppo_rollout_buffer"].version == 1


def test_less_safe_version_is_never_published(learner, monkeypatch):
    # A better score bought with deadlocks: training may go on, publishing not.
    _collect(learner)
    monkeypatch.setattr(learner, "evaluate", _fake_eval(learner.stable_eval["score"] + 1.0, deadlocks=99.0))
    entry = learner.update()
    assert entry["decision"] != "accepted" and entry["safe"] is False
    assert learner.stable_version == 0


def test_collapsed_version_is_rejected_without_evaluation(learner, monkeypatch):
    _collect(learner)
    learner.cfg.collapse_entropy = 99.0
    called = []
    monkeypatch.setattr(learner, "evaluate", lambda f: called.append(1))
    assert learner.update()["decision"] == "collapsed" and not called


# ── user overrides, all three modes ────────────────────────────────────

@pytest.mark.parametrize("mode", ["recommendation", "co-learning", "director"])
def test_override_is_judged_by_its_fork_not_taken_as_better(learner, mode):
    env = create_env(width=25, height=25, number_of_agents=2, seed=1)
    ui = learner.ingest_override({"session_id": "s", "handle": 0, "action": 4, "mode": mode, "owner": "human",
                                  "step": 0}, env)
    assert ui.mode == mode and ui.kind == "override"
    assert ui.outcome in {"better", "worse", "equal", "not evaluated"}
    distilled = [d for d in learner.buffers["distillation_buffer"] if d.origin == "user"]
    assert bool(distilled) == (ui.outcome == "better")


def test_feedback_is_recorded_without_reward(learner):
    ui = learner.ingest_feedback({"session_id": "s", "handle": 1, "feedback": "too cautious", "mode": "director"})
    assert ui.kind == "feedback" and ui.human_score is None


@pytest.mark.parametrize("mode", ["recommendation", "co-learning", "director"])
def test_override_hook_only_for_the_online_policy(dirs, monkeypatch, mode):
    from app.core.online_learning.manager import OnlineLearningManager
    from app.core.session_manager import session_manager

    mgr = OnlineLearningManager(dirs / "online")
    monkeypatch.setattr(mgr, "is_alive", lambda: True)
    client = TestClient(__import__("app.main", fromlist=["app"]).app)
    sid = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 3}).json()["id"]
    session = session_manager.get(sid)
    assert mgr.note_override(session, 0, 2, mode, "human") is False  # DLA session: nothing
    session.policy = "lab:online-ppo"
    assert mgr.note_override(session, 0, 2, mode, "system") is False  # system holds: nothing
    assert mgr.note_override(session, 0, 2, mode, "human") is True
    records = [json.loads(p.read_text()) for p in (dirs / "online" / "inbox").glob("*.json")]
    assert records[0]["mode"] == mode and (dirs / "online" / "inbox" / records[0]["snapshot"]).is_file()


def test_inbox_snapshot_is_processed_by_the_learner(learner, dirs, monkeypatch):
    from app.core.online_learning.manager import OnlineLearningManager
    from app.core.online_learning.worker import process_inbox
    from app.core.session_manager import session_manager

    mgr = OnlineLearningManager(learner.root)
    monkeypatch.setattr(mgr, "is_alive", lambda: True)
    client = TestClient(__import__("app.main", fromlist=["app"]).app)
    sid = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 3}).json()["id"]
    session = session_manager.get(sid)
    session.policy = "lab:online-ppo"
    mgr.note_override(session, 1, 4, "director", "human")
    assert process_inbox(learner, learner.root) == 1
    assert [u.kind for u in learner.buffers["user_interaction_buffer"]][:1] == ["override"]
    assert not list((learner.root / "inbox").glob("*"))


# ── worker process and API ─────────────────────────────────────────────

def _wait(mgr, states, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = mgr.status()
        if st.get("state") in states:
            return st
        time.sleep(0.5)
    raise AssertionError(f"state never reached {states}: {mgr.status()}")


def test_worker_process_start_pause_resume_stop(dirs):
    from app.core.online_learning.manager import OnlineLearningManager

    mgr = OnlineLearningManager(dirs / "online")
    try:
        mgr.start(tiny_config().to_dict())
        st = _wait(mgr, {"running", "updating"})
        assert st["alive"] and st["stable_version"] == 0
        with pytest.raises(RuntimeError):
            mgr.start()
        mgr.pause()
        _wait(mgr, {"paused"})
        mgr.resume()
        _wait(mgr, {"running", "updating"})
    finally:
        mgr.stop()
    assert mgr.status()["state"] == "stopped"


def test_api_status_when_idle(dirs, monkeypatch):
    from app.api import lab as lab_api
    from app.core.online_learning.manager import OnlineLearningManager

    monkeypatch.setattr(lab_api, "online_manager", OnlineLearningManager(dirs / "online"))
    client = TestClient(__import__("app.main", fromlist=["app"]).app)
    st = client.get("/lab/online/status").json()
    assert st["state"] == "idle" and st["alive"] is False
    assert client.post("/lab/online/pause").status_code == 409
    assert client.post("/lab/online/feedback", json={"session_id": "s", "handle": 0, "feedback": "x"}).json() == {"recorded": False}
