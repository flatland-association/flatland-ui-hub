"""MARL lab step 2: interventions on a learned policy are logged (docs/plans/marl-lab-plan.md)."""
import json

import pytest
from flatland.envs.rail_env import RailEnvActions

from app.core import intervention_log
from app.core.env_factory import create_env
from app.core.override_manager import override_manager
from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy
from app.policies.learned.learned_ppo_policy import LearnedPpoPolicy
from app.policies.override_policy import OverridePolicy


@pytest.fixture(autouse=True)
def runs_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("MARL_LAB_RUNS_DIR", str(tmp_path))
    return tmp_path


def _drive_until_applied(session_id, policy_factory, action, steps=120):
    """Request `action` for train 0 and step until the override is consumed."""
    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    wrapped = OverridePolicy(policy_factory(env), session_id)
    wrapped.reset(env)
    override_manager.set(session_id, 0, action.value)
    intervention_log.note_request(session_id, 0, action.value, step=0, mode="director", owner="human")
    handles = env.get_agent_handles()
    for _ in range(steps):
        env.step(wrapped.act_many(handles, {}))
        if override_manager.get(session_id, 0) is None:
            break
    override_manager.clear_all(session_id)  # leave no empty entry for other tests
    return env


def _lines(runs_dir, session_id):
    path = runs_dir / session_id / "interventions.jsonl"
    return [json.loads(l) for l in path.read_text().splitlines()] if path.exists() else []


def test_an_override_on_the_learned_policy_writes_one_record(runs_dir):
    _drive_until_applied("lab-1", LearnedPpoPolicy, RailEnvActions.MOVE_LEFT)
    lines = _lines(runs_dir, "lab-1")
    assert len(lines) == 1
    rec = lines[0]
    assert rec["handle"] == 0 and rec["mode"] == "director" and rec["owner"] == "human"
    assert rec["human_action"] == RailEnvActions.MOVE_LEFT.value
    assert 0 <= rec["ai_action"] <= 4 and rec["agreed"] == (rec["ai_action"] == rec["human_action"])
    assert len(rec["obs"]) == 36 and len(rec["mask"]) == 5 and len(rec["ai_probs"]) == 5


def test_a_sticky_stop_is_logged_once_not_every_step(runs_dir):
    env = create_env(width=30, height=30, number_of_agents=3, seed=42)
    wrapped = OverridePolicy(LearnedPpoPolicy(env), "lab-stop")
    wrapped.reset(env)
    override_manager.set("lab-stop", 0, RailEnvActions.STOP_MOVING.value)
    intervention_log.note_request("lab-stop", 0, 4, step=0, mode="recommendation", owner="human")
    handles = env.get_agent_handles()
    for _ in range(60):
        _, _, dones, _ = env.step(wrapped.act_many(handles, {}))
        if dones["__all__"]:
            break
    override_manager.clear_all("lab-stop")
    # The STOP held for many steps at its decision point, but it is one decision.
    assert len(_lines(runs_dir, "lab-stop")) == 1


def test_other_policies_and_branch_sessions_are_never_logged(runs_dir):
    _drive_until_applied("rule-1", lambda env: DeadLockAvoidancePolicy(), RailEnvActions.MOVE_LEFT)
    _drive_until_applied("branch-abc", LearnedPpoPolicy, RailEnvActions.MOVE_LEFT)
    assert _lines(runs_dir, "rule-1") == [] and _lines(runs_dir, "branch-abc") == []


def test_an_unwritable_runs_dir_does_not_break_stepping(monkeypatch, tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("not a directory")
    monkeypatch.setenv("MARL_LAB_RUNS_DIR", str(blocker))
    _drive_until_applied("lab-ro", LearnedPpoPolicy, RailEnvActions.MOVE_LEFT)  # must not raise
