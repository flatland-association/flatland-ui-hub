"""Native conditional-following and whole-batch ROAM certificate regressions.

Fixed graph cases and the randomized graph audit are adapted from the MIT
ecml2026-starterkit/tests/test_roam_coordination.py at ccbcf3de22fb7daa8276948e37819a904aac550e,
SHA256 7bbb0350c7868815e5cc27c1a7211faaf5b3d8518c6993f4676edcc1f890cf6b.
Licence: lab/marl/LICENSE.roam-starterkit. No starterkit builder is imported.
"""
from collections import Counter
from fractions import Fraction
import hashlib
import random

import pytest
from flatland.envs.step_utils.speed_counter import SpeedCounter

from lab.marl.roam_check import RoamCheck, stuck_trains
from lab.marl.roam_joint_check import JointRoamCheck
from tests.test_uc2_roam_check import facts, graph_check, graph_tables, groups_for, place, small_env


def joint_graph(tables, initial):
    check = object.__new__(JointRoamCheck)
    check.__dict__.update(graph_check(tables, initial).__dict__)
    return check


def assert_actual_certificate(check, groups, baseline):
    trains, cached = check.snapshot(groups)
    reference = stuck_trains(check.tables, trains, partial_moves=check.partial_moves)
    assert cached == reference and reference <= baseline
    occupied = Counter(check.tables.resources[t.node] for t in trains.values())
    assert all(count == 1 for count in occupied.values())


@pytest.mark.integration
@pytest.mark.parametrize("leader", [0, 1])
@pytest.mark.parametrize("speed", [Fraction(1), Fraction(1, 2), Fraction(1, 3), Fraction(3, 5)])
@pytest.mark.parametrize("partial_moves", [False, True])
def test_conditional_following_preserves_native_same_step_release(leader, speed, partial_moves):
    env = small_env(opposing=False, speed=speed)
    follower = 1 - leader
    place(env.agents[leader], ((1, 3), 1))
    place(env.agents[follower], ((1, 2), 1))
    check = JointRoamCheck(env, partial_moves=partial_moves)
    for _ in range(4):
        groups = groups_for(env)
        masks = check.action_mask(groups)
        assert masks[leader][2] == masks[follower][2] == 1
        _, baseline = check.snapshot(groups)
        actions = check.withdraw({0: 2, 1: 2}, groups)
        expected = dict(check.last_predictions)
        assert actions == {0: 2, 1: 2}
        env.step(actions)
        assert {a.handle: a.current_configuration for a in env.agents} == expected
        assert_actual_certificate(check, groups_for(env), baseline)
        if env.agents[follower].current_configuration[0] == (1, 3):
            break
    assert env.agents[follower].current_configuration[0] == (1, 3)
    assert check.conditional_proposals > 0


@pytest.mark.integration
def test_conditional_proposal_does_not_assume_a_holder_chooses_to_leave():
    env = small_env(opposing=False)
    place(env.agents[0], ((1, 3), 1))
    place(env.agents[1], ((1, 2), 1))
    groups = groups_for(env)
    serial = RoamCheck(env)
    joint = JointRoamCheck(env)
    assert serial.action_mask(groups)[1][2] == 0
    assert joint.action_mask(groups)[1][2] == 1
    _, baseline = joint.snapshot(groups)
    actions = joint.withdraw({0: 4, 1: 2}, groups)
    expected = dict(joint.last_predictions)
    # Native MotionCheck blocks the follower. A permissive proposal is not
    # permission to occupy the resource if the holder actually stops.
    env.step(actions)
    assert [a.current_configuration for a in env.agents] == [((1, 3), 1), ((1, 2), 1)]
    assert {a.handle: a.current_configuration for a in env.agents} == expected
    assert_actual_certificate(joint, groups_for(env), baseline)


@pytest.mark.integration
@pytest.mark.parametrize("leader", [0, 1])
def test_known_malfunction_holds_resource_until_native_recovery(leader):
    env = small_env(opposing=False)
    follower = 1 - leader
    place(env.agents[leader], ((1, 3), 1))
    place(env.agents[follower], ((1, 2), 1))
    env.agents[leader].malfunction_handler._set_malfunction_down_counter(2)
    check = JointRoamCheck(env)
    for tick in range(3):
        groups = groups_for(env)
        _, baseline = check.snapshot(groups)
        masks = check.action_mask(groups)
        assert masks[follower][2] == (0 if tick < 2 else 1)
        actions = check.withdraw({0: 2, 1: 2}, groups)
        expected = dict(check.last_predictions)
        env.step(actions)
        assert {a.handle: a.current_configuration for a in env.agents} == expected
        assert_actual_certificate(check, groups_for(env), baseline)
        assert env.agents[follower].current_configuration[0] == ((1, 2) if tick < 2 else (1, 3))


def test_individually_safe_moves_require_whole_batch_withdrawal_and_recheck():
    tables = graph_tables([[2, 4], [3, 5], [3, 5], [2, 4], [], []])
    initial = {0: facts(0, 4), 1: facts(1, 5)}
    check = joint_graph(tables, initial)
    calls = []
    resolve = check._resolve_motion

    def observed(actions):
        calls.append(dict(actions))
        return resolve(actions)

    check._resolve_motion = observed
    assert check.withdraw({0: 2, 1: 2}, {}) == {0: 2, 1: 4}
    assert calls == [{0: 2, 1: 2}, {0: 2, 1: 4}]
    assert check.withdrawn_handles == {1}
    assert check.withdrawals == 1
    after = check.joint_after(initial, resolve({0: 2, 1: 4}))
    assert after is not None and stuck_trains(tables, after) == set()


def test_random_whole_batches_never_add_uncertified_missions():
    rng = random.Random(20261104)
    for _ in range(100):
        n = rng.randrange(4, 9)
        tables = graph_tables([[j for j in range(n) if j != i and rng.random() < .4] for i in range(n)])
        initial = {0: facts(0, n - 1), 1: facts(1, n - 2)}
        check = joint_graph(tables, initial)
        baseline = stuck_trains(tables, initial)
        check.snapshot = lambda groups: (initial, baseline)
        selected = check.withdraw({0: rng.choice([1, 2, 3]), 1: rng.choice([1, 2, 3])}, {})
        after = check.joint_after(initial, check._resolve_motion(selected))
        assert after is not None and stuck_trains(tables, after) <= baseline
        assert len(after) == len({tables.resources[t.node] for t in after.values()})


@pytest.mark.integration
@pytest.mark.parametrize("speed", [Fraction(1), Fraction(3, 5)])
@pytest.mark.parametrize("partial_moves", [False, True])
def test_native_random_actions_predictions_and_reference_certificate_with_known_faults(speed, partial_moves):
    env = small_env(speed=speed)
    check = JointRoamCheck(env, partial_moves=partial_moves)
    rng = random.Random(20471)
    for step in range(70):
        if step == 7 and env.agents[0].state.is_on_map_state():
            env.agents[0].malfunction_handler._set_malfunction_down_counter(3)
        groups = groups_for(env)
        _, baseline = check.snapshot(groups)
        before = [(a.state, a.current_configuration, a.speed_counter.__getstate__()) for a in env.agents]
        masks = check.action_mask(groups)
        requested = {a.handle: rng.choice([i for i, valid in enumerate(masks[a.handle]) if valid]) for a in env.agents}
        applied = check.withdraw(requested, groups)
        assert before == [(a.state, a.current_configuration, a.speed_counter.__getstate__()) for a in env.agents]
        expected = dict(check.last_predictions)
        _, _, done, _ = env.step(applied)
        assert {a.handle: a.current_configuration for a in env.agents} == expected
        assert_actual_certificate(check, groups_for(env), baseline)
        if done['__all__']:
            break


@pytest.mark.integration
@pytest.mark.parametrize(
    "preset, expected_v3_lateness, expected_v2_lateness, horizon, trains",
    [
        ("uc2-1", 19, 20, 168, 3),
        ("uc2-2", 24, 36, 102, 3),
        ("uc2-4", 30, 31, 180, 3),
        ("uc2-3", 20, None, 240, 3),
        ("tutorial", 9, None, 40, 2),
    ],
)
def test_frozen_actor_joint_guard_native_missions_preserve_completion_and_reduce_serial_delay(
    monkeypatch, preset, expected_v3_lateness, expected_v2_lateness, horizon, trains,
):
    """Guard-only gains survive the real frozen actor, faults and native clock.

    These are known exact-fixture regressions, not fresh generalisation cases.
    The golden totals protect the following/timing fix without pinning every
    action. Surprise-fault prediction mismatches are recorded separately;
    unexplained mismatches and actual certificate failures must remain zero.
    """
    import torch
    from app.policies.learned.uc2_bundle import CHECKPOINT, CHECKPOINT_SHA256
    from lab.marl import collect_pp_demonstrations
    from lab.marl.evaluate_uc2_roam import run_case
    from lab.marl.pf_ch_episode import PFChCase

    def forbidden_planner(*args, **kwargs):
        raise AssertionError("Frozen actor/ROAM evaluation must not invoke a PP rescue")

    monkeypatch.setattr(collect_pp_demonstrations, "create_teacher", forbidden_planner)
    monkeypatch.setattr(collect_pp_demonstrations, "candidate_trainruns", forbidden_planner)
    monkeypatch.setattr(collect_pp_demonstrations, "candidate_schedules", forbidden_planner)
    before = hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest()
    assert before == CHECKPOINT_SHA256
    case = PFChCase(preset, case_id=f"joint-exact-regression-{preset}")
    original_threads = torch.get_num_threads()
    torch.set_num_threads(1)
    try:
        result = run_case(case, "v3", CHECKPOINT, reference_audit=True)
        assert "technical_error" not in result, result.get("technical_error")
        assert result["complete_mission"] and result["arrived"] == result["total"] == trains
        assert result["horizon"] == horizon and result["steps"] <= horizon
        assert result["lateness"] == expected_v3_lateness
        assert result["planner_interventions"] == 0
        assert not result.get("motion_logit_bias", 0)
        for metric in ("uncertified_steps", "new_stuck_steps", "reference_disagreements",
                       "prediction_mismatches", "resource_conflicts"):
            assert result[metric] == 0, (metric, result[metric])
        assert result["endpoint_stuck"] == []
        if expected_v2_lateness is not None:
            serial = run_case(case, "v2", CHECKPOINT, reference_audit=True)
            assert "technical_error" not in serial, serial.get("technical_error")
            assert serial["complete_mission"] and serial["arrived"] == trains
            assert serial["horizon"] == horizon and serial["steps"] <= horizon
            assert serial["lateness"] == expected_v2_lateness > result["lateness"]
            assert serial["planner_interventions"] == 0
    finally:
        torch.set_num_threads(original_threads)
    assert hashlib.sha256(CHECKPOINT.read_bytes()).hexdigest() == before
