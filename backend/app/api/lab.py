"""MARL lab endpoints (docs/plans/marl-lab-plan.md, step 4).

Only meaningful in a session that runs a learned policy; elsewhere they answer
`available: false` rather than an error, so the HMI can ask unconditionally.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.core import lab_session
from app.core.online_learning.manager import manager as online_manager
from app.core.session_manager import session_manager

router = APIRouter()
# The online learner is not tied to a session; main.py mounts this one at the root.
online_router = APIRouter()


def _session(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")
    return session


@router.get("/{session_id}/lab/ai-choice/{handle}")
def get_ai_choice(session_id: str, handle: int) -> dict:
    """What the learned policy will do at this train's next decision point."""
    session = _session(session_id)
    if handle < 0 or handle >= len(session.env.agents):
        raise HTTPException(404, f"Agent {handle} not found")
    return lab_session.ai_choice(session_id, session, handle)


@router.get("/{session_id}/lab/review")
def get_review(session_id: str, outcomes: bool = Query(True)) -> dict:
    """The AI Track Record: interventions, agreement, rate, strategy choices and
    the outcome with you against AI alone and the previous checkpoint."""
    return lab_session.review(session_id, _session(session_id), outcomes=outcomes)


# ── online learning (docs/plans/online-ppo-learning.md) ─────────────────
# Paths without a session id: the learner is one per backend, a policy among
# equals that any session can pick as `lab:online-ppo`.

class OnlineStartRequest(BaseModel):
    init: str = "scratch"
    config: Optional[dict] = None


class OnlineFeedbackRequest(BaseModel):
    session_id: str
    handle: int
    step: int = 0
    mode: Optional[str] = None
    feedback: str


@online_router.get("/lab/online/status")
def online_status() -> dict:
    return online_manager.status()


@online_router.post("/lab/online/start")
def online_start(req: OnlineStartRequest) -> dict:
    try:
        return online_manager.start({**(req.config or {}), "init": req.init})
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@online_router.post("/lab/online/pause")
def online_pause() -> dict:
    try:
        return online_manager.pause()
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@online_router.post("/lab/online/resume")
def online_resume() -> dict:
    try:
        return online_manager.resume()
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@online_router.post("/lab/online/stop")
def online_stop() -> dict:
    return online_manager.stop()


@online_router.get("/lab/online/audit")
def online_audit(limit: int = Query(200, ge=1, le=2000)) -> list[dict]:
    return online_manager.audit(limit)


@online_router.post("/lab/online/feedback")
def online_feedback(req: OnlineFeedbackRequest) -> dict:
    """Explicit feedback on a decision. Recorded; gives no reward by itself."""
    return {"recorded": online_manager.note_feedback(req.model_dump())}
