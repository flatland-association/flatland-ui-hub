"""Graph env playground API (docs/plans/graph-env-playground.md §3): the static network, and one live GraphRailEnv
per page load, stepped on demand.

Mounted under `/graph-env-api`, not `/graph-env`: that is the page's path, and the dev server's proxy matches by
prefix.
"""
from functools import lru_cache
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.graph_env.network import load_network
from app.graph_env.projection import network_json, state_json
from app.graph_env.service import GraphEnvSession, sessions

router = APIRouter()

MAX_STEPS_PER_REQUEST = 10_000


@lru_cache(maxsize=1)
def _network() -> dict[str, Any]:
    return network_json(load_network())


def _state(session: GraphEnvSession) -> dict[str, Any]:
    with session.lock:
        return state_json(session.env, session.policy, session.done)


@router.get("/network")
def get_network() -> dict[str, Any]:
    """Tracks (one polyline per track), track nodes and bounds - static."""
    return _network()


@router.post("/sessions")
def create_session() -> dict[str, Any]:
    """A new env, reset - the page calls this on every load."""
    session = sessions.create()
    return {"id": session.id, "state": _state(session)}


@router.post("/sessions/{session_id}/step")
def step_session(session_id: str, n: int = Query(1, ge=1, le=MAX_STEPS_PER_REQUEST)) -> dict[str, Any]:
    """Advance the session's env by up to `n` steps (fewer once the episode is done) and return its state."""
    try:
        session = sessions.get(session_id)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"unknown graph env session {session_id}")
    session.step(n)
    return _state(session)
