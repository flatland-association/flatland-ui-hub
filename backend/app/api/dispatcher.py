"""Synthetic operator ownership and export; reads never drive the runtime."""
import re
from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.dispatcher import DEMO_SETUP, PREPARED_DEMOS, PROFILES, export_run
from app.core.dispatcher_driver import broadcast_playback, request_stop
from app.core.play_manager import play_manager
from app.core.session_manager import session_manager

router = APIRouter()


def _session(session_id):
    session = session_manager.get(session_id)
    if not session or not getattr(session, "dispatcher", None):
        raise HTTPException(404, "No synthetic dispatcher in this session")
    return session


@router.get("/dispatcher/profiles")
def profiles():
    return PROFILES


@router.get("/dispatcher/demo")
def demo():
    """An existing authored scenario, explicitly selected for synthetic tests."""
    return DEMO_SETUP


@router.get("/dispatcher/demos")
def prepared_demos():
    """Complete launch recipes; the dispatcher still observes only live HMI data."""
    return PREPARED_DEMOS


@router.get("/session/{session_id}/dispatcher")
def state(session_id: str):
    session = _session(session_id)
    return session.dispatcher.snapshot(session)


class OwnershipRequest(BaseModel):
    owner: Literal["human", "synthetic"]


async def _broadcast(session):
    from app.api.sessions import _broadcast_state
    await _broadcast_state(session.id, session.env)


@router.post("/session/{session_id}/dispatcher/ownership")
async def ownership(session_id: str, body: OwnershipRequest):
    session = _session(session_id)
    if body.owner == "human":
        await play_manager.stop(session_id)
        session.dispatcher.invalidate(session, "takeover", human=True)
    elif body.owner == "synthetic":
        session.dispatcher.hand_back(session)
    await _broadcast(session)
    return session.dispatcher.snapshot(session)


class DecisionRequest(BaseModel):
    command_id: str
    generation: int
    decision: Literal["approve", "decline"]


@router.post("/session/{session_id}/dispatcher/decision")
async def decision(session_id: str, body: DecisionRequest):
    session = _session(session_id)
    session.dispatcher.decide(session, body.command_id, body.generation, body.decision)
    await _broadcast(session)
    return session.dispatcher.snapshot(session)


class StopRequest(BaseModel):
    reason: Literal["stop", "mode_change", "restart"] = "stop"


@router.post("/session/{session_id}/dispatcher/stop")
async def stop(session_id: str, body: StopRequest | None = None):
    session = _session(session_id)
    await play_manager.stop(session_id)
    reason = body.reason if body else "stop"
    session.dispatcher.invalidate(session, reason, human=True)
    if session.dispatcher.run_status not in {"aborted", "error", "finished"}:
        session.dispatcher.run_status = "aborted"
        session.dispatcher.abort_reason = reason
    await _broadcast(session)
    return session.dispatcher.snapshot(session)


@router.get("/session/{session_id}/dispatcher/export")
def export(session_id: str):
    return export_run(_session(session_id))


class DispatcherControlMiddleware(BaseHTTPMiddleware):
    """Serialize synthetic-session requests with the single backend Play loop.

    Unchanged human sessions bypass this seam. POST previews are read-only;
    all other manual domain mutations require takeover. No browser owns a loop.
    """

    async def dispatch(self, request, call_next):
        match = re.match(r"^/session/([^/]+)(/.*)?$", request.url.path)
        session = session_manager.get(match[1]) if match else None
        if not session or not getattr(session, "dispatcher", None):
            return await call_next(request)
        path = match[2] or ""
        run_control = {"/step", "/play", "/pause", "/reset", "/dispatcher/ownership", "/dispatcher/stop", "/dispatcher/decision"}
        previews = {"/what-if-override", "/director/whatif", "/director/verify"}
        if request.method in ("GET", "HEAD") and path in {"/director/progress", "/play_status"}:
            return await call_next(request)
        if request.method not in ("GET", "HEAD", "OPTIONS") and (
                path in {"/pause", "/reset", "/dispatcher/ownership", "/dispatcher/stop"} or request.method == "DELETE"):
            request_stop(session)
            await broadcast_playback(session)
        async with session.command_lock:
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                if path not in run_control | previews and session.dispatcher.owner == "synthetic" and request.method != "DELETE":
                    return JSONResponse(status_code=409, content={"detail": {"reason": "dispatcher_owns_role", "action": "take_over_first"}})
                if request.method == "DELETE" or path == "/reset":
                    await play_manager.stop(session.id)
            response = await call_next(request)
            if request.method not in ("GET", "HEAD", "OPTIONS") and path not in run_control | previews:
                session.dispatcher.event(session, "human_command", source="human", path=path, http_status=response.status_code)
            return response
