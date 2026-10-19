"""Stage 2e: a reroute is a route around the block, offered only when one exists.

Plan: docs/plans/proposal-agents-roadmap.md (stage 2e).
"""
import warnings

warnings.filterwarnings("ignore")

import pytest
from fastapi import HTTPException

from app.api.overrides import (
    OverrideRequest,
    ProposalApplyRequest,
    _branch_run,
    _policy_factory_for_session,
    apply_proposal,
    get_proposals,
    set_override,
)
from app.api.sessions import _build_policy
from app.core.disturbances import apply_due_disturbances
from app.core.impact_analysis import compute_impact
from app.core.override_manager import override_manager
from app.core.route_overrides import REROUTE_ACTION, blocked_cells, route_around_blocks
from app.core.scenario_presets import select_disturbances
from app.core.session_manager import session_manager
from tests.test_replan_proposals import _forked_session

PRESET = "pf-ch-wn-wal-long-approach"
WEESEN = "strategy-e1-breakdown-weesen"
ICE = 1


def _step(session, policy):
    policy.start_step()
    actions = policy.act_many(session.env.get_agent_handles(), session.last_observations or {})
    obs, _, dones, _ = session.env.step(actions)
    policy.end_step()
    session.last_observations = obs
    apply_due_disturbances(session.id, session, session.env)
    return dones


def _weesen_session():
    """Walensee with the Weesen breakdown, run to the first step it affects ICE_42."""
    session = session_manager.create(
        scenario_preset_id=PRESET, disturbances=select_disturbances(PRESET, [WEESEN]),
    )
    policy = _build_policy(session.id, session.env, session.policy)
    for _ in range(60):
        _step(session, policy)
        if compute_impact(session.env):
            return session
    raise AssertionError("the Weesen breakdown never affected a train")


def test_no_reroute_where_every_way_runs_through_the_block():
    # The tour breakdown stands on the single-track section: no way around it.
    session = _forked_session()
    item = next(i for i in compute_impact(session.env) if i["handle"] == ICE)

    assert item["can_reroute"] is False
    assert item["reroute_action"] is None
    with pytest.raises(HTTPException) as refused:
        get_proposals(session.id, handle=ICE, option="reroute")
    assert refused.value.status_code == 409
    with pytest.raises(HTTPException):
        set_override(session.id, ICE, OverrideRequest(action=REROUTE_ACTION))


def test_reroute_avoids_the_block_and_keeps_to_the_plan_elsewhere():
    session = _weesen_session()
    env = session.env
    route = route_around_blocks(env, ICE)

    assert route is not None
    assert not {(r, c) for r, c, _ in route} & blocked_cells(env)
    assert route[0][:2] == tuple(env.agents[ICE].position)
    assert route[-1][:2] == tuple(env.agents[ICE].target)
    # It stays on the planned run rather than taking the oncoming train's track.
    planned = {tuple(wp.waypoint.position) for wp in env._trainrun_plan[ICE]}
    # (The run ends one cell short of the target: Flatland ends it on arrival.)
    assert {(r, c) for r, c, _ in route[:-1]} <= planned


def test_proposed_reroute_arrives_and_every_train_still_does():
    session = _weesen_session()

    response = get_proposals(session.id, handle=ICE, option="reroute")

    plan, _ai, human = response["variants"]
    assert human["choice"] == "reroute"
    assert human["train"]["arrival_step"] is not None
    assert human["train"]["arrival_step"] < plan["train"]["arrival_step"]
    assert human["system"]["done"] == human["system"]["total"]


def test_committed_reroute_drives_the_live_train_to_its_target():
    session = _weesen_session()
    set_override(session.id, ICE, OverrideRequest(action=REROUTE_ACTION))
    assert ICE in session.env._route_overrides

    # The live run: the session's policy wrapped in OverridePolicy, as /step builds it.
    policy = _build_policy(session.id, session.env, session.policy)
    for _ in range(120):
        if _step(session, policy).get("__all__"):
            break

    assert session.env.agents[ICE].state.name == "DONE"
    assert override_manager.get(session.id, ICE) is None
    assert ICE not in session.env._route_overrides


def test_a_fork_follows_the_committed_route():
    session = _weesen_session()
    set_override(session.id, ICE, OverrideRequest(action=REROUTE_ACTION))
    committed = dict(override_manager.get_all(session.id))

    res = _branch_run(session.env, _policy_factory_for_session(session), committed, 120)

    assert res.agent_outcomes[ICE]["arrived"]


def test_another_action_or_keeping_the_plan_drops_the_route():
    session = _weesen_session()
    set_override(session.id, ICE, OverrideRequest(action=REROUTE_ACTION))

    set_override(session.id, ICE, OverrideRequest(action=4))
    assert ICE not in session.env._route_overrides

    apply_proposal(session.id, ProposalApplyRequest(variant="human", handle=ICE, option="reroute"))
    assert override_manager.get(session.id, ICE) == REROUTE_ACTION
    apply_proposal(session.id, ProposalApplyRequest(variant="plan", handle=ICE))
    assert override_manager.get(session.id, ICE) is None
    assert ICE not in session.env._route_overrides
