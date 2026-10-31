"""Server call log (docs/plans/experiment-logging-frontend-and-replay.md §5.1.2).

A small app with the middleware, so no Flatland session is needed; the
session folder lookup is replaced by a temporary directory.
"""

import json
import logging
import logging.config
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import settings
from app.core import call_log

BACKEND = Path(__file__).resolve().parent.parent


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(call_log.CallLogMiddleware)

    @app.post("/session")
    def create(body: dict):
        return {"id": body.get("want", "new1")}

    @app.get("/session/{session_id}/state")
    def state(session_id: str):
        return {"step": 1}

    @app.post("/session/{session_id}/step")
    def step(session_id: str, body: dict):
        return {"ok": True, "n": body.get("n")}

    @app.delete("/session/{session_id}")
    def delete(session_id: str):
        return {"deleted": session_id}

    @app.get("/policies")
    def policies():
        return ["a"]

    @app.put("/study/records/{session_id}")
    def sink(session_id: str):
        return {"stored": True}

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


@pytest.fixture
def client():
    return TestClient(_app())


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    call_log.close_all_session_loggers()
    call_log._template_cache.clear()
    call_log._dedup._last.clear()
    monkeypatch.delenv("UVICORN_LOG_CONFIG", raising=False)
    yield
    call_log.close_all_session_loggers()
    call_log._template_cache.clear()


def _lines(caplog):
    return [json.loads(r.getMessage()) for r in caplog.records if r.name == call_log.CALLS_LOGGER]


def test_off_without_configuration(client, caplog):
    assert not call_log.enabled()
    client.post("/session/s1/step", json={"n": 1})
    assert _lines(caplog) == []


def test_post_gives_one_line_with_both_bodies(client, caplog):
    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    client.post("/session/s1/step", json={"n": 3}, headers={"X-Client-Seq": "412", "X-Client-Time": "1000", "X-Participant-Id": "P07"})
    [line] = _lines(caplog)
    assert line["sid"] == "s1" and line["route"] == "/session/{session_id}/step"
    assert line["body"] == {"n": 3} and line["response"] == {"ok": True, "n": 3}
    assert line["status"] == 200 and line["client"] == {"seq": 412, "t": 1000, "participant": "P07"}


def test_repeated_get_is_a_reference(client, caplog):
    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    client.get("/session/s1/state")
    client.get("/session/s1/state")
    first, second = _lines(caplog)
    assert "response" in first and second["response_same_as"] == first["seq"]


def test_study_routes_and_excluded_routes_are_not_logged(client, caplog, monkeypatch):
    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    monkeypatch.setattr(settings, "study_call_log_exclude", "/policies")
    client.put("/study/records/s1", json={})
    client.get("/policies")
    client.options("/health")
    client.get("/health")
    assert [line["path"] for line in _lines(caplog)] == ["/health"]


def test_non_json_bodies_are_summarised(caplog):
    from fastapi.responses import PlainTextResponse

    app = FastAPI()
    app.add_middleware(call_log.CallLogMiddleware)

    @app.get("/file")
    def file():
        return PlainTextResponse("hello")

    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    TestClient(app).get("/file")
    [line] = _lines(caplog)
    assert line["response"]["bytes"] == 5


def _template_config(tmp_path: Path) -> Path:
    config = json.loads((BACKEND / "logging.study.json").read_text())
    path = tmp_path / "logging.json"
    path.write_text(json.dumps(config))
    return path


def test_two_sessions_write_two_files(client, caplog, tmp_path, monkeypatch):
    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    monkeypatch.setenv("UVICORN_LOG_CONFIG", str(_template_config(tmp_path)))
    monkeypatch.setattr(call_log, "_session_dir", lambda sid: tmp_path / "run" / f"t_{sid}")
    client.post("/session/a/step", json={"n": 1})
    client.post("/session/b/step", json={"n": 2})
    client.post("/session", json={"want": "c"})  # lands in the new session's file
    call_log.close_all_session_loggers()
    for sid in ("a", "b", "c"):
        lines = (tmp_path / "run" / f"t_{sid}" / "backend-calls.jsonl").read_text().splitlines()
        assert [json.loads(line)["sid"] for line in lines] == [sid]
    assert _lines(caplog) == []  # nothing fell back to the sessionless logger


def test_without_template_session_calls_go_to_the_sessionless_log(client, caplog):
    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    client.post("/session/a/step", json={"n": 1})
    assert [line["sid"] for line in _lines(caplog)] == ["a"]


def test_delete_closes_the_session_file(client, caplog, tmp_path, monkeypatch):
    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    monkeypatch.setenv("UVICORN_LOG_CONFIG", str(_template_config(tmp_path)))
    monkeypatch.setattr(call_log, "_session_dir", lambda sid: tmp_path / sid)
    client.post("/session/a/step", json={"n": 1})
    assert "a" in call_log._open
    client.delete("/session/a")
    assert "a" not in call_log._open
    assert len((tmp_path / "a" / "backend-calls.jsonl").read_text().splitlines()) == 2


def test_open_files_are_capped(client, caplog, tmp_path, monkeypatch):
    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    monkeypatch.setenv("UVICORN_LOG_CONFIG", str(_template_config(tmp_path)))
    monkeypatch.setattr(call_log, "_session_dir", lambda sid: tmp_path / sid)
    monkeypatch.setattr(settings, "study_call_log_open_files", 2)
    for sid in ("a", "b", "c"):
        client.get(f"/session/{sid}/state")
    assert list(call_log._open) == ["b", "c"]


def test_ws_events_are_logged(caplog):
    caplog.set_level(logging.INFO, logger=call_log.CALLS_LOGGER)
    call_log.log_ws("s1", "episode_done", step=40)
    [line] = _lines(caplog)
    assert line["method"] == "WS" and line["event"] == "episode_done" and line["step"] == 40


def test_the_shipped_configuration_loads_and_keeps_uvicorn_logging(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    config = json.loads((BACKEND / "logging.study.json").read_text())
    try:
        logging.config.dictConfig(config)
        assert logging.getLogger(call_log.CALLS_LOGGER).isEnabledFor(logging.INFO)
        assert logging.getLogger("uvicorn.access").handlers
        assert config[call_log.SESSION_TEMPLATE_KEY]["filename"] == "{session_dir}/backend-calls.jsonl"
    finally:
        calls = logging.getLogger(call_log.CALLS_LOGGER)
        for handler in list(calls.handlers):
            calls.removeHandler(handler)
            handler.close()
        calls.setLevel(logging.NOTSET)
        calls.propagate = True


def test_the_shipped_configuration_writes_the_sessionless_file(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    config = json.loads((BACKEND / "logging.study.json").read_text())
    calls = logging.getLogger(call_log.CALLS_LOGGER)
    try:
        logging.config.dictConfig(config)
        call_log.ensure_log_dirs()
        TestClient(_app()).get("/health")
        call_log.stop_queue_listeners()
        lines = (tmp_path / "data/study-logs/sessionless/backend-calls.jsonl").read_text().splitlines()
        assert [json.loads(line)["path"] for line in lines] == ["/health"]
    finally:
        call_log.stop_queue_listeners()
        for handler in list(calls.handlers):
            calls.removeHandler(handler)
            handler.close()
        calls.setLevel(logging.NOTSET)
        calls.propagate = True


def test_the_template_is_found_from_the_log_config_option(tmp_path, monkeypatch):
    path = _template_config(tmp_path)
    monkeypatch.setattr("sys.argv", ["uvicorn", "app.main:app", "--log-config", str(path)])
    assert call_log._template()["filename"] == "{session_dir}/backend-calls.jsonl"
