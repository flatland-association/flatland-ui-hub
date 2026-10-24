"""The learner's own process: training never blocks the simulation or the UI.

Commands arrive on a queue (pause, resume, stop). The worker writes its state
to `status.json` (atomically) and reads hub overrides from `inbox/`, each a
JSON record plus a persisted env snapshot (`manager.note_override`).
"""
from __future__ import annotations

import json
import os
import queue
import time
import traceback
from pathlib import Path

STATUS_FILE = "status.json"
INBOX_DIR = "inbox"


def write_status(root: Path, payload: dict) -> None:
    root.mkdir(parents=True, exist_ok=True)
    tmp = root / f".{STATUS_FILE}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps({"updated": time.time(), **payload}, default=str), encoding="utf-8")
    tmp.replace(root / STATUS_FILE)


def process_inbox(learner, root: Path, limit: int = 5) -> int:
    from flatland.envs.persistence import RailEnvPersister

    inbox = root / INBOX_DIR
    if not inbox.is_dir():
        return 0
    done = 0
    for record_path in sorted(inbox.glob("*.json"))[:limit]:
        try:
            record = json.loads(record_path.read_text(encoding="utf-8"))
            if not learner.cfg.learning_sources["user_interactions"]:
                snapshot_name = record.get("snapshot")
                if isinstance(snapshot_name, str):
                    (inbox / snapshot_name).unlink(missing_ok=True)
                learner._audit({"event": "source_skipped", "source": "user_interactions",
                                "file": record_path.name})
                continue
            if record.get("kind") == "feedback":
                learner.ingest_feedback(record)
            else:
                env_path = inbox / record["snapshot"]
                env, _ = RailEnvPersister.load_new(str(env_path))
                env._elapsed_steps = int(record.get("step", 0))
                learner.ingest_override(record, env)
                env_path.unlink(missing_ok=True)
        except Exception as exc:  # a bad snapshot costs that record, not the worker
            learner._audit({"event": "inbox_error", "file": record_path.name, "error": f"{type(exc).__name__}: {exc}"})
        finally:
            record_path.unlink(missing_ok=True)
            done += 1
    return done


def worker_main(config: dict, root: str, commands) -> None:
    from .config import OnlineConfig
    from .learner import OnlineLearner

    root_path = Path(root)
    state = "starting"
    write_status(root_path, {"state": state, "pid": os.getpid()})
    try:
        cfg = OnlineConfig.from_dict(config)
        learner = OnlineLearner(cfg, root_path)
    except Exception as exc:
        write_status(root_path, {"state": "error", "error": f"{type(exc).__name__}: {exc}",
                                 "trace": traceback.format_exc()[-2000:]})
        return

    state = "running"
    last_status = 0.0
    steps_since_inbox = 0
    try:
        while True:
            try:
                while True:
                    cmd = commands.get_nowait()
                    if isinstance(cmd, dict):
                        if cmd.get("type") != "settings":
                            raise ValueError(f"unknown online learner command {cmd.get('type')!r}")
                        learner.apply_settings(cmd["settings"])
                        continue
                    if cmd == "pause":
                        state = "paused"
                        learner._audit({"event": "pause"})
                    elif cmd == "resume":
                        state = "running"
                        learner._audit({"event": "resume"})
                    elif cmd == "stop":
                        learner._audit({"event": "stop"})
                        write_status(root_path, {"state": "stopped", **learner.status()})
                        learner.close()
                        return
            except queue.Empty:
                pass

            if state == "paused":
                if time.time() - last_status > 1.0:
                    write_status(root_path, {"state": state, "pid": os.getpid(), **learner.status()})
                    last_status = time.time()
                time.sleep(0.2)
                continue

            learner.step()
            steps_since_inbox += 1
            if steps_since_inbox >= 10:
                process_inbox(learner, root_path)
                steps_since_inbox = 0
            if learner.ready_for_update():
                write_status(root_path, {"state": "updating", "pid": os.getpid(), **learner.status()})
                learner.update()
                last_status = 0.0
            if time.time() - last_status > 1.0 or learner.total_steps % learner.cfg.status_every_steps == 0:
                write_status(root_path, {"state": state, "pid": os.getpid(), **learner.status()})
                last_status = time.time()
    except Exception as exc:
        learner._audit({"event": "error", "error": f"{type(exc).__name__}: {exc}"})
        write_status(root_path, {"state": "error", "error": f"{type(exc).__name__}: {exc}",
                                 "trace": traceback.format_exc()[-2000:], **learner.status()})
