"""MIT ROAM fixed-graph expectations and native Flatland 4.3 parity tests.

Adapted from ecml2026-starterkit/tests/test_roam_check.py at repository HEAD
ccbcf3de22fb7daa8276948e37819a904aac550e, original SHA256
b0cc093830eee82478e9b1f76a94c3a78e27485f192e67abee23cf9b09416658.
Licence: lab/marl/LICENSE.roam-starterkit. No starterkit builder is imported.
"""
from fractions import Fraction
from types import SimpleNamespace

import numpy as np
import pytest
from flatland.core.env_observation_builder import DummyObservationBuilder
from flatland.core.grid.grid_resource_map import GridResourceMap
from flatland.envs.agent_utils import EnvAgent
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_grid_transition_map import RailGridTransitionMap
from flatland.envs.rail_trainrun_data_structures import Waypoint
from flatland.envs.rewards import ECML2026Rewards
from flatland.envs.step_utils.speed_counter import SpeedCounter
from flatland.envs.step_utils.states import TrainState
from flatland.envs.timetable_utils import Line, Timetable

from lab.marl.roam_check import (
    RailTables, RoamCheck, TrainFacts, calculate_safe_action_mask,
    calculate_withdrawn_actions, can_complete, get_check, open_waypoint_groups,
    predict_configuration, rail_tables, stuck_trains,
)

def graph_tables(successors, resources=None):
    cfgs = tuple(((0, i), 1) for i in range(len(successors)))
    return RailTables(
        cfgs,
        {c: i for i, c in enumerate(cfgs)},
        tuple(tuple(s) for s in successors),
        tuple(range(len(cfgs))) if resources is None else tuple(resources),
    )

def facts(node, target, *stops):
    return TrainFacts(
        node, tuple(frozenset(s) for s in (*stops, {target})), frozenset({target})
    )

def graph_check(tables, initial):
    class Rail:
        def apply_action_independent(self, action, cfg):
            if action.value == 4:
                return cfg, True
            following = tables.successors[tables.indices[cfg]]
            if not following:
                return None
            branch = {0: 0, 1: 1, 2: 0, 3: 2}[action.value]
            node = following[branch] if branch < len(following) else following[0]
            return tables.configurations[node], True

    agents = []
    for handle, train in initial.items():
        agent = EnvAgent(
            initial_configuration=tables.configurations[train.node],
            current_configuration=tables.configurations[train.node],
            targets={tables.configurations[t] for t in train.terminals},
            handle=handle,
        )
        agent.state_machine.set_state(TrainState.MOVING)
        agent.speed_counter = SpeedCounter(1)
        agents.append(agent)
    resource_map = SimpleNamespace(
        get_resource=lambda cfg: (
            None if cfg is None else tables.resources[tables.indices[cfg]]
        )
    )
    env = SimpleNamespace(
        agents=agents,
        rail=Rail(),
        resource_map=resource_map,
        acceleration_delta=1,
        braking_delta=-1,
        _elapsed_steps=0,
    )
    check = object.__new__(RoamCheck)
    check.env, check.tables = env, tables
    check.partial_moves, check.max_candidates = False, 60
    check.facts = initial
    check.snapshot = lambda groups: (initial, set())
    check.withdrawals, check.withdrawal_times = 0, []
    return check

def test_two_individually_safe_moves_are_jointly_unsafe():
    tables = graph_tables([[2, 4], [3, 5], [3, 5], [2, 4], [], []])
    initial = {0: facts(0, 4), 1: facts(1, 5)}
    assert stuck_trains(tables, initial) == set()
    assert stuck_trains(tables, {0: facts(2, 4), 1: initial[1]}) == set()
    assert stuck_trains(tables, {0: initial[0], 1: facts(3, 5)}) == set()
    assert stuck_trains(tables, {0: facts(2, 4), 1: facts(3, 5)}) == {0, 1}

    check = graph_check(tables, initial)
    assert check.withdraw({0: 2, 1: 2}, {}) == {0: 2, 1: 4}

@pytest.mark.parametrize("move", [0, 2])
def test_earlier_follower_unblocked_after_winner_is_withdrawn(move):
    # 1 wins the target tie with 2, initially blocking both 2 and follower 0.
    # 1's move is unsafe; removing it must not let 0 follow the later handle
    # without ever having certified 0's movement.
    tables = graph_tables([[2], [3, 5], [3, 5], [2, 4, 6], [], [], []])
    initial = {0: facts(0, 4), 1: facts(1, 5), 2: facts(2, 6)}
    assert stuck_trains(tables, initial) == set()
    check = graph_check(tables, initial)
    assert check.withdraw({0: move, 1: move, 2: move}, {}) == {0: 4, 1: 4, 2: move}
    assert check.last_predictions == {
        0: tables.configurations[0],
        1: tables.configurations[1],
        2: tables.configurations[3],
    }

def test_order_alternatives_and_early_target_removal():
    tables = graph_tables([[1], [2], [3], []])
    assert can_complete(tables, facts(0, 3, {1, 2}), set())
    assert not can_complete(tables, facts(0, 3, {2}, {1}), set())
    assert not can_complete(tables, facts(0, 2, {3}), set())
    assert not can_complete(tables, facts(0, 3, {1}), {1})

def test_crossing_axes_are_separate_resources():
    crossing = GridResourceMap({(1, 1)})
    assert crossing.get_resource(((1, 1), 0)) != crossing.get_resource(((1, 1), 1))
    tables = graph_tables(
        [[2], [3], [], []], [((1, 1), 0), ((1, 1), 1), (0, 1), (1, 2)]
    )
    assert stuck_trains(tables, {0: facts(0, 2), 1: facts(1, 3)}) == set()

def test_partial_move_into_passing_loop():
    # A at 0 blocks B's route to 3, B at 1 blocks A's route to 4.
    # A can first wait in siding 2; then B finishes, and A finishes.
    tables = graph_tables([[2, 3], [0, 4], [1], [], []])
    trains = {0: facts(0, 4), 1: facts(1, 3)}
    assert stuck_trains(tables, trains) == {0, 1}
    assert stuck_trains(tables, trains, partial_moves=True) == set()
    assert stuck_trains(tables, trains, partial_moves=True, max_candidates=0) == {0, 1}

def test_completion_cache_keys_include_blockers_and_complete_mission():
    tables = graph_tables([[1, 2], [3], [3], []])
    check = graph_check(tables, {})
    assert check._can_complete(facts(0, 3), {1}) is True
    assert check._can_complete(facts(0, 3), {1, 2}) is False
    assert check._can_complete(facts(0, 3, {1}), {1}) is False
    assert check._can_complete(facts(0, 3, {2}), {1}) is True
    assert check._can_complete(facts(1, 3, {2}), {1}) is False
    assert check._can_complete(facts(0, 2, {3}), set()) is False
    assert check._can_complete(facts(0, 3), {1}) is True
    assert check.reachability_cache_info()["hits"] == 1
    other = graph_check(graph_tables([[], [], [], []]), {})
    assert other._can_complete(facts(0, 3), {1}) is False

@pytest.mark.parametrize("partial_moves", [False, True])
def test_cached_completion_matches_reference_across_changing_graph_states(
    partial_moves,
):
    rng = np.random.default_rng(29)
    for _ in range(12):
        edges = [list(map(int, rng.choice(8, size=2, replace=False))) for _ in range(8)]
        tables = graph_tables(edges)
        check = graph_check(tables, {})
        check.partial_moves = partial_moves
        for _ in range(12):
            nodes = rng.choice(6, size=3, replace=False)
            trains = {
                h: facts(
                    int(node),
                    6 + h % 2,
                    *([{int(rng.integers(0, 8))}] if _ % 2 else []),
                )
                for h, node in enumerate(nodes)
            }
            expected = stuck_trains(tables, trains, partial_moves=partial_moves)
            assert check.stuck(trains) == expected
            assert check.stuck(trains) == expected

def small_env(*, builder=None, opposing=True, speed=1.0):
    rail = RailGridTransitionMap(9, 4)
    links = {}
    paths = [
        [(1, c) for c in range(9)],
        [(1, 2), *[(2, c) for c in range(2, 7)], (1, 6)],
    ]
    for path in paths:
        for a, b in zip(path, path[1:]):
            links.setdefault(a, set()).add(b)
            links.setdefault(b, set()).add(a)
    offsets = ((-1, 0), (0, 1), (1, 0), (0, -1))
    for pos, neighbors in links.items():
        for incoming in range(4):
            previous = (pos[0] - offsets[incoming][0], pos[1] - offsets[incoming][1])
            if previous not in neighbors:
                continue
            for outgoing, delta in enumerate(offsets):
                nxt = (pos[0] + delta[0], pos[1] + delta[1])
                if nxt in neighbors and (nxt != previous or len(neighbors) == 1):
                    rail.set_transition((*pos, incoming), outgoing, 1)
    waypoints = {
        0: [[Waypoint((1, 1), 1)], [Waypoint((1, 7), None)]],
        1: [[Waypoint((1, 7), 3)], [Waypoint((1, 1), None)]],
    }
    if not opposing:
        waypoints[1] = [[Waypoint((1, 2), 1)], [Waypoint((1, 7), None)]]
    env = RailEnv(
        9,
        4,
        rail_generator=lambda *a: (rail, {}),
        line_generator=lambda *a: Line(waypoints, [speed, speed]),
        number_of_agents=2,
        obs_builder_object=builder or DummyObservationBuilder(),
        timetable_generator=lambda *a: Timetable(
            [[0, None]] * 2, [[None, 80]] * 2, 100
        ),
        rewards=ECML2026Rewards(),
        random_seed=12,
    )
    env.reset(random_seed=12)
    return env

def groups_for(env):
    return {a.handle: a.waypoints[1:] for a in env.agents}

def place(agent, cfg, state=TrainState.MOVING):
    agent.current_configuration = cfg
    agent.state_machine.set_state(state)

@pytest.mark.integration
def test_off_map_entry_is_masked_and_never_holds_resource():
    env = small_env()
    a, b = env.agents
    place(a, ((1, 4), 1))
    b.initial_configuration = ((1, 5), 3)
    b.state_machine.set_state(TrainState.READY_TO_DEPART)
    check = get_check(env)
    trains, stuck = check.snapshot(groups_for(env))
    assert set(trains) == {0}
    assert stuck == set()
    masks = calculate_safe_action_mask(env, groups_for(env))
    np.testing.assert_array_equal(masks[1], [1, 0, 0, 0, 1])
    assert masks[0][4] == 1
    assert all(mask.any() for mask in masks.values())

@pytest.mark.integration
def test_recovered_off_map_stop_can_enter_and_is_checked():
    env = small_env()
    a, b = env.agents
    place(a, ((1, 4), 1))
    b.initial_configuration = ((1, 5), 3)
    b.state_machine.set_state(TrainState.MALFUNCTION_OFF_MAP)
    assert predict_configuration(env, b, 4) == ((1, 5), 3)
    assert calculate_safe_action_mask(env, groups_for(env))[1][4] == 0
    assert calculate_withdrawn_actions(env, {0: 4, 1: 4}, groups_for(env))[1] == 0

@pytest.mark.integration
def test_recovered_off_map_stop_really_enters_in_flatland():
    env = small_env()
    agent = env.agents[0]
    agent.state_machine.set_state(TrainState.MALFUNCTION_OFF_MAP)
    assert predict_configuration(env, agent, 4) == ((1, 1), 1)
    assert calculate_safe_action_mask(env, groups_for(env))[0][4] == 1
    env.step({0: 4, 1: 0})
    assert agent.current_configuration == ((1, 1), 1)
    assert agent.state == TrainState.STOPPED

@pytest.mark.integration
@pytest.mark.parametrize("speed", [Fraction(1, 2), Fraction(3, 5)])
def test_fractional_train_holds_cell_during_malfunction_then_exits(speed):
    env = small_env(opposing=False, speed=speed)
    agent = env.agents[0]
    place(agent, ((1, 3), 1))
    agent.speed_counter.step()  # fraction of a cell traversed before the breakdown
    agent.malfunction_handler._set_malfunction_down_counter(2)
    for _ in range(2):
        assert predict_configuration(env, agent, 2) == ((1, 3), 1)
        env.step({0: 2, 1: 0})
        assert agent.current_configuration == ((1, 3), 1)
        assert agent.state == TrainState.MALFUNCTION
    assert predict_configuration(env, agent, 2) == ((1, 4), 1)
    actions = calculate_withdrawn_actions(env, {0: 2, 1: 0}, groups_for(env))
    env.step(actions)
    assert agent.current_configuration == ((1, 4), 1)
    assert agent.state == TrainState.MOVING

@pytest.mark.integration
@pytest.mark.parametrize("speed", [1.0, 0.5, 1 / 3, Fraction(3, 5)])
def test_predictions_match_random_simulator_rollouts(speed):
    rng = np.random.default_rng(9)
    env = small_env(speed=speed)
    for step in range(60):
        if step == 7:
            # Known on-map malfunction and recovery at fractional cell progress.
            agent = env.agents[0]
            if agent.state.is_on_map_state():
                agent.malfunction_handler._set_malfunction_down_counter(3)
        actions = {a.handle: int(rng.integers(0, 5)) for a in env.agents}
        accepted = calculate_withdrawn_actions(env, actions, groups_for(env))
        expected = dict(get_check(env).last_predictions)
        _, _, dones, _ = env.step(accepted)
        assert {a.handle: a.current_configuration for a in env.agents} == expected
        if dones["__all__"]:
            break

@pytest.mark.integration
def test_following_requires_accepted_leader_and_matches_motion_check():
    env = small_env(opposing=False)
    place(env.agents[0], ((1, 3), 1))
    place(env.agents[1], ((1, 2), 1))
    assert calculate_withdrawn_actions(env, {0: 2, 1: 2}, groups_for(env)) == {
        0: 2,
        1: 2,
    }
    env.step({0: 2, 1: 2})
    assert [a.current_configuration[0] for a in env.agents] == [(1, 4), (1, 3)]
    accepted = calculate_withdrawn_actions(env, {0: 4, 1: 2}, groups_for(env))
    assert accepted == {0: 4, 1: 2}
    env.step(accepted)
    assert [a.current_configuration[0] for a in env.agents] == [(1, 4), (1, 3)]

@pytest.mark.integration
def test_target_tie_and_swap_use_native_motion_check():
    env = small_env()
    place(env.agents[0], ((1, 3), 1))
    place(env.agents[1], ((1, 5), 3))
    actions = calculate_withdrawn_actions(env, {0: 2, 1: 2}, groups_for(env))
    assert actions == {0: 2, 1: 2}
    env.step(actions)
    assert [a.current_configuration[0] for a in env.agents] == [(1, 4), (1, 5)]
    actions = calculate_withdrawn_actions(env, {0: 2, 1: 2}, groups_for(env))
    assert actions == {0: 2, 1: 2}

@pytest.mark.integration
def test_delayed_braking_is_rejected_and_topology_cache_uses_contents():
    env = small_env()
    first = rail_tables(env)
    assert rail_tables(small_env()) is first
    env.braking_delta = -0.1
    with pytest.raises(ValueError, match="immediate STOP"):
        get_check(env)

@pytest.mark.integration
@pytest.mark.parametrize("state", list(TrainState))
def test_safe_fallback_is_present_in_every_train_state(state):
    env = small_env()
    agent = env.agents[0]
    place(
        agent, agent.initial_configuration if state.is_on_map_state() else None, state
    )
    mask = calculate_safe_action_mask(env, groups_for(env))[0]
    assert mask[4 if state.is_on_map_state() else 0] == 1
    assert mask.any()

@pytest.mark.integration
@pytest.mark.parametrize("preset", ["tutorial", "uc2-1", "uc2-2", "uc2-3", "uc2-4"])
def test_native_uc2_missions_use_authoritative_builder_and_supported_braking(preset):
    from app.core.env_factory import create_env
    from app.core.native_env_cache import clear_native_environment_caches
    from app.policies.learned.uc2_observation import UC2ObservationBuilder

    env = create_env(scenario_preset_id=preset)
    try:
        builder = UC2ObservationBuilder()
        builder.reset(env)
        before = [(a.state, a.current_configuration, a.speed_counter.__getstate__()) for a in env.agents]
        groups = open_waypoint_groups(builder.base)
        assert all(tuple(groups[a.handle]) == tuple(tuple(g) for g in a.waypoints[1:]) for a in env.agents)
        check = RoamCheck(env)
        trains, stuck = check.snapshot(groups)
        assert trains == {} and stuck == set()
        masks = check.action_mask(groups)
        assert all(row.shape == (5,) and row[0] == 1 and row.any() for row in masks.values())
        idle = {a.handle: 0 for a in env.agents}
        assert check.withdraw(idle, groups) == idle
        assert before == [(a.state, a.current_configuration, a.speed_counter.__getstate__()) for a in env.agents]
        if preset == "uc2-3":
            assert env.agents[0].speed_counter.max_speed == Fraction(3, 5)
    finally:
        clear_native_environment_caches()
