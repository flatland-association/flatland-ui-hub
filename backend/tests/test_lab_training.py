"""MARL lab tour (docs/plans/marl-lab-tour.md): training the AI from the
browser — `POST /session/{id}/lab/train`, `GET /lab/jobs/{job}`."""
import json
import os
import time

import pytest
from fastapi.testclient import TestClient

from app.core import lab_training
from app.main import app
from app.policies import registry
from app.policies.learned import lab_checkpoints
from tests.test_marl_lab import _write_interventions


@pytest.fixture(autouse=True)
def lab_dirs(tmp_path, monkeypatch):
    runs = tmp_path / "runs"
    checkpoints = tmp_path / "checkpoints"
    monkeypatch.setenv("MARL_LAB_RUNS_DIR", str(runs))
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(checkpoints))
    monkeypatch.delenv("MARL_LAB_TRAINING", raising=False)
    monkeypatch.delenv("MARL_LAB_TOUR_CHECKPOINTS", raising=False)
    monkeypatch.delenv("MARL_LAB_TOUR_TTL_HOURS", raising=False)
    # A tiny run: what is tested is the plumbing, not the learning.
    monkeypatch.setattr(lab_training, "_overrides", {
        "epochs": 5, "rollout_states": 64, "check_scenarios": ("gen:25x25:2:3",),
    })
    lab_training.forget_jobs()
    yield runs, checkpoints
    lab_training.forget_jobs()


@pytest.fixture
def client():
    return TestClient(app)


def _session(client, policy="learned_ppo"):
    body = {"width": 30, "height": 30, "number_of_agents": 3, "seed": 42}
    sid = client.post("/session", json=body).json()["id"]
    if policy:
        assert client.post(f"/session/{sid}/policy", json={"policy": policy}).status_code == 200
    return sid


def _wait(client, job_id, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = client.get(f"/lab/jobs/{job_id}").json()
        if job["state"] != "running":
            return job
        time.sleep(0.2)
    raise AssertionError("training job did not finish")


def _give_interventions(runs, sid) -> int:
    """This session's log, written as intervention_log.py writes it."""
    n = _write_interventions(runs)
    (runs / "s1" / "interventions.jsonl").rename(runs / "s1" / "tmp.jsonl")
    (runs / sid).mkdir(parents=True, exist_ok=True)
    (runs / "s1" / "tmp.jsonl").rename(runs / sid / "interventions.jsonl")
    return n


# ── gating ──────────────────────────────────────────────────────────────

def test_switched_off_by_the_environment(client, monkeypatch):
    monkeypatch.setenv("MARL_LAB_TRAINING", "0")
    sid = _session(client)
    status = client.get(f"/session/{sid}/lab/train").json()
    assert status["available"] is False and status["reason"] == "disabled"
    r = client.post(f"/session/{sid}/lab/train", json={"klWeight": 3})
    assert r.status_code == 503 and r.json()["detail"] == "disabled"


def test_not_writable_checkpoints_dir(client, monkeypatch, tmp_path):
    blocker = tmp_path / "a-file"
    blocker.write_text("")
    monkeypatch.setenv("MARL_LAB_CHECKPOINTS_DIR", str(blocker / "sub"))
    sid = _session(client)
    assert client.get(f"/session/{sid}/lab/train").json()["reason"] == "not-writable"


def test_without_torch(client, monkeypatch):
    real = lab_training.importlib.util.find_spec
    monkeypatch.setattr(lab_training.importlib.util, "find_spec",
                        lambda name, *a: None if name == "torch" else real(name, *a))
    sid = _session(client)
    assert client.get(f"/session/{sid}/lab/train").json()["reason"] == "no-torch"


def test_refuses_a_session_without_a_learned_policy_or_interventions(client, lab_dirs):
    sid = _session(client, policy=None)  # DLA
    r = client.post(f"/session/{sid}/lab/train", json={"klWeight": 3})
    assert r.status_code == 400 and r.json()["detail"] == "not-learned"

    sid = _session(client)
    r = client.post(f"/session/{sid}/lab/train", json={"klWeight": 3})
    assert r.status_code == 400 and r.json()["detail"] == "no-interventions"
    assert client.post(f"/session/{sid}/lab/train", json={"klWeight": 0}).json()["detail"] == "kl-weight"
    assert client.post("/session/nope/lab/train", json={}).status_code == 404
    assert client.get("/lab/jobs/nope").status_code == 404


# ── training ────────────────────────────────────────────────────────────

def test_trains_only_on_this_sessions_human_lines(client, lab_dirs):
    runs, checkpoints = lab_dirs
    sid = _session(client)
    n = _give_interventions(runs, sid)
    # Another session's lines are in the same runs dir and must not count.
    other = runs / "someone-else"
    other.mkdir(parents=True)
    other.joinpath("interventions.jsonl").write_text(
        (runs / sid / "interventions.jsonl").read_text() * 3)

    status = client.get(f"/session/{sid}/lab/train").json()
    assert status["available"] and status["basePolicy"] == "learned_ppo"
    assert status["defaultKlWeight"] == 3 and status["klWeights"] == [1, 3, 10]
    assert len(status["interventions"]) == n  # the system hold is not one
    first = status["interventions"][0]
    assert set(first) == {"handle", "step", "aiAction", "humanAction", "agreed"}
    assert first["humanAction"] == 4 and first["agreed"] is False

    r = client.post(f"/session/{sid}/lab/train", json={"klWeight": 3})
    assert r.status_code == 202
    started = r.json()
    assert started["state"] == "running"
    assert started["name"] == f"tour-{sid}-1" and started["policyId"] == f"lab:tour-{sid}-1"
    assert started["interventions"] == n

    job = _wait(client, started["jobId"])
    assert job["state"] == "done", job["error"]
    assert job["agreementBefore"]["all"] == 0.0
    assert job["agreementBefore"]["n"] == n and job["agreementAfter"]["n"] == n
    assert 0.0 <= job["changedShare"] <= 1.0
    assert job["klWeight"] == 3
    (row,) = job["check"]
    assert row["scenario"] == "gen:25x25:2:3" and row["seen"] is False
    for key in ("base", "trained"):
        assert set(row[key]) == {"arrived", "delay", "steps"}
        assert 0 <= row[key]["arrived"] <= row["trains"]

    meta = json.loads((checkpoints / f"tour-{sid}-1.json").read_text())
    assert meta["interventions"] == n and meta["session_id"] == sid
    assert meta["hyperparameters"]["kl_weight"] == 3 and meta["hyperparameters"]["seed"] == 0

    # Kept and named: a second run gets the next name, and both are listed.
    second = client.post(f"/session/{sid}/lab/train", json={"klWeight": 1}).json()
    assert second["name"] == f"tour-{sid}-2"
    _wait(client, second["jobId"])
    jobs = client.get(f"/session/{sid}/lab/train").json()["jobs"]
    assert [j["name"] for j in jobs] == [f"tour-{sid}-1", f"tour-{sid}-2"]


def test_seeded_same_interventions_same_model(client, lab_dirs):
    import torch

    runs, checkpoints = lab_dirs
    sid = _session(client)
    _give_interventions(runs, sid)
    a = _wait(client, client.post(f"/session/{sid}/lab/train", json={"klWeight": 3}).json()["jobId"])
    b = _wait(client, client.post(f"/session/{sid}/lab/train", json={"klWeight": 3}).json()["jobId"])
    wa = torch.load(checkpoints / f"{a['name']}.pt", weights_only=False)["model"]
    wb = torch.load(checkpoints / f"{b['name']}.pt", weights_only=False)["model"]
    assert all(torch.equal(wa[k], wb[k]) for k in wa)


def test_one_job_per_session_at_a_time(client, lab_dirs, monkeypatch):
    runs, _ = lab_dirs
    sid = _session(client)
    _give_interventions(runs, sid)
    monkeypatch.setitem(lab_training._running, sid, "busy")
    r = client.post(f"/session/{sid}/lab/train", json={"klWeight": 3})
    assert r.status_code == 409 and r.json()["detail"] == "running"


# ── the tour's checkpoints: hidden, asked for by id, pruned ────────────

def test_tour_checkpoint_is_hidden_but_a_session_can_ask_for_it(client, lab_dirs):
    runs, checkpoints = lab_dirs
    sid = _session(client)
    _give_interventions(runs, sid)
    job = _wait(client, client.post(f"/session/{sid}/lab/train", json={"klWeight": 3}).json()["jobId"])
    pid = job["policyId"]

    assert pid not in registry.policy_ids(include_hidden=False)
    assert registry.get_policy_spec(pid).family == "learned"
    listed = {p["id"]: p for p in client.get("/policies").json()}
    assert listed[pid]["show_in_ui"] is False

    # Leg 3 of the tour: a fresh session that names the model.
    visible = sorted(registry.policy_ids(include_hidden=False))
    body = {"width": 30, "height": 30, "number_of_agents": 3, "seed": 42, "enabled_policy_ids": [*visible, pid]}
    leg3 = client.post("/session", json=body).json()["id"]
    assert client.post(f"/session/{leg3}/policy", json={"policy": pid}).status_code == 200
    assert pid in client.get(f"/session/{leg3}/scenario-policies").json()["available_policy_ids"]
    step = client.post(f"/session/{leg3}/step", json={"policy": pid, "n_steps": 2})
    assert step.status_code == 200

    # Any other session does not get it.
    plain = client.post("/session", json={"width": 30, "height": 30, "number_of_agents": 3, "seed": 42}).json()["id"]
    assert client.post(f"/session/{plain}/policy", json={"policy": pid}).status_code == 400


def test_tour_checkpoints_visible_when_configured(lab_dirs, monkeypatch):
    _, checkpoints = lab_dirs
    checkpoints.mkdir(parents=True, exist_ok=True)
    from app.policies.learned.learned_ppo_policy import DEFAULT_CHECKPOINT

    (checkpoints / "tour-abc-1.pt").write_bytes(DEFAULT_CHECKPOINT.read_bytes())
    assert "lab:tour-abc-1" not in registry.policy_ids(include_hidden=False)
    monkeypatch.setenv("MARL_LAB_TOUR_CHECKPOINTS", "visible")
    assert "lab:tour-abc-1" in registry.policy_ids(include_hidden=False)


def test_old_tour_checkpoints_are_pruned(lab_dirs, monkeypatch):
    _, checkpoints = lab_dirs
    checkpoints.mkdir(parents=True, exist_ok=True)
    old, fresh, mine = (checkpoints / f"{n}.pt" for n in ("tour-old-1", "tour-new-1", "corrected"))
    for p in (old, fresh, mine):
        p.write_bytes(b"x")
        p.with_suffix(".json").write_text("{}")
    two_days_ago = time.time() - 48 * 3600
    for p in (old, mine):
        os.utime(p, (two_days_ago, two_days_ago))

    monkeypatch.setenv("MARL_LAB_TOUR_TTL_HOURS", "0")
    assert lab_training.prune_tour_checkpoints() == []
    monkeypatch.setenv("MARL_LAB_TOUR_TTL_HOURS", "24")
    assert lab_training.prune_tour_checkpoints() == ["tour-old-1"]
    assert not old.exists() and not old.with_suffix(".json").exists()
    assert fresh.exists() and mine.exists()  # a CLI checkpoint is never pruned
    assert lab_checkpoints.tour_ttl_hours() == 24
