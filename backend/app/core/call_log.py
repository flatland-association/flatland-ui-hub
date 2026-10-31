"""Server call log: every backend call with its bodies, through Python `logging`
(docs/plans/experiment-logging-frontend-and-replay.md §5.1.2).

The safety net next to the browser's call log. Off unless the server starts
with a logging configuration that gives `flatland.study.calls` a handler at
INFO, e.g. `UVICORN_LOG_CONFIG=logging.study.json`: without it the middleware
passes requests through and reads no body.

Files, rotation and retention are `logging` configuration. The one thing
`dictConfig` cannot do is open one file per session, so the same file holds a
handler *template* under `flatland_session_handler` (ignored by `dictConfig`);
`session_logger(sid)` builds that handler for a session's folder
(app.core.study_paths).
"""

import importlib
import json
import logging
import os
import re
import threading
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs

from app.config import settings

CALLS_LOGGER = "flatland.study.calls"
SESSION_LOGGER_PREFIX = "flatland.study.calls.session."
SESSION_TEMPLATE_KEY = "flatland_session_handler"
SESSIONLESS_DIR = Path("data/study-logs/sessionless")

log = logging.getLogger(CALLS_LOGGER)

_SESSION_PATH = re.compile(r"^/(?:ws/)?session/([A-Za-z0-9_-]{1,80})(?:/|$)")
_NEVER = ("/study/",)
_lock = threading.Lock()
_open: "OrderedDict[str, tuple[logging.Logger, logging.Handler]]" = OrderedDict()
_template_cache: dict[str, Any] = {}
_seq = 0


def enabled() -> bool:
    return log.isEnabledFor(logging.INFO)


def _next_seq() -> int:
    global _seq
    with _lock:
        _seq += 1
        return _seq


def _template() -> Optional[dict]:
    """The per-session handler template from the file named by `UVICORN_LOG_CONFIG`."""
    path = os.environ.get("UVICORN_LOG_CONFIG", "")
    if path in _template_cache:
        return _template_cache[path]
    template = None
    if path:
        try:
            template = json.loads(Path(path).read_text(encoding="utf-8")).get(SESSION_TEMPLATE_KEY)
        except (OSError, ValueError):
            template = None
    _template_cache[path] = template
    return template


def _session_dir(sid: str) -> Optional[Path]:
    from app.core.session_manager import session_manager  # lazy: Flatland import
    from app.core.study_paths import find_session_dir, session_dir

    session = session_manager.get(sid)
    if session is not None:
        return session_dir(session)
    return find_session_dir(sid)


def _build_handler(template: dict, folder: Path) -> logging.Handler:
    spec = dict(template)
    module, _, name = spec.pop("class").rpartition(".")
    cls = getattr(importlib.import_module(module), name)
    spec.pop("formatter", None)
    spec["filename"] = str(spec["filename"]).format(session_dir=folder)
    Path(spec["filename"]).parent.mkdir(parents=True, exist_ok=True)
    handler = cls(**spec)
    handler.setFormatter(logging.Formatter("%(message)s"))
    return handler


def session_logger(sid: str) -> logging.Logger:
    """The child logger writing to the session's own file; the sessionless
    logger when there is no template or no folder for the session."""
    with _lock:
        if sid in _open:
            _open.move_to_end(sid)
            return _open[sid][0]
    template = _template()
    folder = _session_dir(sid) if template else None
    if not template or folder is None:
        return log
    child = logging.getLogger(SESSION_LOGGER_PREFIX + sid)
    handler = _build_handler(template, folder)
    child.addHandler(handler)
    child.propagate = False
    child.setLevel(logging.INFO)
    with _lock:
        _open[sid] = (child, handler)
        while len(_open) > max(1, settings.study_call_log_open_files):
            _close(*_open.popitem(last=False)[1])
    return child


def _close(child: logging.Logger, handler: logging.Handler) -> None:
    child.removeHandler(handler)
    handler.close()


def close_session_logger(sid: str) -> None:
    with _lock:
        entry = _open.pop(sid, None)
    if entry:
        _close(*entry)


def close_all_session_loggers() -> None:
    with _lock:
        entries = list(_open.values())
        _open.clear()
    for entry in entries:
        _close(*entry)


def _excluded(route: Optional[str]) -> bool:
    excluded = {r.strip() for r in settings.study_call_log_exclude.split(",") if r.strip()}
    return bool(route) and route in excluded


def _body(raw: bytes, content_type: str) -> Any:
    if not raw:
        return None
    if "json" in content_type:
        try:
            return json.loads(raw)
        except ValueError:
            pass
    return {"contentType": content_type or None, "bytes": len(raw)}


class _Dedup:
    """The last response per call, so a repeated (polled) answer is logged as a reference."""

    def __init__(self) -> None:
        self._last: dict[str, tuple[int, str]] = {}

    def check(self, key: str, seq: int, response: Any) -> Optional[int]:
        text = json.dumps(response, sort_keys=True, default=str)
        last = self._last.get(key)
        if last and last[1] == text:
            return last[0]
        self._last[key] = (seq, text)
        return None

    def forget(self, sid: str) -> None:
        for key in [k for k in self._last if k.startswith(f"{sid} ")]:
            del self._last[key]


_dedup = _Dedup()


def log_ws(sid: str, event: str, **extra: Any) -> None:
    """A WebSocket event (connect, disconnect, episode_done, error) as a `"WS"` line."""
    if not enabled():
        return
    entry = {"ts": time.time(), "seq": _next_seq(), "sid": sid, "method": "WS", "path": f"/ws/session/{sid}", "event": event, **extra}
    session_logger(sid).info(json.dumps(entry, default=str))


class CallLogMiddleware:
    """Collects request and response of every HTTP call and logs them as one JSON line."""

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if (
            scope["type"] != "http"
            or not enabled()
            or scope.get("method") == "OPTIONS"  # CORS preflight, answered before routing
            or any(p in scope.get("path", "") for p in _NEVER)
        ):
            await self.app(scope, receive, send)
            return

        started = time.perf_counter()
        request_body = bytearray()
        response_body = bytearray()
        response: dict[str, Any] = {"status": 0, "content_type": ""}

        async def receive_logged() -> dict:
            message = await receive()
            if message["type"] == "http.request":
                request_body.extend(message.get("body", b""))
            return message

        async def send_logged(message: dict) -> None:
            if message["type"] == "http.response.start":
                response["status"] = message["status"]
                headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in message.get("headers", [])}
                response["content_type"] = headers.get("content-type", "")
            elif message["type"] == "http.response.body":
                response_body.extend(message.get("body", b""))
            await send(message)

        try:
            await self.app(scope, receive_logged, send_logged)
        finally:
            try:
                self._log(scope, bytes(request_body), bytes(response_body), response, started)
            except Exception:  # noqa: BLE001 — logging must never fail a request
                logging.getLogger(__name__).exception("call log failed")

    def _log(self, scope: dict, req: bytes, res: bytes, response: dict, started: float) -> None:
        route_obj = scope.get("route")
        route = getattr(route_obj, "path", None)
        if _excluded(route):
            return
        path = scope.get("path", "")
        method = scope.get("method", "")
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        req_type = headers.get("content-type", "")
        body = _body(req, req_type)
        resp = _body(res, response["content_type"])
        match = _SESSION_PATH.match(path)
        sid = match.group(1) if match else None
        if sid is None and method == "POST" and path.rstrip("/") == "/session" and isinstance(resp, dict):
            sid = resp.get("id")
        seq = _next_seq()
        query = {k: v if len(v) > 1 else v[0] for k, v in parse_qs(scope.get("query_string", b"").decode("latin-1")).items()}
        entry: dict[str, Any] = {
            "ts": time.time(),
            "seq": seq,
            "sid": sid,
            "method": method,
            "path": path,
            "route": route,
            "query": query,
            "body": body,
            "status": response["status"],
            "ms": round((time.perf_counter() - started) * 1000, 1),
        }
        same = _dedup.check(f"{sid} {method} {path}?{scope.get('query_string', b'').decode('latin-1')}", seq, resp)
        if same is not None:
            entry["response_same_as"] = same
        else:
            entry["response"] = resp
        client = {
            "seq": _int(headers.get("x-client-seq")),
            "t": _int(headers.get("x-client-time")),
            "participant": headers.get("x-participant-id"),
        }
        if any(v is not None for v in client.values()):
            entry["client"] = client
        target = session_logger(sid) if sid else log
        target.info(json.dumps(entry, default=str))
        if sid and method == "DELETE" and match and path.rstrip("/") == f"/session/{sid}":
            close_session_logger(sid)
            _dedup.forget(sid)


def _int(value: Optional[str]) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except ValueError:
        return None


def ensure_log_dirs() -> None:
    """The sessionless log folder (relative to the server's working directory,
    `backend/`), created before the first line is written."""
    if enabled():
        SESSIONLESS_DIR.mkdir(parents=True, exist_ok=True)
