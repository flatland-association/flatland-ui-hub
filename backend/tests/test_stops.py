"""Stage 2f: replan and reroute call at the trains' intermediate stops.

Plan: docs/plans/proposal-agents-roadmap.md (stage 2f).
"""
import warnings

warnings.filterwarnings("ignore")

import pytest

from app.api.overrides import _branch_run, _policy_factory_for_session, get_proposals
from app.api.sessions import _build_policy
from app.core.route_overrides import REROUTE_ACTION
from app.core.session_manager import session_manager
from app.core.stops import intermediate_stops, is_ahead, remaining_stops
from app.planners.replan import replan_from_state
from app.policies.plan_policy import PlanPolicy

PRESET = "pf-ch-corridor-stops"  # 16 trains, three intermediate stops each
FORK_STEP = 20
#: The order the proposals rank best at step 20.
ORDER = (14, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15)


@pytest.fixture(scope="module")
def session():
    session = session_manager.create(scenario_preset_id=PRESET)
    policy = _build_policy(session.id, session.env, session.policy)
    for _ in range(FORK_STEP):
        policy.start_step()
        actions = policy.act_many(session.env.get_agent_handles(), session.last_observations or {})
        session.last_observations, _, _, _ = session.env.step(actions)
        policy.end_step()
    return session


def _planned_stands(env, trainruns) -> dict:
    """Per train, the stop indices its run stands at (next waypoint > 1 step later)."""
    stands = {}
    for handle, run in trainruns.items():
        stops = remaining_stops(env, handle)
        got = set()
        for here, nxt in zip(run, run[1:]):
            if nxt.scheduled_at <= here.scheduled_at + 1:
                continue
            row, col = here.waypoint.position
            got |= {s.index for s in stops if s.matches(row, col, here.waypoint.direction)}
        stands[handle] = got
    return stands


def test_stops_are_read_from_the_timetable():
    env = session_manager.create(scenario_preset_id=PRESET).env
    stops = intermediate_stops(env.agents[0])

    assert [s.index for s in stops] == [1, 2, 3]
    assert stops[0].alternatives == ((2, 28, 1),)
    assert stops[0].earliest_departure == 89
    # Nothing served before the run starts.
    assert remaining_stops(env, 0) == stops


def test_a_stop_far_off_the_way_is_not_ahead():
    assert is_ahead(10, 20, 30)
    # Turning round at a dead end to reach a passed station doubles the way.
    assert not is_ahead(40, 40, 30)
    assert not is_ahead(float("inf"), 0, 30)


def test_the_replan_stands_at_stops_and_the_simulation_counts_them(session):
    env = session.env
    trainruns = replan_from_state(env, priority=ORDER)
    assert trainruns is not None

    stands = _planned_stands(env, trainruns)
    res = _branch_run(env, lambda: PlanPolicy(None, trainruns), {}, 200)

    assert sum(len(s) for s in stands.values()) > 0
    for handle, outcome in res.agent_outcomes.items():
        if handle in stands and outcome["arrived"]:
            # Every stop the replan stands at is served in the simulation —
            # including a train running late, which PlanPolicy now holds there.
            assert outcome["stops_served"] >= len(stands[handle]), handle


def test_proposals_count_skipped_stops(session):
    on_map = next(a.handle for a in session.env.agents if a.position is not None and remaining_stops(session.env, a.handle))

    response = get_proposals(session.id, handle=on_map, alternatives=1)

    plan, ai = response["variants"][:2]
    assert {"stops_served", "stops_total"} <= set(ai["train"])
    assert "stops_missed" in ai["metrics"]
    # The scenario's default policy calls at no station; the replan calls at most.
    assert ai["metrics"]["stops_missed"] < plan["metrics"]["stops_missed"]


def test_a_reroute_stands_at_the_stops_on_its_way(session):
    res = _branch_run(session.env, _policy_factory_for_session(session), {15: REROUTE_ACTION}, 200)

    outcome = res.agent_outcomes[15]
    assert outcome["arrived"]
    assert outcome["stops_served"] == outcome["stops_total"] == 3
