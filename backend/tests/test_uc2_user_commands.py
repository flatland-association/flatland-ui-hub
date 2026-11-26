"""User-command rollouts and verified corrections for UC2 recovery training."""
import json
from pathlib import Path

import pytest

from app.core.override_manager import override_manager
from app.policies.learned import uc2_roam_bundle
from lab.marl import uc2_user_commands as U
from lab.marl.pf_ch_episode import PFChCase

HELDOUT = Path(__file__).resolve().parents[2] / "docs/examples/uc2-user-command-recovery/heldout-cases.json"


def test_command_validation_and_labels():
    assert U.Command(1, "stop", 15, 30).label() == "T1 STOP 15 steps @30"
    assert U.Command(0, "turn", U.LEFT, 4).action == U.LEFT
    with pytest.raises(ValueError):
        U.Command(0, "turn", U.STOP, 0)
    with pytest.raises(ValueError):
        U.Command(0, "stop", 0, 0)
    commands = (U.Command(0, "stop", 5, 3), U.Command(2, "turn", U.RIGHT, 9))
    assert U.commands_from_json(U.commands_to_json(commands)) == commands


def test_training_commands_are_disjoint_from_the_heldout_suite():
    heldout = json.loads(HELDOUT.read_text())["cases"]
    held = {(c["preset"], tuple(sorted((x["handle"], x["kind"], x["value"], x["step"]) for x in c["commands"])))
            for c in heldout}
    for preset, trains, steps in (("tutorial", 2, 24), ("uc2-1", 3, 89), ("uc2-4", 3, 96)):
        train = U.training_command_sets(preset, trains, steps)
        keys = {(preset, tuple(sorted((c.handle, c.kind, c.value, c.step) for c in cs))) for cs in train}
        assert not keys & held
        assert {c.value for cs in train for c in cs if c.kind == "stop"} == {3, 10, 25, 60}


def test_schedule_holds_stop_for_applied_steps_then_releases():
    sid = "test-schedule"
    schedule = U.CommandSchedule([U.Command(1, "stop", 2, 5)], sid)
    try:
        schedule.before_step(4)
        assert override_manager.get(sid, 1) is None
        schedule.before_step(5)
        assert override_manager.get(sid, 1) == U.STOP
        env = type("Env", (), {"agents": [type("A", (), {"state": None})() for _ in range(2)]})()
        schedule.after_step(5, {}, {}, env)  # not yet at a decision point: hold does not count
        schedule.before_step(6)
        schedule.after_step(6, {1: "override"}, {1: U.FORWARD}, env)
        assert schedule.effective
        schedule.before_step(7)
        assert override_manager.get(sid, 1) == U.STOP
        schedule.before_step(8)
        assert override_manager.get(sid, 1) is None
        assert schedule.release_step_passed(8)
    finally:
        override_manager.clear_all(sid)


@pytest.mark.integration
@pytest.mark.parametrize("preset, lateness", [("tutorial", 9), ("uc2-2", 24)])
def test_rollout_matches_shipped_runtime_without_commands(preset, lateness):
    runtime, _ = U.run_episode(PFChCase(preset), U.runtime_driver)
    explicit, _ = U.run_episode(PFChCase(preset), U.checkpoint_driver(uc2_roam_bundle.checkpoint_for_scenario(preset)))
    assert runtime == explicit
    assert runtime["solved"] and runtime["lateness"] == lateness


@pytest.mark.integration
def test_corrections_apply_only_inside_the_roam_mask_and_recover_a_heldout_failure():
    # heldout-0003: T0 forced LEFT at step 0 on the tutorial. The shipped tutorial
    # specialist (unchanged by the user-command recovery fit) deadlocks; verified
    # waits of T1 let the whole commanded episode finish.
    commands = (U.Command(0, "turn", U.LEFT, 0),)
    driver = U.checkpoint_driver(uc2_roam_bundle.checkpoint_for_scenario("tutorial"))
    failed, records = U.run_episode(PFChCase("tutorial"), driver, commands, record=True)
    assert failed["effective"] and not failed["solved"]
    assert all(r["mask"][r["proposal"]] >= .5 for r in records)
    found = U.find_corrections(PFChCase("tutorial"), driver, commands)
    assert found is not None and found["result"]["solved"]
    for (step, handle), action in found["corrections"].items():
        row = next(r for r in found["records"] if r["step"] == step and r["handle"] == handle)
        assert row["mask"][action] >= .5 and row["proposal"] == action
    # an action outside the mask is ignored, not forced
    masked_out = next((r, a) for r in records for a in range(5) if r["mask"][a] < .5)
    result, _ = U.run_episode(PFChCase("tutorial"), driver, commands,
                              corrections={(masked_out[0]["step"], masked_out[0]["handle"]): masked_out[1]})
    assert result["corrections_applied"] == []


@pytest.mark.integration
@pytest.mark.parametrize("preset, case_id", [("uc2-2", "heldout-0462"), ("uc2-1", "heldout-0308")])
def test_recovered_specialists_finish_heldout_cases_the_previous_ones_deadlocked(preset, case_id):
    # Both cases failed with the 13 November specialists (docs/examples/uc2-user-command-recovery/).
    case = next(c for c in json.loads(HELDOUT.read_text())["cases"] if c["id"] == case_id)
    result, _ = U.run_episode(PFChCase(preset), U.runtime_driver, U.commands_from_json(case["commands"]))
    assert result["effective"] and result["solved"]
