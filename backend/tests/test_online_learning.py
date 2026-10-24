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
from app.core.online_learning.records import (
    DistillationSample,
    ExperienceCountSample,
    PolicyPrediction,
    RolloutStep,
)

torch = pytest.importorskip("torch")


def tiny_config(**kw) -> OnlineConfig:
    base = dict(scenarios=["gen:25x25:2:*"], eval_scenarios=["gen:25x25:2:1", "gen:25x25:2:2"],
                min_rollout_steps=120, epochs=1, batch_size=64, cf_horizon=6, cf_every=2, seed=3)
    base.update(kw)
    return OnlineConfig(**base)


def test_default_online_training_includes_walensee():
    assert "pf-ch-wn-wal-long-approach" in OnlineConfig().scenarios


def test_learning_sources_default_on_and_persist_across_managers(tmp_path):
    from app.core.online_learning.manager import OnlineLearningManager

    root = tmp_path / "online"
    manager = OnlineLearningManager(root)
    initial = manager.settings()
    assert all(initial["learning_sources"].values())
    assert initial["comparison_policies"] == ["deadlock_avoidance", "shortest_path", "learned_ppo"]

    changed = dict(initial["learning_sources"], policy_predictions=False, user_interactions=False)
    manager.update_settings(learning_sources=changed, comparison_policies=["shortest_path"])
    manager.note_scenario("pf-ch-wn-wal-conflict")

    reloaded = OnlineLearningManager(root).settings()
    assert reloaded["learning_sources"] == changed
    assert reloaded["comparison_policies"] == ["shortest_path"]
    assert "pf-ch-wn-wal-conflict" in reloaded["scenarios"]
    assert "pf-ch-wn-wal-long-approach" in reloaded["scenarios"]


def test_autostart_resumes_published_policy_or_uses_scratch(dirs, monkeypatch):
    from app.core.online_learning.manager import OnlineLearningManager, PUBLISHED_POLICY_ID

    manager = OnlineLearningManager(dirs / "online")
    monkeypatch.setattr(manager, "available", lambda: True)
    starts = []
    monkeypatch.setattr(manager, "start", lambda config: starts.append(config) or {"started": True})

    manager.autostart()
    assert starts[-1]["init"] == "scratch"

    checkpoint = dirs / "ckpt" / "online-ppo.pt"
    checkpoint.parent.mkdir(parents=True, exist_ok=True)
    checkpoint.write_bytes(b"published checkpoint")
    manager.autostart()
    assert starts[-1]["init"] == PUBLISHED_POLICY_ID


def test_reset_to_scratch_preserves_saved_learning_sources(tmp_path, monkeypatch):
    from app.core.online_learning.manager import OnlineLearningManager

    manager = OnlineLearningManager(tmp_path / "online")
    manager.update_settings(learning_sources=dict(OnlineConfig().learning_sources, experience_samples=False))
    stopped = []
    started = []
    monkeypatch.setattr(manager, "stop", lambda: stopped.append(True))
    monkeypatch.setattr(manager, "start", lambda config: started.append(config) or {"started": True})

    manager.reset_to_scratch()

    assert stopped == [True]
    assert started == [{"init": "scratch"}]
    assert manager.settings()["learning_sources"]["experience_samples"] is False


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


def test_separate_bounded_training_buffers():
    buffers = make_buffers(OnlineConfig(prediction_buffer_size=3))
    assert set(buffers) == {"ppo_rollout_buffer", "multi_policy_prediction_buffer", "user_interaction_buffer",
                            "counterfactual_evaluation_buffer", "distillation_buffer", "experience_count_buffer"}
    pred = buffers["multi_policy_prediction_buffer"]
    for i in range(5):
        pred.add(PolicyPrediction("x", "static", "s", 1, i, 0, None, 2))
    assert len(pred) == 3
    with pytest.raises(TypeError):
        buffers["distillation_buffer"].add(_step())


def test_experience_count_buffer_tracks_sources_and_bounds_state_keys(learner):
    from app.policies.learned.learned_ppo_policy import experience_state_key

    learner.cfg.experience_state_capacity = 1
    obs = np.zeros(36, dtype=np.float32)
    mask = np.array([1, 0, 1, 0, 1], dtype=np.float32)
    key = experience_state_key(obs, mask)
    learner._record_experience(obs, mask, 2, "executed")
    learner._record_experience(obs, mask, 2, "simulated")

    counts = learner.experience_counts[key]
    assert counts["executed"][2] == 1
    assert counts["simulated"][2] == 1
    assert learner.buffers["experience_count_buffer"].items()[-1].target_log_counts[2] == pytest.approx(np.log1p(2))

    other_obs = np.ones(36, dtype=np.float32)
    learner._record_experience(other_obs, mask, 1, "executed")
    assert len(learner.experience_counts) == 1
    assert experience_state_key(other_obs, mask) in learner.experience_counts


def test_disabled_sources_do_not_add_auxiliary_training_samples(learner):
    obs = np.zeros(36, dtype=np.float32)
    mask = np.array([1, 0, 1, 0, 1], dtype=np.float32)
    learner.cfg.learning_sources["experience_samples"] = False
    learner.cfg.learning_sources["distillation_targets"] = False

    learner._record_experience(obs, mask, 2, "executed")
    gap = learner._maybe_distill(
        [{"action": 0, "feasible": True, "score": 0.0, "sources": ["learner"]},
         {"action": 2, "feasible": True, "score": 1.0, "sources": ["unproposed"]}],
        0, obs, mask, "counterfactual",
    )

    assert gap is None
    assert len(learner.buffers["experience_count_buffer"]) == 0
    assert len(learner.buffers["distillation_buffer"]) == 0


def test_disabled_policy_source_is_not_queried(learner, monkeypatch):
    learner.cfg.learning_sources["policy_predictions"] = False
    learner.cfg.learning_sources["counterfactual_evaluations"] = False

    def unexpected_query(*_args):
        raise AssertionError("disabled policy sources must not be queried")

    monkeypatch.setattr(cand, "query_all", unexpected_query)

    learner.step()

    predictions = learner.buffers["multi_policy_prediction_buffer"].items()
    assert predictions
    assert {prediction.policy_id for prediction in predictions} == {"online-ppo"}


def test_apply_settings_updates_scenario_curriculum_and_source_flags(learner):
    learner.apply_settings({
        "scenarios": ["gen:25x25:2:*", "pf-ch-wn-wal-conflict"],
        "learning_sources": dict(learner.cfg.learning_sources, policy_predictions=False),
        "comparison_policies": ["shortest_path"],
    })

    assert learner.cfg.scenarios == ["gen:25x25:2:*", "pf-ch-wn-wal-conflict"]
    assert learner.cfg.learning_sources["policy_predictions"] is False
    assert learner.cfg.active_policies == ["shortest_path"]
    assert learner.policies == []


def test_comparison_policy_selection_rebuilds_live_policy_list(learner, monkeypatch):
    built = []

    def build(policy_ids, env):
        built.append(list(policy_ids))
        return [], {}

    monkeypatch.setattr(cand, "build_active_policies", build)
    learner.apply_settings({
        "scenarios": learner.cfg.scenarios,
        "learning_sources": learner.cfg.learning_sources,
        "comparison_policies": ["shortest_path"],
    })

    assert learner.cfg.active_policies == ["shortest_path"]
    assert built == [["shortest_path"]]


def test_status_reports_sources_for_retained_training_data(learner):
    obs = [0.0] * 36
    mask = [1.0, 0.0, 1.0, 0.0, 1.0]
    learner.cfg.active_policies.append("random_policy")
    learner.buffers["multi_policy_prediction_buffer"].add(
        PolicyPrediction("deadlock_avoidance", "static", "background", 1, 1, 0, obs, 2)
    )
    learner.buffers["multi_policy_prediction_buffer"].add(
        PolicyPrediction("random_policy", "static", "background", 1, 1, 0, obs, 4)
    )
    learner.buffers["distillation_buffer"].add(
        DistillationSample(obs, mask, 2, ["deadlock_avoidance", "random_policy"], 0.2)
    )
    learner.buffers["experience_count_buffer"].add(
        ExperienceCountSample(obs, mask, [0.0] * 5, "executed")
    )
    learner.buffers["experience_count_buffer"].add(
        ExperienceCountSample(obs, mask, [0.0] * 5, "simulated")
    )

    sources = learner.status()["data_sources"]

    assert sources["policy_predictions"] == {
        "online-ppo": 0,
        "deadlock_avoidance": 1,
        "shortest_path": 0,
        "learned_ppo": 0,
        "random_policy": 1,
    }
    assert sources["distillation_targets"] == {"deadlock_avoidance": 1, "random_policy": 1}
    assert sources["experience_samples"] == {"executed": 1, "simulated": 1}


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
    assert entry["stats"]["experience_samples"] > 0
    checkpoint = torch.load(learner.run_dir / "versions" / "v1.pt", weights_only=False, map_location="cpu")
    assert checkpoint["meta"]["experience_updates"] > 0
    assert checkpoint["experience_counts"]
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


def test_disabled_user_source_discards_queued_overrides(learner, dirs, monkeypatch):
    from app.core.online_learning.manager import OnlineLearningManager
    from app.core.online_learning.worker import process_inbox
    from app.core.session_manager import session_manager

    manager = OnlineLearningManager(learner.root)
    monkeypatch.setattr(manager, "is_alive", lambda: True)
    client = TestClient(__import__("app.main", fromlist=["app"]).app)
    sid = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 3}).json()["id"]
    session = session_manager.get(sid)
    session.policy = "lab:online-ppo"
    assert manager.note_override(session, 1, 4, "director", "human")
    learner.cfg.learning_sources["user_interactions"] = False

    assert process_inbox(learner, learner.root) == 1
    assert len(learner.buffers["user_interaction_buffer"]) == 0
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


def test_api_learning_source_settings_persist(dirs, monkeypatch):
    from app.api import lab as lab_api
    from app.core.online_learning.manager import OnlineLearningManager

    manager = OnlineLearningManager(dirs / "online")
    monkeypatch.setattr(lab_api, "online_manager", manager)
    client = TestClient(__import__("app.main", fromlist=["app"]).app)
    settings = dict(manager.settings()["learning_sources"], counterfactual_evaluations=False)
    comparison_policies = ["shortest_path"]

    response = client.post(
        "/lab/online/settings",
        json={"learning_sources": settings, "comparison_policies": comparison_policies},
    )

    assert response.status_code == 200
    assert response.json()["learning_sources"] == settings
    assert response.json()["comparison_policies"] == comparison_policies
    learning_settings = client.get("/lab/online/status").json()["learning_settings"]
    assert learning_settings["learning_sources"] == settings
    assert learning_settings["comparison_policies"] == comparison_policies
    invalid = client.post(
        "/lab/online/settings",
        json={"learning_sources": settings, "comparison_policies": ["not-a-policy"]},
    )
    assert invalid.status_code == 422


def test_app_lifespan_starts_and_stops_global_learner(monkeypatch):
    from app import main
    from app.config import settings

    calls = []
    monkeypatch.setattr(settings, "online_learning_autostart", True)
    monkeypatch.setattr(main.online_learning_manager, "autostart", lambda: calls.append("start"))
    monkeypatch.setattr(main.online_learning_manager, "stop", lambda: calls.append("stop"))

    with TestClient(main.app):
        assert calls == ["start"]

    assert calls == ["start", "stop"]


def test_lab_checkpoint_published_during_a_session_can_drive_it(dirs):
    # The online learner publishes lab:online-ppo while sessions run; the
    # session's enabled set was fixed before, so it is admitted on first use.
    from app.policies.learned.learned_ppo_policy import DEFAULT_CHECKPOINT

    client = TestClient(__import__("app.main", fromlist=["app"]).app)
    sid = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 3}).json()["id"]
    assert client.post(f"/session/{sid}/policy", json={"policy": "lab:online-ppo"}).status_code == 400
    ckpt = dirs / "ckpt"
    ckpt.mkdir(exist_ok=True)
    (ckpt / "online-ppo.pt").write_bytes(DEFAULT_CHECKPOINT.read_bytes())
    assert client.post(f"/session/{sid}/policy", json={"policy": "lab:online-ppo"}).status_code == 200
    assert client.post(f"/session/{sid}/step", json={"policy": "lab:online-ppo", "n_steps": 2}).status_code == 200
    # Only lab checkpoints: a hidden built-in policy stays refused.
    assert client.post(f"/session/{sid}/policy", json={"policy": "do_nothing"}).status_code == 400
