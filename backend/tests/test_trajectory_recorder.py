"""flatland-rl trajectories per session
(docs/plans/experiment-logging-frontend-and-replay.md §5.4.2, step 9).

A small random env stepped through `step_env`, as the endpoints and the play
loop do; the session folder is a temporary directory.
"""

import json

import pandas as pd
import pytest

from app.api.sessions import _build_policy
from app.config import settings
from app.core import study_paths, trajectory_recorder
from app.core.env_step import step_env
from app.core.session_manager import session_manager
from app.core.trajectory_recorder import PROVENANCE_FILE
from flatland.trajectories.trajectories import Trajectory

AGENTS = 3


@pytest.fixture
def session(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "study_trajectories_enabled", True)
    monkeypatch.setattr(settings, "study_snapshot_interval", 5)
    monkeypatch.setattr(study_paths, "session_dir", lambda s: tmp_path / s.id)
    s = session_manager.create(width=30, height=30, number_of_agents=AGENTS, seed=7, max_episode_steps=40)
    yield s
    session_manager.delete(s.id)


def _play(session, steps):
    policy = _build_policy(session.id, session.env, session.policy)
    for _ in range(steps):
        policy.start_step()
        actions = policy.act_many(session.env.get_agent_handles(), session.last_observations or {})
        _, _, dones, _ = step_env(session.id, session, actions, policy=policy)
        policy.end_step()
        if dones["__all__"]:
            break


def _folder(session):
    return session.trajectory.folder


def test_off_by_default(monkeypatch, session):
    monkeypatch.setattr(settings, "study_trajectories_enabled", False)
    _play(session, 2)
    assert session.trajectory is None


def test_one_row_per_step_and_agent_across_several_persists(session, monkeypatch):
    monkeypatch.setattr(trajectory_recorder, "PERSIST_EVERY", 4)
    _play(session, 10)
    session.trajectory.persist()
    folder = _folder(session)
    ep_id = session.trajectory.trajectory.ep_id
    trajectory = Trajectory.load_existing(folder, ep_id)
    assert len(trajectory.actions) == 10 * AGENTS
    assert len(trajectory.trains_positions) == 10 * AGENTS
    assert not trajectory.actions.duplicated(["env_time", "agent_id"]).any()
    provenance = pd.read_csv(folder / PROVENANCE_FILE, sep="\t")
    assert len(provenance) == 10 * AGENTS
    assert set(provenance["source"]) == {"policy"}


def test_load_env_reaches_a_recorded_step(session):
    _play(session, 12)
    session.trajectory.persist()
    folder = _folder(session)
    trajectory = Trajectory.load_existing(folder, session.trajectory.trajectory.ep_id)
    env = trajectory.load_env(start_step=10)
    assert env._elapsed_steps == 10
    assert (folder / "serialised_state" / f"{trajectory.ep_id}_step0010.pkl").exists()


def test_reset_starts_a_second_episode_in_the_same_folder(session):
    _play(session, 3)
    first = session.trajectory.trajectory.ep_id
    session.env.reset(regenerate_rail=False, regenerate_schedule=False, random_seed=session.seed)
    session.trajectory.on_reset(session.env)
    _play(session, 2)
    session.trajectory.persist()
    meta = json.loads((_folder(session) / "meta.json").read_text())
    assert [e["ep_id"] for e in meta["episodes"]][0] == first and len(meta["episodes"]) == 2
    actions = pd.read_csv(_folder(session) / "event_logs" / "ActionEvents.discrete_action.tsv", sep="\t")
    assert actions.groupby("episode_id").size().to_dict() == {first: 3 * AGENTS, meta["episodes"][1]["ep_id"]: 2 * AGENTS}


def test_meta_names_the_session_and_its_policy(session):
    _play(session, 1)
    meta = json.loads((_folder(session) / "meta.json").read_text())
    assert meta["session_id"] == session.id and meta["seed"] == 7
    assert meta["policy_changes"] == [{"ep_id": meta["episodes"][0]["ep_id"], "env_time": 0, "policy": session.policy}]
    assert meta["flatland_rl_version"]


def test_delete_persists(session, tmp_path):
    _play(session, 3)
    folder = _folder(session)
    session_manager.delete(session.id)
    actions = pd.read_csv(folder / "event_logs" / "ActionEvents.discrete_action.tsv", sep="\t")
    assert len(actions) == 3 * AGENTS


def test_pause_and_shutdown_write_a_short_leg(session):
    _play(session, 3)
    folder = _folder(session)
    actions_file = folder / "event_logs" / "ActionEvents.discrete_action.tsv"
    assert not actions_file.exists()  # 3 steps: below PERSIST_EVERY, not done
    trajectory_recorder.persist_trajectory(session)
    assert len(pd.read_csv(actions_file, sep="\t")) == 3 * AGENTS
    _play(session, 2)
    trajectory_recorder.close_all_trajectories([session])
    assert session.trajectory is None
    assert len(pd.read_csv(actions_file, sep="\t")) == 5 * AGENTS


def test_the_pause_route_writes_the_trajectory(session):
    from fastapi.testclient import TestClient

    from app.main import app

    _play(session, 2)
    assert TestClient(app).post(f"/session/{session.id}/pause").status_code == 200
    actions = pd.read_csv(_folder(session) / "event_logs" / "ActionEvents.discrete_action.tsv", sep="\t")
    assert len(actions) == 2 * AGENTS


def test_trajectory_evaluator_reproduces_an_undisturbed_episode(session):
    from flatland.evaluators.trajectory_evaluator import TrajectoryEvaluator

    _play(session, 15)
    session.trajectory.persist()
    trajectory = Trajectory.load_existing(_folder(session), session.trajectory.trajectory.ep_id)
    TrajectoryEvaluator(trajectory).evaluate(end_step=15)  # raises on a mismatch


def test_load_env_matches_the_live_env_after_a_scripted_disturbance(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app.core.scenario_presets import select_disturbances
    from app.main import app

    monkeypatch.setattr(settings, "study_trajectories_enabled", True)
    monkeypatch.setattr(settings, "study_snapshot_interval", 10)
    monkeypatch.setattr(study_paths, "session_dir", lambda s: tmp_path / s.id)
    preset, disturbance = "pf-ch-wn-wal-long-approach", "interview-e1-breakdown-single-track"
    events = select_disturbances(preset, [disturbance])
    step = int(events[0]["events"][0]["step"])
    session = session_manager.create(scenario_preset_id=preset, disturbances=events)
    try:
        end = step + 3  # between the disturbance's snapshot and the next interval one
        TestClient(app).post(f"/session/{session.id}/step", json={"policy": session.policy, "n_steps": end})
        assert int(session.env._elapsed_steps) == end
        session.trajectory.persist()
        folder = _folder(session)
        trajectory = Trajectory.load_existing(folder, session.trajectory.trajectory.ep_id)
        assert (folder / "serialised_state" / f"{trajectory.ep_id}_step{step:04d}.pkl").exists()
        disturbances = pd.read_csv(folder / "event_logs" / "HmiEvents.disturbances.tsv", sep="\t")
        assert list(disturbances["env_time"]) == [step]
        restored = trajectory.load_env(start_step=end)
        live = session.env
        assert [a.current_configuration for a in restored.agents] == [a.current_configuration for a in live.agents]
        assert [a.malfunction_handler.malfunction_down_counter for a in restored.agents] == [
            a.malfunction_handler.malfunction_down_counter for a in live.agents
        ]
    finally:
        session_manager.delete(session.id)
