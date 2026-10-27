"""MARL lab endpoints (docs/plans/marl-lab-plan.md, step 4).

Only meaningful in a session that runs a learned policy; elsewhere they answer
`available: false` rather than an error, so the HMI can ask unconditionally.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core import lab_session, lab_training
from app.core.online_learning.manager import manager as online_manager
from app.core.session_manager import session_manager

router = APIRouter()
#: Routes that are not under /session/{id} (mounted without a prefix).
jobs_router = APIRouter()
# The online learner is not tied to a session; main.py mounts this one at the root.
online_router = APIRouter()


def _session(session_id: str):
    session = session_manager.get(session_id)
    if not session:
        raise HTTPException(404, f"Session {session_id} not found")
    return session


@router.get("/{session_id}/lab/ai-choice/{handle}")
def get_ai_choice(session_id: str, handle: int,
                  evaluation_policy: Optional[str] = Query(None, alias="evaluationPolicy")) -> dict:
    """What a learned policy would do at this train's next decision point."""
    session = _session(session_id)
    if handle < 0 or handle >= len(session.env.agents):
        raise HTTPException(404, f"Agent {handle} not found")
    return lab_session.ai_choice(session_id, session, handle, evaluation_policy_id=evaluation_policy)


@router.get("/{session_id}/lab/ai-choices")
def get_ai_choices(
    session_id: str,
    evaluation_policy: Optional[str] = Query(None, alias="evaluationPolicy"),
) -> dict[int, dict]:
    """Return all trains' choices from one shared forecast."""
    session = _session(session_id)
    return lab_session.ai_choices(session_id, session, evaluation_policy_id=evaluation_policy)


@router.get("/{session_id}/lab/review")
def get_review(session_id: str, outcomes: bool = Query(True)) -> dict:
    """The AI Track Record: interventions, agreement, rate, strategy choices and
    the outcome with you against AI alone and the previous checkpoint."""
    return lab_session.review(session_id, _session(session_id), outcomes=outcomes)


# ── training from the browser (docs/plans/marl-lab-tour.md) ────────────

class TrainRequest(BaseModel):
    klWeight: float = Field(lab_training.DEFAULT_KL_WEIGHT, description="How much the AI stays as it was")


@router.get("/{session_id}/lab/train")
def get_training(session_id: str) -> dict:
    """Whether this session can train the AI, from which policy, on which
    interventions, and the jobs it has started."""
    return lab_training.status(session_id, _session(session_id))


@router.post("/{session_id}/lab/train", status_code=202)
def start_training(session_id: str, req: TrainRequest) -> dict:
    """Fine-tune the session's learned policy on this session's human
    interventions; poll `GET /lab/jobs/{jobId}`."""
    try:
        return lab_training.start(session_id, _session(session_id), req.klWeight)
    except lab_training.TrainingError as exc:
        raise HTTPException(exc.code, exc.reason)


@jobs_router.get("/lab/jobs/{job_id}")
def get_training_job(job_id: str) -> dict:
    found = lab_training.job(job_id)
    if found is None:
        raise HTTPException(404, f"Job {job_id} not found")
    return found


# ── online learning (docs/plans/online-ppo-learning.md) ─────────────────
# Paths without a session id: the learner is one per backend, a policy among
# equals that any session can pick as `lab:online-ppo`.

class OnlineStartRequest(BaseModel):
    init: Optional[str] = None
    config: Optional[dict] = None


class OnlineSettingsRequest(BaseModel):
    learning_sources: dict[str, bool]
    comparison_policies: Optional[list[str]] = None


class OnlineFeedbackRequest(BaseModel):
    session_id: str
    handle: int
    step: int = 0
    mode: Optional[str] = None
    feedback: str


@online_router.get("/lab/online/status")
def online_status() -> dict:
    return online_manager.status()


@online_router.post("/lab/online/settings")
def online_settings(req: OnlineSettingsRequest) -> dict:
    try:
        return online_manager.update_settings(
            learning_sources=req.learning_sources,
            comparison_policies=req.comparison_policies,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))


@online_router.post("/lab/online/reset")
def online_reset() -> dict:
    try:
        return online_manager.reset_to_scratch()
    except RuntimeError as e:
        raise HTTPException(409, str(e))


@online_router.post("/lab/online/start")
def online_start(req: OnlineStartRequest) -> dict:
    try:
        if req.init is None and req.config is None:
            return online_manager.autostart()
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
