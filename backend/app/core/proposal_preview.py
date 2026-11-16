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

MAX_COURSES_PER_SESSION = 16
_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="proposal-preview")
_SLOTS = BoundedSemaphore(4)  # two running and at most two queued jobs


@dataclass(frozen=True)
class PreviewSource:
    env_id: int
    step: int
    digest: bytes


@dataclass(frozen=True)
class PreviewCourse:
    source: PreviewSource
    handle: int
    candidate_id: str | None
    priority: tuple[int, ...]
    trainruns: dict


def source_state(session) -> PreviewSource:
    """Read under the session command lock, including same-step interventions."""
    from app.policies.goal_directed_policy import env_weights, plan_player

    env = session.env
    player = plan_player(env)
    settings = tuple((name, getattr(env, name, None)) for name in (
        "num_resets", "_max_episode_steps", "acceleration_delta", "braking_delta",
        "remove_agents_at_target", "_trainrun_plan", "_baseline_trainrun_plan",
        "_accepted_trainrun_plan", "_plan_off_plan", "_route_overrides",
        "_route_reference_plan", "_live_seed", "_live_params",
    ))
    payload = (session.policy, getattr(session, "proposal_agent_id", None),
               sorted(override_manager.get_all(session.id).items()),
               env.agents, getattr(env, "dones", None), settings,
               env.rail.grid.tobytes(), sorted(env.resource_map.level_free_positions),
               env_weights(env), player.snapshot() if player is not None else None)
    digest = hashlib.sha256(pickle.dumps(payload, protocol=5)).digest()
    return PreviewSource(id(env), int(env._elapsed_steps), digest)


def remember_course(session, source: PreviewSource, handle: int, proposal) -> str:
    cache = getattr(session, "_proposal_previews", None)
    if cache is None:
        cache = session._proposal_previews = OrderedDict()
    token = secrets.token_urlsafe(24)
    cache[token] = PreviewCourse(source, handle, proposal.candidate_id,
                                 tuple(proposal.priority), copy.deepcopy(proposal.trainruns))
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


def clear_previews(session) -> None:
    getattr(session, "_proposal_previews", {}).clear()


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
