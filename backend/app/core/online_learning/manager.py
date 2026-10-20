"""Controls the learner's worker process from the API process.

Nothing here imports torch: the worker does. The hub only starts, pauses,
resumes and stops it, reads its status file, and drops overrides of sessions
running `lab:online-ppo` into its inbox.
"""
from __future__ import annotations

import importlib.util
import json
import multiprocessing as mp
import time
import uuid
from pathlib import Path
from typing import Optional

from .config import PUBLISHED_NAME, ROOT, OnlineConfig
from .worker import INBOX_DIR, STATUS_FILE, worker_main

PUBLISHED_POLICY_ID = "lab:" + PUBLISHED_NAME


class OnlineLearningManager:
    def __init__(self, root: Path = ROOT):
        self.root = Path(root)
        self._proc: Optional[mp.Process] = None
        self._commands = None

    # ── control ────────────────────────────────────────────────────────
    @staticmethod
    def available() -> bool:
        return importlib.util.find_spec("torch") is not None

    def is_alive(self) -> bool:
        return self._proc is not None and self._proc.is_alive()

    def start(self, config: Optional[dict] = None) -> dict:
        if not self.available():
            raise RuntimeError("torch is not installed")
        if self.is_alive():
            raise RuntimeError("the online learner is already running")
        cfg = OnlineConfig.from_dict(config)
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / STATUS_FILE).unlink(missing_ok=True)
        ctx = mp.get_context("spawn")
        self._commands = ctx.Queue()
        self._proc = ctx.Process(target=worker_main, args=(cfg.to_dict(), str(self.root), self._commands),
                                 name="online-ppo-learner", daemon=True)
        self._proc.start()
        return {"started": True, "pid": self._proc.pid, "config": cfg.to_dict()}

    def _send(self, cmd: str) -> dict:
        if not self.is_alive():
            raise RuntimeError("the online learner is not running")
        self._commands.put(cmd)
        return {"sent": cmd}

    def pause(self) -> dict:
        return self._send("pause")

    def resume(self) -> dict:
        return self._send("resume")

    def stop(self, timeout: float = 10.0) -> dict:
        if not self.is_alive():
            return {"stopped": True, "was_running": False}
        self._commands.put("stop")
        self._proc.join(timeout)
        if self._proc.is_alive():
            self._proc.terminate()
            self._proc.join(2)
        return {"stopped": True, "was_running": True}

    # ── state ──────────────────────────────────────────────────────────
    def status(self) -> dict:
        path = self.root / STATUS_FILE
        data: dict = {}
        # A status file left by another backend process (or a run started
        # elsewhere) says nothing about a learner here: only the runs this
        # manager started are reported, the last one also after it stopped.
        if self._proc is not None and path.is_file():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                data = {}
        alive = self.is_alive()
        if not alive and data.get("state") in ("running", "paused", "updating", "starting"):
            data["state"] = "stopped"
        data.setdefault("state", "idle")
        data["alive"] = alive
        data["available"] = self.available()
        return data

    def audit(self, limit: int = 200) -> list[dict]:
        run_id = self.status().get("run_id")
        if not run_id:
            return []
        path = self.root / "runs" / run_id / "audit.jsonl"
        if not path.is_file():
            return []
        lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
        out = []
        for raw in lines:
            try:
                out.append(json.loads(raw))
            except ValueError:
                continue
        return out

    # ── hub hooks ──────────────────────────────────────────────────────
    def note_override(self, session, handle: int, action: int, mode: Optional[str], owner: Optional[str]) -> bool:
        """A human override in a session running the online policy: snapshot
        the env for the learner. A no-op otherwise, so no mode changes."""
        if owner not in (None, "human") or getattr(session, "policy", None) != PUBLISHED_POLICY_ID:
            return False
        if not self.is_alive():
            return False
        from flatland.envs.persistence import RailEnvPersister

        inbox = self.root / INBOX_DIR
        inbox.mkdir(parents=True, exist_ok=True)
        key = f"{time.time():.3f}-{uuid.uuid4().hex[:6]}"
        snapshot = f"{key}.pkl"
        RailEnvPersister.save(session.env, str(inbox / snapshot))
        record = {"kind": "override", "session_id": session.id, "handle": int(handle), "action": int(action),
                  "mode": mode, "owner": owner or "human", "snapshot": snapshot,
                  "step": int(getattr(session.env, "_elapsed_steps", 0) or 0)}
        (inbox / f"{key}.json").write_text(json.dumps(record), encoding="utf-8")
        return True

    def note_feedback(self, record: dict) -> bool:
        if not self.is_alive():
            return False
        inbox = self.root / INBOX_DIR
        inbox.mkdir(parents=True, exist_ok=True)
        key = f"{time.time():.3f}-{uuid.uuid4().hex[:6]}"
        (inbox / f"{key}.json").write_text(json.dumps({"kind": "feedback", **record}), encoding="utf-8")
        return True


manager = OnlineLearningManager()
