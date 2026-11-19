"""Specialist actor inference transactions; no training dispatcher runtime.

Only the model forward pass runs in a worker. Features, overrides and physics
stay on ASGI. Mutations wait for that proposal; read-only forecasts remain free.
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
import re

from fastapi import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.play_manager import play_manager
from app.core.session_manager import session_manager
from app.core.ws_manager import ws_manager
from app.policies.registry import get_policy_spec, is_specialist_policy

__all__ = ["is_specialist_policy"]


def requires_command_lock(session, policy_id: str | None = None) -> bool:
    """RL advisers snapshot/apply against ordinary Drivers under the same lock."""
    return (getattr(session, "proposal_agent_id", None) == "uc2_rl"
            or is_specialist_policy(policy_id or getattr(session, "policy", None)))

# Small networks do not need one thread per core/session. This bounds active
# inference workers, while all sessions share one frozen model object.
_INFERENCE_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pf-ch-inference")


def command_lock(session) -> asyncio.Lock:
    lock = getattr(session, "_pf_ch_command_lock", None)
    if lock is None:
        lock = session._pf_ch_command_lock = asyncio.Lock()
    return lock


def preflight_policy(env, policy_id: str) -> None:
    spec = get_policy_spec(policy_id)
    bundle = spec.bundle if spec is not None else None
    if bundle is None:
        return
    error = bundle.compatibility_error(env)
    if error is not None:
        raise HTTPException(400, error)
    try:
        bundle.verify_bundle()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


async def broadcast_playback(session) -> None:
    await ws_manager.broadcast(session.id, {
        "type": "play_status", "session_id": session.id,
        "playing": play_manager.is_playing(session.id),
        "busy": bool(getattr(session, "_pf_ch_busy", False)),
    })


def request_stop(session) -> None:
    state = play_manager.get(session.id)
    if state is not None:
        state.running = False


async def run_inference(session, work):
    """Keep the caller's transaction until cancelled model work has drained."""
    session._pf_ch_busy = True
    worker = None
    try:
        await broadcast_playback(session)
        worker = asyncio.get_running_loop().run_in_executor(_INFERENCE_POOL, work)
        return await asyncio.shield(worker)
    except asyncio.CancelledError:
        request_stop(session)
        if worker is not None:
            while not worker.done():
                try:
                    await asyncio.shield(worker)
                except asyncio.CancelledError:
                    continue
            worker.result()
        raise
    finally:
        session._pf_ch_busy = False
        await broadcast_playback(session)


def _involves_specialist(session, requested: str | None = None) -> bool:
    previous = play_manager.get(session.id)
    return requires_command_lock(session) or any(is_specialist_policy(policy) for policy in (
        session.policy, getattr(previous, "policy", None), requested))


@asynccontextmanager
async def actor_transaction(session, requested: str):
    """The transaction of a request that may switch the actor (`/play`, `/step`,
    `/policy`), entered once the request is validated.

    When the requested policy changes a running specialist actor (to or from
    one), the old actor is signalled to stop *before* the wait for the command
    lock, so the inference in flight drops its actions instead of applying them
    after the switch. Yields whether the actor changes; the endpoint stops the
    old play loop under the lock if it has to. Sessions without a specialist
    pass without a lock, as before.
    """
    if not _involves_specialist(session, requested):
        yield False
        return
    previous = play_manager.get(session.id)
    actor_change = (previous is not None and requested != previous.policy
                    and any(is_specialist_policy(policy) for policy in (requested, previous.policy)))
    if actor_change:
        request_stop(session)
        await broadcast_playback(session)
    async with command_lock(session):
        yield actor_change


class PFChControlMiddleware(BaseHTTPMiddleware):
    """Serialise only mutations involving a bounded specialist actor.

    It never reads a request body: the requests that may switch the actor
    (`/play`, `/step`, `/policy`) own their transaction (`actor_transaction`),
    with the policy FastAPI validated for them.
    """

    async def dispatch(self, request, call_next):
        match = re.match(r"^/session/([^/]+)(/.*)?$", request.url.path)
        session = session_manager.get(match[1]) if match else None
        if session is None or request.method in {"GET", "HEAD", "OPTIONS"}:
            return await call_next(request)
        path = match[2] or ""
        if request.method == "POST" and path == "/proposals/apply":
            # Its async endpoint owns capture validation + install as one lock
            # transaction. Acquiring here as well would deadlock that endpoint.
            return await call_next(request)
        if request.method == "POST" and path in {"/what-if-override", "/director/whatif", "/director/verify"}:
            return await call_next(request)
        if request.method == "POST" and path in {"/play", "/step", "/policy"}:
            # Their endpoints own the transaction (`actor_transaction`).
            return await call_next(request)
        if not _involves_specialist(session):
            return await call_next(request)
        destructive = ((request.method == "DELETE" and path == "")
                       or (request.method == "POST" and path == "/reset"))
        if destructive or (request.method == "POST" and path == "/pause"):
            # Signal before waiting for inference; its proposal must be discarded.
            request_stop(session)
            await broadcast_playback(session)
        async with command_lock(session):
            if destructive:
                await play_manager.stop(session.id)
            if destructive:
                from app.core.proposal_preview import clear_previews
                clear_previews(session)
            return await call_next(request)
