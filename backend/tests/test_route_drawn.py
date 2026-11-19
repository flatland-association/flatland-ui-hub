"""Drawn routes (Fahrweg einstellen): via cells, off-map start, DLA respecting them.

The Plan B tutorial: AB from A (col 3) to B (col 21), BA the other way, a
passing loop on row 1 between the switches (2,10) and (2,14); AB breaks down at
step 8 for 4 steps. DLA alone keeps BA at B until AB is through, so BA misses.
Plan: docs/plans/set-route-on-map.md.
"""
import pytest
from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.step_utils.states import TrainState

from app.core.env_factory import load_preset_env
from app.core.override_manager import override_manager
from app.core.route_overrides import REROUTE_ACTION, commit_route, route_move, route_through
from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy
from app.policies.override_policy import OverridePolicy
from app.utils.agent_compat import agent_position

AB, BA = 0, 1
LOOP = [(1, 12)]


def _run(env, session_id, steps=40):
    arrived = {}
    positions = []
    for _ in range(steps):
        policy = OverridePolicy(DeadLockAvoidancePolicy(), session_id)
        policy.reset(env)
        policy.start_step()
        _, _, dones, _ = env.step(policy.act_many(env.get_agent_handles(), {h: env for h in env.get_agent_handles()}))
        now = env._elapsed_steps
        positions.append([agent_position(a) for a in env.agents])
        for a in env.agents:
            if a.state == TrainState.DONE:
                arrived.setdefault(a.handle, now)
        if dones["__all__"]:
            break
    return arrived, positions


def test_route_through_the_loop_from_the_origin():
    env = load_preset_env("tutorial")
    route = route_through(env, BA, LOOP)
    cells = [(r, c) for r, c, _ in route]
    assert cells[0] == (2, 21)  # BA waits off the map: the route starts at its origin
    assert (1, 12) in cells and (2, 12) not in cells
    assert cells[-1] == (2, 3)


def test_route_through_unreachable_cell_is_none():
    env = load_preset_env("tutorial")
    assert route_through(env, BA, [(0, 0)]) is None


def test_off_map_train_enters_on_its_drawn_route():
    env = load_preset_env("tutorial")
    env.step({})
    env.step({})  # BA ready to depart
    assert commit_route(env, BA, LOOP)
    assert route_move(env, BA) == RailEnvActions.MOVE_FORWARD  # enter at the origin


@pytest.mark.integration
def test_tutorial_drawn_route_lets_both_trains_arrive():
    session_id = "test-route-drawn-tutorial"
    override_manager.clear_all(session_id)
    try:
        baseline, _ = _run(load_preset_env("tutorial"), session_id)
        assert BA not in baseline  # DLA alone: BA misses

        env = load_preset_env("tutorial")
        for _ in range(3):  # the operator draws while the clock runs
            env.step({})
        assert commit_route(env, BA, LOOP)
        override_manager.set(session_id, BA, REROUTE_ACTION)
        arrived, positions = _run(env, session_id)
        assert AB in arrived and BA in arrived
        assert any(p[BA] is not None and tuple(p[BA]) == (1, 12) for p in positions)  # BA took the loop
    finally:
        override_manager.clear_all(session_id)


@pytest.mark.integration
def test_proposals_and_apply_take_the_drawn_cells():
    from app.api.overrides import ProposalApplyRequest, apply_proposal, get_proposals
    from app.core.session_manager import session_manager

    session = session_manager.create(scenario_preset_id="tutorial")
    try:
        for _ in range(3):
            session.env.step({})
        response = get_proposals(session.id, handle=BA, option="reroute", via="1,12")
        plan, human = response["variants"][0], response["variants"][-1]
        assert human["choice"] == "reroute"
        assert human["train"]["arrival_step"] is not None
        assert plan["train"]["arrival_step"] is None  # DLA alone: BA misses
        assert BA not in (getattr(session.env, "_route_overrides", None) or {})  # read-only

        apply_proposal(session.id, ProposalApplyRequest(variant="human", handle=BA, option="reroute", via=[[1, 12]]))
        assert override_manager.get(session.id, BA) == REROUTE_ACTION
        assert (1, 12) in [(r, c) for r, c, _ in session.env._route_overrides[BA]]
    finally:
        override_manager.clear_all(session.id)
        session_manager.delete(session.id)


@pytest.mark.integration
def test_via_that_no_route_passes_is_rejected():
    from fastapi import HTTPException

    from app.api.overrides import get_proposals
    from app.core.session_manager import session_manager

    session = session_manager.create(scenario_preset_id="tutorial")
    try:
        with pytest.raises(HTTPException) as err:
            get_proposals(session.id, handle=BA, option="reroute", via="0,0")
        assert err.value.status_code == 400
        with pytest.raises(HTTPException):
            get_proposals(session.id, handle=BA, option="reroute", via="1;x")
    finally:
        session_manager.delete(session.id)


@pytest.mark.integration
def test_override_endpoint_commits_a_drawn_route():
    from app.api.overrides import OverrideRequest, set_override
    from app.core.session_manager import session_manager

    session = session_manager.create(scenario_preset_id="tutorial")
    try:
        session.env.step({})
        session.env.step({})
        set_override(session.id, BA, OverrideRequest(action=REROUTE_ACTION, via=[[1, 12]]))
        assert override_manager.get(session.id, BA) == REROUTE_ACTION
        assert BA in session.env._route_drawn
    finally:
        override_manager.clear_all(session.id)
        session_manager.delete(session.id)


def _record_plan(steps=40):
    """The tutorial's DLA run as trainruns: one waypoint per cell entered."""
    from flatland.envs.rail_trainrun_data_structures import TrainrunWaypoint, Waypoint

    from app.utils.agent_compat import agent_direction

    env = load_preset_env("tutorial")
    runs = {AB: [], BA: []}
    for _ in range(steps):
        policy = OverridePolicy(DeadLockAvoidancePolicy(), "test-route-drawn-record")
        policy.reset(env)
        policy.start_step()
        _, _, dones, _ = env.step(policy.act_many(env.get_agent_handles(), {h: env for h in env.get_agent_handles()}))
        if dones["__all__"]:
            break
        for a in env.agents:
            pos = agent_position(a)
            run = runs[a.handle]
            if pos is not None and (not run or run[-1].waypoint.position != tuple(pos)):
                run.append(TrainrunWaypoint(
                    scheduled_at=env._elapsed_steps,
                    waypoint=Waypoint(tuple(int(v) for v in pos), int(agent_direction(a))),
                ))
    return {h: run for h, run in runs.items() if run}


def test_plan_policy_keeps_only_the_routes_its_course_was_simulated_with_on_plan():
    from app.policies.plan_policy import PlanPolicy, note_course_routes

    plan = _record_plan()
    env = load_preset_env("tutorial")
    route = route_through(env, BA, LOOP)
    note_course_routes(env, {BA: route})  # e.g. a kept reroute (#208)
    policy = PlanPolicy(env, plan, fallback=DeadLockAvoidancePolicy())
    policy.reset(env)

    assert policy.set_committed_overrides(set(), {BA: route}) is True  # DLA's answer
    assert policy.off_plan_handles == []  # the course was simulated with it: stays on plan

    note_course_routes(env, {})  # committed after the course was taken
    assert policy.set_committed_overrides(set(), {BA: route}) is True
    assert policy.off_plan_handles == [BA]


@pytest.mark.integration
def test_drawn_route_under_a_taken_plan_is_driven_by_the_fallback():
    """S-6: a train rerouted after the plan was taken leaves it, DLA drives its route."""
    from app.policies.plan_policy import PlanPolicy, install_trainrun_plan

    plan = _record_plan()
    session_id = "test-route-drawn-plan"
    override_manager.clear_all(session_id)
    try:
        env = load_preset_env("tutorial")
        install_trainrun_plan(env, plan)
        arrived, on_loop = {}, False
        for t in range(45):
            if t == 3:
                assert commit_route(env, BA, LOOP)
                override_manager.set(session_id, BA, REROUTE_ACTION)
            policy = OverridePolicy(PlanPolicy(env, plan, fallback=DeadLockAvoidancePolicy()), session_id)
            policy.reset(env)
            policy.start_step()
            _, _, dones, _ = env.step(policy.act_many(env.get_agent_handles(), {h: env for h in env.get_agent_handles()}))
            position = agent_position(env.agents[BA])
            on_loop = on_loop or (position is not None and tuple(position) == (1, 12))
            for a in env.agents:
                if a.state == TrainState.DONE:
                    arrived.setdefault(a.handle, env._elapsed_steps)
            if dones["__all__"]:
                break
        assert env._plan_off_plan == {BA}
        assert on_loop
        assert AB in arrived and BA in arrived  # not held for the old plan's departure
    finally:
        override_manager.clear_all(session_id)
