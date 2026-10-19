"""Study record sink — interaction logging P4 (`docs/plans/interaction-logging-plan.md` §4.6).

The frontend assembles one self-describing record per session and keeps it in
`localStorage`; this router mirrors it to disk so the data does not depend on
one browser profile. The frontend stays the source of truth: a record is
stored as sent, one file per session, and every later PUT for the same session
replaces the file (the record only grows).

Off by default (`STUDY_SINK_ENABLED`). Reading back needs `STUDY_ADMIN_TOKEN`.
"""

import json
import os
import re
import secrets
import tempfile
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Header, HTTPException, Request

from app import __version__
from app.config import settings

router = APIRouter()

RECORD_SCHEMA = "flatland-session-record"
_SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


def records_dir() -> Path:
    path = Path(settings.study_records_dir)
    return path if path.is_absolute() else _BACKEND_DIR / path


def _record_path(session_id: str) -> Path:
    if not _SESSION_ID.match(session_id):
        raise HTTPException(status_code=400, detail="invalid session id")
    return records_dir() / f"{session_id}.json"


def _require_reader(token: Optional[str]) -> None:
    expected = settings.study_admin_token
    if not expected:
        raise HTTPException(status_code=403, detail="reading study records over HTTP is disabled")
    if not token or not secrets.compare_digest(token, expected):
        raise HTTPException(status_code=401, detail="invalid study token")


@router.get("/study/status")
def study_status() -> dict[str, Any]:
    """Whether the sink accepts records, and the backend version for the record header."""
    return {"sinkEnabled": settings.study_sink_enabled, "backendVersion": __version__}


@router.put("/study/records/{session_id}")
async def put_record(session_id: str, request: Request) -> dict[str, Any]:
    if not settings.study_sink_enabled:
        raise HTTPException(status_code=403, detail="study record sink is disabled")
    path = _record_path(session_id)

    body = await request.body()
    if len(body) > settings.study_record_max_bytes:
        raise HTTPException(status_code=413, detail="record too large")
    try:
        record = json.loads(body)
    except ValueError:
        raise HTTPException(status_code=400, detail="record is not JSON")
    if not isinstance(record, dict) or record.get("schema") != RECORD_SCHEMA:
        raise HTTPException(status_code=422, detail=f"expected schema '{RECORD_SCHEMA}'")
    header = record.get("header")
    if not isinstance(header, dict) or header.get("sessionId") != session_id:
        raise HTTPException(status_code=422, detail="header.sessionId does not match the path")

    folder = records_dir()
    folder.mkdir(parents=True, exist_ok=True)
    if not path.exists() and sum(1 for _ in folder.glob("*.json")) >= settings.study_records_max_files:
        raise HTTPException(status_code=507, detail="record store is full")

    # Write-then-rename: a crash mid-write never leaves a truncated record.
    fd, tmp = tempfile.mkstemp(dir=folder, prefix=f".{session_id}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(body)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return {"stored": True, "sessionId": session_id, "bytes": len(body)}


@router.get("/study/records")
def list_records(x_study_token: Optional[str] = Header(default=None)) -> list[dict[str, Any]]:
    _require_reader(x_study_token)
    out: list[dict[str, Any]] = []
    folder = records_dir()
    if not folder.is_dir():
        return out
    for path in sorted(folder.glob("*.json")):
        try:
            header = json.loads(path.read_text(encoding="utf-8")).get("header") or {}
        except (OSError, ValueError):
            continue
        out.append(
            {
                "sessionId": header.get("sessionId", path.stem),
                "participantId": header.get("participantId"),
                "conditionId": header.get("conditionId"),
                "runIndex": header.get("runIndex"),
                "startedAt": header.get("startedAt"),
                "endedAt": header.get("endedAt"),
                "bytes": path.stat().st_size,
            }
        )
    return sorted(out, key=lambda r: r.get("startedAt") or 0, reverse=True)


@router.get("/study/records/{session_id}")
def get_record(session_id: str, x_study_token: Optional[str] = Header(default=None)) -> Any:
    _require_reader(x_study_token)
    path = _record_path(session_id)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="no record for this session")
    return json.loads(path.read_text(encoding="utf-8"))
