"""Bounded, exact proposal acceptance and clone-only forecast work.

Only executable trainruns and a source digest are kept on the session. No
environment or live policy is retained by the preview cache.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
import copy
from dataclasses import dataclass
import hashlib
import pickle
import secrets
from threading import BoundedSemaphore

from fastapi import HTTPException

from app.core.override_manager import override_manager
from app.utils.agent_compat import agent_direction, agent_position

MAX_COURSES_PER_SESSION = 16
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="proposal-preview")
_SLOTS = BoundedSemaphore(4)  # two running and at most two queued jobs


@dataclass(frozen=True)
class PreviewSource:
    env_id: int
    step: int
    generation: int  # the env's num_resets: a reset reuses the env object
    digest: bytes


@dataclass(frozen=True)
class PreviewCourse:
    source: PreviewSource
    handle: int
    candidate_id: str | None
    priority: tuple[int, ...]
    trainruns: dict
    # A course computed for a step ahead (#230):
    # the step it takes over at, the forecast fingerprint of every step from
    # the request to that one, the overrides it was forecast with, and what the
    # preview promised (trains home, deadlocks) for the re-check.
    activation_step: int | None = None
    expected: tuple = ()
    committed: tuple = ()
    arrived: int = 0
    deadlocks: int = 0


def fingerprint(env) -> tuple:
    """What the trains look like at this step: enough to tell whether the live
    run is where a forecast said it would be."""
    rows = []
    for agent in env.agents:
        handle = int(agent.handle)
        position = agent_position(agent)
        direction = agent_direction(agent)
        handler = getattr(agent, "malfunction_handler", None)
        down = int(getattr(handler, "malfunction_down_counter", 0) or 0)
        state = getattr(agent, "state", None)
        rows.append((handle,
                     None if position is None else tuple(int(v) for v in position),
                     None if direction is None else int(direction),
                     None if state is None else int(state), down))
    return tuple(rows)


def committed_snapshot(session) -> tuple:
    return tuple(sorted((int(h), int(a)) for h, a in override_manager.get_all(session.id).items()))


def episode_generation(env) -> int:
    """Counts the env's resets. A reset reuses the env object and restarts the
    step count, so env id and step alone can't tell two episodes apart."""
    return int(getattr(env, "num_resets", 0) or 0)


def same_episode(session, source: PreviewSource) -> bool:
    return id(session.env) == source.env_id and episode_generation(session.env) == source.generation


def source_state(session) -> PreviewSource:
    """Read under the session command lock, including same-step interventions."""
    from app.policies.goal_directed_policy import env_weights, plan_player

    env = session.env
    player = plan_player(env)
    settings = tuple((name, getattr(env, name, None)) for name in (
        "num_resets", "_max_episode_steps", "acceleration_delta", "braking_delta",
        "remove_agents_at_target", "_trainrun_plan", "_baseline_trainrun_plan",
        "_accepted_trainrun_plan", "_plan_off_plan", "_plan_course_routes", "_route_overrides",
        "_route_reference_plan", "_live_seed", "_live_params",
    ))
    payload = (session.policy, getattr(session, "proposal_agent_id", None),
               sorted(override_manager.get_all(session.id).items()),
               env.agents, getattr(env, "dones", None), settings,
               env.rail.grid.tobytes(), sorted(env.resource_map.level_free_positions),
               env_weights(env), player.snapshot() if player is not None else None)
    digest = hashlib.sha256(pickle.dumps(payload, protocol=5)).digest()
    return PreviewSource(id(env), int(env._elapsed_steps), episode_generation(env), digest)


def remember_course(session, source: PreviewSource, handle: int, proposal, lead: dict | None = None) -> str:
    cache = getattr(session, "_proposal_previews", None)
    if cache is None:
        cache = session._proposal_previews = OrderedDict()
    token = secrets.token_urlsafe(24)
    cache[token] = PreviewCourse(source, handle, proposal.candidate_id,
                                 tuple(proposal.priority), copy.deepcopy(proposal.trainruns),
                                 **(lead or {}))
    while len(cache) > MAX_COURSES_PER_SESSION:
        cache.popitem(last=False)
    return token


def exact_course(session, token: str, *, handle: int, candidate_id: str | None,
                 source_step: int | None, priority: list[int] | None) -> dict:
    cache = getattr(session, "_proposal_previews", {})
    course = cache.get(token)
    if (course is None or source_step != course.source.step or handle != course.handle
            or candidate_id != course.candidate_id
            or tuple(priority or ()) != course.priority
            or source_state(session) != course.source):
        raise HTTPException(409, "This proposal preview is stale or no longer matches; load proposals again")
    return copy.deepcopy(course.trainruns)


def lead_course(session, token: str, *, handle: int, candidate_id: str | None,
                source_step: int | None, priority: list[int] | None) -> PreviewCourse | None:
    """The remembered course behind `token` if it was computed for a step
    ahead; None for an exact (same-step) course. Ids must match either way."""
    course = getattr(session, "_proposal_previews", {}).get(token)
    if course is None or course.activation_step is None:
        return None
    if (source_step != course.source.step or handle != course.handle
            or candidate_id != course.candidate_id
            or tuple(priority or ()) != course.priority
            or not same_episode(session, course.source)):
        raise HTTPException(409, "This proposal preview is stale or no longer matches; load proposals again")
    return course


def matches_forecast(session, course: PreviewCourse) -> bool:
    """The live run is where the course's forecast put it at this step, with the
    overrides it was forecast with."""
    step = int(getattr(session.env, "_elapsed_steps", 0) or 0)
    expected = dict(course.expected).get(step)
    return (expected is not None and expected == fingerprint(session.env)
            and course.committed == committed_snapshot(session))


def pending_course(session) -> PreviewCourse | None:
    return getattr(session, "_pending_course", None)


def set_pending(session, course: PreviewCourse) -> None:
    session._pending_course = course


def clear_pending(session, handle: int | None = None) -> None:
    """Drop the pending course (only if it is for `handle`, when given)."""
    course = pending_course(session)
    if course is not None and (handle is None or course.handle == int(handle)):
        session._pending_course = None


def course_state(session) -> dict:
    """The state payload's view of a KI course accepted for a step ahead:
    the one still waiting, and how the last one went when its step came."""
    course = pending_course(session)
    return {
        "pending_course": None if course is None else {
            "handle": course.handle, "activation_step": course.activation_step},
        "course_activation": getattr(session, "_course_activation", None),
    }


def clear_previews(session) -> None:
    getattr(session, "_proposal_previews", {}).clear()
    clear_pending(session)


async def run_preview_work(work):
    """Do not queue unlimited forecasts, nor free a cancelled running slot early."""
    slots = _SLOTS
    if not slots.acquire(blocking=False):
        raise HTTPException(503, "Proposal previews are busy; try again shortly")

    def run():
        try:
            return work()
        finally:
            slots.release()

    try:
        worker = asyncio.get_running_loop().run_in_executor(_POOL, run)
    except BaseException:
        slots.release()
        raise
    # Cancellation drops the response, while the bounded worker completes on
    # its private root. Consume its exception without caching an unseen course.
    worker.add_done_callback(lambda done: None if done.cancelled() else done.exception())
    return await asyncio.shield(worker)
