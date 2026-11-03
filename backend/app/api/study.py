"""Study record sink — interaction logging P4 (`docs/plans/interaction-logging-plan.md` §4.6).

The frontend assembles one self-describing record per session and keeps it in
`localStorage`; this router mirrors it to disk so the data does not depend on
one browser profile. The frontend stays the source of truth: a record is
stored as sent, as `record.json` in the session's folder
(`<run>/<started>_<sid>/`, app.core.study_paths), and every later PUT for the
same session replaces the file (the record only grows). Records written before
the folder layout (flat `<sid>.json`) are still listed and read, not moved.

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
from app.core.study_paths import count_records, find_session_dir, records_dir, session_dir, session_dir_from_header

router = APIRouter()

RECORD_SCHEMA = "flatland-session-record"
_SESSION_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
RECORD_FILE = "record.json"


def _check_id(session_id: str) -> None:
    if not _SESSION_ID.match(session_id):
        raise HTTPException(status_code=400, detail="invalid session id")


def _existing_record(session_id: str) -> Optional[Path]:
    """The stored record: in its session folder, else an old flat `<sid>.json`."""
    folder = find_session_dir(session_id)
    if folder is not None and (folder / RECORD_FILE).is_file():
        return folder / RECORD_FILE
    flat = records_dir() / f"{session_id}.json"
    return flat if flat.is_file() else None


def _target_path(session_id: str, header: dict) -> Path:
    """Where a PUT writes: the live session's folder, an existing folder after a
    restart, else a folder built from the record's own header."""
    from app.core.session_manager import session_manager  # lazy: keeps this router Flatland-free to import

    session = session_manager.get(session_id)
    if session is not None:
        return session_dir(session) / RECORD_FILE
    folder = find_session_dir(session_id)
    if folder is not None:
        return folder / RECORD_FILE
    return session_dir_from_header(header) / RECORD_FILE


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
    _check_id(session_id)

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

    path = _target_path(session_id, header)
    if not path.exists() and count_records() >= settings.study_records_max_files:
        raise HTTPException(status_code=507, detail="record store is full")
    folder = path.parent
    folder.mkdir(parents=True, exist_ok=True)

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
    for path in sorted([*folder.glob("*/*/record.json"), *folder.glob("*.json")]):
        try:
            header = json.loads(path.read_text(encoding="utf-8")).get("header") or {}
        except (OSError, ValueError):
            continue
        out.append(
            {
                "sessionId": header.get("sessionId", path.stem),
                "experimentRunId": header.get("experimentRunId"),
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
    _check_id(session_id)
    path = _existing_record(session_id)
    if path is None:
        raise HTTPException(status_code=404, detail="no record for this session")
    return json.loads(path.read_text(encoding="utf-8"))
