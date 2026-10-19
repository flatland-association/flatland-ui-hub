"""MARL lab endpoints (docs/plans/marl-lab-plan.md, step 4).

Only meaningful in a session that runs a learned policy; elsewhere they answer
`available: false` rather than an error, so the HMI can ask unconditionally.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core import lab_session
from app.core.session_manager import session_manager

router = APIRouter()


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
