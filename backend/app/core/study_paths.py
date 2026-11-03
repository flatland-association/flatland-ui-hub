"""Where a session's study files live (docs/plans/experiment-logging-frontend-and-replay.md §4.2).

One folder per run, one subfolder per backend session, the same depth for
every kind of run:

    data/study-records/
      <start>_<conditionId>_<runId>/<started>_<sid>/   guided condition
      <start>_tour-<tourId>_<runId>/<started>_<sid>/   tour
      <start>_free_<sid>/<started>_<sid>/              free session (a run of one)

Times are UTC, written for people: `2026-10-29_08-03-12Z` (no `:`, so the
names work on Windows and still sort by time). Kept free of Flatland imports
so the study router and its tests stay light.
"""

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from app.config import settings

_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent
_UNSAFE = re.compile(r"[^A-Za-z0-9_-]+")


def records_dir() -> Path:
    path = Path(settings.study_records_dir)
    return path if path.is_absolute() else _BACKEND_DIR / path


def stamp(moment: datetime) -> str:
    """`2026-10-29_08-03-12Z` for an aware or naive-UTC datetime."""
    if moment.tzinfo is not None:
        moment = moment.astimezone(timezone.utc)
    return moment.strftime("%Y-%m-%d_%H-%M-%SZ")


def stamp_ms(epoch_ms: float) -> str:
    return stamp(datetime.fromtimestamp(epoch_ms / 1000, tz=timezone.utc))


def clean(value: Any, fallback: str) -> str:
    """An id reduced to `[A-Za-z0-9_-]`, as the run file name does (`filePart`)."""
    cleaned = _UNSAFE.sub("-", str(value or "").strip()).strip("-")
    return cleaned or fallback


def run_folder_name(run: Optional[dict], session_id: str, session_started: datetime) -> str:
    """`<start>_<what>_<id>`: a condition or tour run, else a free session."""
    if run and run.get("run_id") and run.get("id"):
        started = run.get("run_started_at")
        start = stamp_ms(started) if isinstance(started, (int, float)) and started > 0 else stamp(session_started)
        what = clean(run["id"], "condition")
        if run.get("kind") == "tour":
            what = f"tour-{what}"
        return f"{start}_{what}_{clean(run['run_id'], 'run')}"
    return f"{stamp(session_started)}_free_{clean(session_id, 'session')}"


def session_folder_name(session_id: str, session_started: datetime) -> str:
    return f"{stamp(session_started)}_{clean(session_id, 'session')}"


def session_dir(session: Any) -> Path:
    """The folder of a live `Session` (`started_at`, `run`, `id`)."""
    return (
        records_dir()
        / run_folder_name(session.run, session.id, session.started_at)
        / session_folder_name(session.id, session.started_at)
    )


def find_session_dir(session_id: str) -> Optional[Path]:
    """An existing `<run>/<started>_<sid>` folder, e.g. after a backend restart."""
    root = records_dir()
    if not root.is_dir():
        return None
    matches = sorted(p for p in root.glob(f"*/*_{clean(session_id, 'session')}") if p.is_dir())
    return matches[0] if matches else None


def session_dir_from_header(header: dict) -> Path:
    """The folder for a record whose session is neither live nor on disk.

    Built from the record's own header. A run folder that already exists for
    the same run id is reused, so the legs of one run stay together.
    """
    sid = str(header.get("sessionId") or "")
    started_ms = header.get("startedAt")
    started = (
        datetime.fromtimestamp(started_ms / 1000, tz=timezone.utc)
        if isinstance(started_ms, (int, float)) and started_ms > 0
        else datetime.now(timezone.utc)
    )
    run_id = header.get("experimentRunId")
    run = None
    if run_id:
        if header.get("tourId"):
            run = {"kind": "tour", "id": header["tourId"], "run_id": run_id}
        elif header.get("conditionId"):
            run = {"kind": "condition", "id": header["conditionId"], "run_id": run_id}
    root = records_dir()
    if run:
        what = clean(run["id"], "condition")
        if run["kind"] == "tour":
            what = f"tour-{what}"
        existing = sorted(p for p in root.glob(f"*_{what}_{clean(run_id, 'run')}") if p.is_dir()) if root.is_dir() else []
        if existing:
            return existing[0] / session_folder_name(sid, started)
    return root / run_folder_name(run, sid, started) / session_folder_name(sid, started)


def count_records() -> int:
    """Records in both layouts: new `<run>/<session>/record.json`, old flat `<sid>.json`."""
    root = records_dir()
    if not root.is_dir():
        return 0
    return sum(1 for _ in root.glob("*/*/record.json")) + sum(1 for _ in root.glob("*.json"))
