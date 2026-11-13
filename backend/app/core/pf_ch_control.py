"""Specialist actor inference transactions; no training dispatcher runtime.

Only the model forward pass runs in a worker. Features, overrides and physics
stay on ASGI. Mutations wait for that proposal; read-only forecasts remain free.
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
import re

from fastapi import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.play_manager import play_manager
from app.core.session_manager import session_manager
from app.core.ws_manager import ws_manager
from app.policies.learned import pf_ch_bundle, uc2_bundle

_SPECIALIST_BUNDLES = {bundle.POLICY_ID: bundle for bundle in (pf_ch_bundle, uc2_bundle)}


def is_specialist_policy(policy_id: str | None) -> bool:
    """Keep both bounded neural drivers on the existing inference lifecycle."""
    return policy_id in _SPECIALIST_BUNDLES

# Small networks do not need one thread per core/session. This bounds active
# inference workers, while all sessions share one frozen model object.
_INFERENCE_POOL = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pf-ch-inference")


def command_lock(session) -> asyncio.Lock:
    lock = getattr(session, "_pf_ch_command_lock", None)
    if lock is None:
        lock = session._pf_ch_command_lock = asyncio.Lock()
    return lock


def preflight_policy(env, policy_id: str) -> None:
    bundle = _SPECIALIST_BUNDLES.get(policy_id)
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


async def _requested_policy(request, path: str, session) -> str | None:
    if request.method != "POST" or path not in {"/policy", "/play", "/step"}:
        return None
    media = request.headers.get("content-type", "application/json").split(";")[0].strip().lower()
    if media != "application/json" and not (media.startswith("application/") and media.endswith("+json")):
        return None
    try:
        if path == "/policy":
            from app.api.sessions import PolicyChangeRequest
            requested = PolicyChangeRequest.model_validate_json(await request.body()).policy
        elif path == "/play":
            from app.api.websockets import PlayRequest
            requested = PlayRequest.model_validate_json(await request.body()).policy
        else:
            from app.models.session import StepRequest
            requested = StepRequest.model_validate_json(await request.body()).policy
        if requested not in session.enabled_policy_ids:
            return None
        preflight_policy(session.env, requested)
        return requested
    except (ValueError, TypeError, HTTPException):
        # Invalid/disabled/incompatible requests must not stop the running actor.
        return None


class PFChControlMiddleware(BaseHTTPMiddleware):
    """Serialise only mutations involving a bounded specialist actor."""

    async def dispatch(self, request, call_next):
        match = re.match(r"^/session/([^/]+)(/.*)?$", request.url.path)
        session = session_manager.get(match[1]) if match else None
        if session is None or request.method in {"GET", "HEAD", "OPTIONS"}:
            return await call_next(request)
        path = match[2] or ""
        if request.method == "POST" and path in {"/what-if-override", "/director/whatif", "/director/verify"}:
            return await call_next(request)
        previous = play_manager.get(session.id)
        requested = await _requested_policy(request, path, session)
        if not any(is_specialist_policy(policy) for policy in
                   (session.policy, getattr(previous, "policy", None), requested)):
            return await call_next(request)
        actor_change = (requested is not None and previous is not None
                        and requested != previous.policy
                        and any(is_specialist_policy(policy) for policy in (requested, previous.policy)))
        destructive = ((request.method == "DELETE" and path == "")
                       or (request.method == "POST" and path == "/reset"))
        should_stop = destructive or actor_change or (request.method == "POST" and path == "/pause")
        if should_stop:
            # Signal before waiting for inference; its proposal must be discarded.
            request_stop(session)
            await broadcast_playback(session)
        async with command_lock(session):
            if destructive or (actor_change and path == "/policy"):
                await play_manager.stop(session.id)
            return await call_next(request)
