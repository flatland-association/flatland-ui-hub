"""Exact shown-course acceptance and responsive clone-only proposal forecasts."""
import asyncio
from collections import OrderedDict
import copy
from threading import Event, get_ident
from types import SimpleNamespace

from fastapi import HTTPException
from fastapi.testclient import TestClient
from flatland.envs.rail_trainrun_data_structures import TrainrunWaypoint, Waypoint
import pytest

from app.api import overrides, websockets
from app.core import pf_ch_control, proposal_preview
from app.core.override_manager import override_manager
from app.core.play_manager import play_manager
from app.core.proposal_agents.uc2_rl import rollout_trainruns
from app.core.session_manager import session_manager
from app.policies.plan_policy import accept_trainrun_plan, planned_arrival_steps, trainruns_from_env

pytestmark = pytest.mark.integration


@pytest.fixture
def session():
    s = session_manager.create(scenario_preset_id="tutorial")
    s.proposal_agent_id = "uc2_rl"
    yield s
    override_manager.clear_all(s.id)
    session_manager.delete(s.id)


def proposal(trainruns=None, candidate="greedy"):
    return SimpleNamespace(candidate_id=candidate, priority=(), trainruns=trainruns or {},
                           intervention={"kind": "rl", "handle": 0})


def test_preview_cache_is_bounded_owns_trainruns_and_never_retains_environment(session):
    source = proposal_preview.source_state(session)
    runs = {0: ["owned-course"]}
    token = proposal_preview.remember_course(session, source, 0, proposal(runs))
    runs[0].append("later-mutation")
    selected = proposal_preview.exact_course(session, token, handle=0, candidate_id="greedy",
                                             source_step=0, priority=[])
    assert selected == {0: ["owned-course"]}
    selected[0].append("caller-mutation")
    assert session._proposal_previews[token].trainruns == {0: ["owned-course"]}
    assert isinstance(session._proposal_previews, OrderedDict)
    assert session._proposal_previews[token].source.env_id == id(session.env)
    assert not hasattr(session._proposal_previews[token], "env")
    for _ in range(proposal_preview.MAX_COURSES_PER_SESSION):
        proposal_preview.remember_course(session, source, 0, proposal())
    assert len(session._proposal_previews) == proposal_preview.MAX_COURSES_PER_SESSION
    assert token not in session._proposal_previews


@pytest.mark.parametrize("change", ["step", "physics", "malfunction", "policy", "overrides", "route", "plan", "reset", "env", "adviser"])
def test_same_step_and_episode_source_changes_reject_without_mutation(session, change):
    token = proposal_preview.remember_course(session, proposal_preview.source_state(session), 0, proposal({0: ["never-install"]}))
    env = session.env
    if change == "step":
        env._elapsed_steps += 1
    elif change == "physics":
        env.agents[0].earliest_departure += 1
    elif change == "malfunction":
        env.agents[0].malfunction_handler._set_malfunction_down_counter(4)
    elif change == "policy":
        session.policy = "shortest_path"
    elif change == "overrides":
        override_manager.set(session.id, 0, 4)
    elif change == "route":
        env._route_overrides = {0: [(0, 0, 1)]}
    elif change == "plan":
        env._accepted_trainrun_plan = True
    elif change == "reset":
        env.reset(regenerate_rail=False, regenerate_schedule=False)
    elif change == "env":
        session.env = copy.deepcopy(env)
    else:
        session.proposal_agent_id = "pp_replan"
    before = proposal_preview.source_state(session)
    with pytest.raises(HTTPException) as rejected:
        overrides.apply_proposal(session.id, overrides.ProposalApplyRequest(
            variant="ai", handle=0, preview_token=token, candidate_id="greedy", source_step=0))
    assert rejected.value.status_code == 409
    assert proposal_preview.source_state(session) == before
    assert trainruns_from_env(session.env) is None


@pytest.mark.parametrize("fields", [
    {"handle": 1}, {"candidate_id": "other"}, {"source_step": 1},
    {"source_step": None}, {"priority": [1]}, {"preview_token": "unknown"},
    {"variant": "plan"},
])
def test_token_selection_mismatches_fail_closed(session, fields):
    token = proposal_preview.remember_course(session, proposal_preview.source_state(session), 0, proposal({0: ["never-install"]}))
    values = dict(variant="ai", handle=0, candidate_id="greedy", source_step=0, preview_token=token)
    values.update(fields)
    source = proposal_preview.source_state(session)
    with pytest.raises(HTTPException) as rejected:
        overrides.apply_proposal(session.id, overrides.ProposalApplyRequest(**values))
    assert rejected.value.status_code == 409
    assert proposal_preview.source_state(session) == source


def test_deleted_session_token_is_a_conflict(session):
    token = proposal_preview.remember_course(session, proposal_preview.source_state(session), 0, proposal())
    session_manager.delete(session.id)
    with pytest.raises(HTTPException) as rejected:
        overrides.apply_proposal(session.id, overrides.ProposalApplyRequest(
            variant="ai", handle=0, candidate_id="greedy", source_step=0, preview_token=token))
    assert rejected.value.status_code == 409


def test_done_before_fork_is_not_stranded_and_ranking_is_completion_then_nonnegative_lateness():
    def result(outcomes):
        return SimpleNamespace(agent_outcomes=outcomes)

    already_done = {"arrived": True, "arrival_step": None}
    assert overrides._variant_metrics(result({0: already_done}), {}, 10, 40) == {
        "not_arrived": 0, "lateness": 0, "time_in_network": 0, "stops_missed": 0}
    late = result({0: {"arrived": True, "arrival_step": 5000}})
    stranded = result({0: {"arrived": False, "arrival_step": None}})
    assert overrides.proposal_rank(late, {0: 0}, 0, 5000) < overrides.proposal_rank(stranded, {}, 0, 5000)
    early_and_late = result({0: {"arrived": True, "arrival_step": 1}, 1: {"arrived": True, "arrival_step": 25}})
    assert overrides.proposal_rank(early_and_late, {0: 100, 1: 20}, 0, 40)[1] == 5


@pytest.mark.parametrize("preset", ["tutorial", "uc2-1"])
def test_native_deadline_yardstick_survives_accepting_a_trainrun_plan(preset):
    s = session_manager.create(scenario_preset_id=preset)
    try:
        assert planned_arrival_steps(s.env) == {}
        references = overrides.proposal_arrival_reference(s.env)
        assert references == {a.handle: a.latest_arrival for a in s.env.agents}
        res = SimpleNamespace(agent_outcomes={
            h: {"arrived": True, "arrival_step": deadline + 3} for h, deadline in references.items()})
        assert overrides.proposal_rank(res, references, 0, s.env._max_episode_steps)[1] == 3 * len(s.env.agents)
        replacement = {0: [TrainrunWaypoint(9999, Waypoint(*s.env.agents[0].initial_configuration))]}
        accept_trainrun_plan(s.env, replacement)
        assert planned_arrival_steps(s.env) != references
        assert overrides.proposal_arrival_reference(s.env) == references
    finally:
        session_manager.delete(s.id)


def test_api_accepts_the_exact_selected_alternative_without_calling_resolver(session, monkeypatch):
    from app.main import app

    with TestClient(app) as client:
        client.post(f"/session/{session.id}/step", json={"policy": "deadlock_avoidance", "n_steps": 6})
        runs = rollout_trainruns(session.env)
        delayed = {h: [TrainrunWaypoint(wp.scheduled_at + 2, wp.waypoint) for wp in run] for h, run in runs.items()}
        choices = [proposal(runs, "course-original"), proposal(delayed, "course-wait")]

        def forbidden(*_args, **_kwargs):
            raise AssertionError("Exact preview acceptance must not regenerate a proposal")

        agent = SimpleNamespace(id="uc2_rl", label="UC2 RL", propose_for=lambda *_: choices,
                                resolve_for=forbidden)
        monkeypatch.setattr(overrides, "proposal_agent_for", lambda _: agent)
        session.env._plan_off_plan = {0}  # a previous course must not poison the replacement
        before = proposal_preview.source_state(session)
        response = client.get(f"/session/{session.id}/proposals", params={"handle": 0, "alternatives": 8})
        assert response.status_code == 200, response.text
        payload = response.json()
        assert proposal_preview.source_state(session) == before
        assert session.policy == "deadlock_avoidance"
        assert payload["source_step"] == payload["step"] == 6
        candidates = payload["variants"][1:] + payload["ai_alternatives"]
        chosen = next(v for v in candidates if v["candidate_id"] == "course-wait")
        assert "matches_plan" in chosen and chosen["preview_token"]
        accepted = client.post(f"/session/{session.id}/proposals/apply", json={
            "variant": "ai", "handle": 0, "priority": chosen["priority"],
            "candidate_id": chosen["candidate_id"], "preview_token": chosen["preview_token"],
            "source_step": payload["source_step"],
        })
        assert accepted.status_code == 200, accepted.text
        assert trainruns_from_env(session.env) == delayed
        assert session.env._plan_off_plan == set()
        assert not session._proposal_previews
        for _ in range(40):
            if session.env.dones["__all__"]:
                break
            step = client.post(f"/session/{session.id}/step", json={"policy": "deadlock_avoidance", "n_steps": 1})
            assert step.status_code == 200, step.text
        assert session.policy == "plan"
        assert session.env.agents[0].arrival_time == chosen["train"]["arrival_step"]
        assert sum(a.state.name == "DONE" for a in session.env.agents) == chosen["system"]["done"]


def test_async_forecast_uses_private_root_and_releases_lock_while_worker_is_busy(session, monkeypatch):
    async def exercise():
        entered, release = Event(), Event()
        asgi = get_ident()
        captured_steps = []

        def evaluate(captured):
            assert get_ident() != asgi
            root = captured[0]
            assert root is not session.env
            captured_steps.append(root._elapsed_steps)
            entered.set()
            assert release.wait(3)
            assert root._elapsed_steps == captured_steps[0]
            return {"variants": [], "ai_alternatives": [], "step": captured[4].step}, []

        monkeypatch.setattr(overrides, "_evaluate_proposals", evaluate)
        task = asyncio.create_task(overrides.get_proposals_endpoint(session.id, 0))
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            async with pf_ch_control.command_lock(session):
                session.env._elapsed_steps += 1
            assert not task.done()
            release.set()
            payload = await asyncio.wait_for(task, 3)
            assert payload["step"] == 0 and session.env._elapsed_steps == 1
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(exercise())


def test_uc2_adviser_dla_play_waits_for_source_capture_lock(monkeypatch):
    from tests.test_pf_ch_playback_control import _session

    async def exercise():
        calls = []
        s, state, _ = _session(monkeypatch, "shortest_path", lambda *_: calls.append("inference"))
        s.proposal_agent_id = "uc2_rl"
        async with s.command_lock:
            task = asyncio.create_task(websockets._play_loop(s.id))
            await asyncio.sleep(0)
            assert not task.done() and not calls
            pf_ch_control.request_stop(s)
        try:
            await asyncio.wait_for(task, 3)
            assert not calls
        finally:
            play_manager._states.pop(s.id, None)

    asyncio.run(exercise())


def test_running_plan_driver_reloads_another_accepted_course_even_when_policy_id_stays_plan(monkeypatch):
    from tests.test_pf_ch_playback_control import _session

    async def exercise():
        s, state, _ = _session(monkeypatch, "plan", lambda *_: {})
        s.proposal_agent_id = "uc2_rl"
        first, second = object(), object()
        s.env._trainrun_plan = first
        driven = []

        def build(_policy, env, **_kwargs):
            action = 1 if env._trainrun_plan is first else 3
            actor = SimpleNamespace(reset=lambda _: None, act_many=lambda *_: {0: action})
            return "plan", actor

        def physics(_sid, _session, actions, **_kwargs):
            assert s.command_lock.locked()
            driven.append(actions[0])
            s.env._elapsed_steps += 1
            if s.env._elapsed_steps == 2:
                state.running = False
            return {}, {}, {}, {}

        async def accept_between_steps(_state):
            async with s.command_lock:
                s.env._trainrun_plan = second

        monkeypatch.setattr(websockets, "create_driving_policy", build)
        monkeypatch.setattr(websockets, "step_env", physics)
        monkeypatch.setattr(websockets, "_wait_for_next_step", accept_between_steps)
        try:
            await websockets._play_loop(s.id)
            assert driven == [1, 3]
        finally:
            play_manager._states.pop(s.id, None)

    asyncio.run(exercise())


def test_worker_capacity_is_bounded_and_cancellation_does_not_free_a_running_slot(monkeypatch):
    async def exercise():
        from threading import BoundedSemaphore

        monkeypatch.setattr(proposal_preview, "_SLOTS", BoundedSemaphore(1))
        entered, release, drained = Event(), Event(), Event()

        def work():
            entered.set()
            assert release.wait(3)
            drained.set()

        task = asyncio.create_task(proposal_preview.run_preview_work(work))
        try:
            assert await asyncio.to_thread(entered.wait, 3)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            with pytest.raises(HTTPException) as rejected:
                await proposal_preview.run_preview_work(lambda: None)
            assert rejected.value.status_code == 503
            release.set()
            assert await asyncio.to_thread(drained.wait, 3)
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(exercise())
