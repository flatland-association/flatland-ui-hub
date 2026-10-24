"""MARL lab endpoints (docs/plans/marl-lab-plan.md, step 4).

Only meaningful in a session that runs a learned policy; elsewhere they answer
`available: false` rather than an error, so the HMI can ask unconditionally.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.core import lab_session, lab_training
from app.core.session_manager import session_manager

router = APIRouter()
#: Routes that are not under /session/{id} (mounted without a prefix).
jobs_router = APIRouter()


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
