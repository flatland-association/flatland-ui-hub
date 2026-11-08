"""Train the AI from the browser — the MARL lab tour (docs/plans/marl-lab-tour.md).

The CLI fine-tune (`lab/marl/finetune_interventions.py`) reads every session's
interventions. Here it runs on **one** session's human lines, from the policy
that session ran, as a job in a worker thread, and ends with a short check: the
new model and its base, each alone, on the session's scenario and two it never
saw (`lab/marl/evaluate.run`).

- `status(session_id, session)` — whether training is possible here, what it
  would start from and the session's interventions as a short list.
- `start(session_id, session, kl_weight)` — a job; one per session at a time.
- `job(job_id)` — its state and, once done, the result.

Gating: torch and the lab package importable, the checkpoints dir writable,
and `MARL_LAB_TRAINING` not `0`. The Hugging Face Space trains into a
temporary dir (deploy/hf/Dockerfile).

Seeded: the same interventions with the same knob give the same model.
Everything torch is imported inside the job, so importing this module (the API
does at startup) never touches torch.
"""
from __future__ import annotations

import importlib.util
import logging
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from app.core import intervention_log
from app.policies.learned import lab_checkpoints

log = logging.getLogger(__name__)

SEED = 0
EPOCHS = 200
ROLLOUT_STATES = 2048
#: Little / medium / a lot, as the tour offers them; medium is the default.
KL_WEIGHTS = (1.0, 3.0, 10.0)
DEFAULT_KL_WEIGHT = 3.0
#: The check after training: the tour's conflict, a longer approach to the same
#: section, and an ECML scene the training never saw.
CHECK_SCENARIOS = ("pf-ch-wn-wal-conflict", "pf-ch-wn-wal-long-approach", "ecml2026-scene1-level0")
#: Rollout states for the KL term come from the session's own scenario; a
#: generated session (no preset) falls back to this.
FALLBACK_ROLLOUT_SCENARIO = "gen:30x30:5:*"

_jobs: dict[str, dict] = {}
_running: dict[str, str] = {}  # session_id -> job id of its running job
_lock = threading.Lock()

# Tests shrink the run (epochs, rollout states, which scenarios are checked).
_overrides: dict[str, Any] = {}


def _setting(name: str, default):
    return _overrides.get(name, default)


# ── gating ──────────────────────────────────────────────────────────────

def _writable(directory: Path) -> bool:
    try:
        directory.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".write-test-", delete=True):
            pass
        return True
    except OSError:
        return False


def availability() -> dict:
    """`{"available": bool, "reason": str|None}` — reason is an id the HMI maps
    to text: `disabled`, `no-torch`, `not-writable`."""
    if os.environ.get("MARL_LAB_TRAINING", "1").strip() == "0":
        return {"available": False, "reason": "disabled"}
    if importlib.util.find_spec("torch") is None:
        return {"available": False, "reason": "no-torch"}
    try:
        lab_present = importlib.util.find_spec("lab.marl.finetune_interventions") is not None
    except ModuleNotFoundError:
        lab_present = False
    if not lab_present:
        return {"available": False, "reason": "no-torch"}
    if not _writable(lab_checkpoints.checkpoints_dir()):
        return {"available": False, "reason": "not-writable"}
    return {"available": True, "reason": None}


# ── what a session would train on ───────────────────────────────────────

def base_checkpoint(policy_id: str) -> Optional[Path]:
    """The file a session's learned policy loads, or None for any other policy."""
    if policy_id == "learned_ppo":
        from app.policies.registry import _LEARNED_PPO_CHECKPOINT

        return _LEARNED_PPO_CHECKPOINT if _LEARNED_PPO_CHECKPOINT.is_file() else None
    return lab_checkpoints.path_for_policy_id(policy_id)


def _human_lines(session_id: str) -> tuple[list[dict], dict[str, int]]:
    """This session's usable human interventions — nothing from any other run."""
    from lab.marl.finetune_interventions import load_interventions_from

    return load_interventions_from([intervention_log.log_path(session_id)])


def _summary(line: dict) -> dict:
    return {
        "handle": int(line.get("handle", -1)),
        "step": int(line.get("step", 0) or 0),
        "aiAction": int(line.get("ai_action", 0)),
        "humanAction": int(line.get("human_action", 0)),
        "agreed": bool(line.get("agreed", False)),
    }


def status(session_id: str, session) -> dict:
    gate = availability()
    policy_id = getattr(session, "policy", "") or ""
    base = base_checkpoint(policy_id)
    lines: list[dict] = []
    if gate["available"]:
        lines, _ = _human_lines(session_id)
    jobs = [public(j) for j in _jobs.values() if j["sessionId"] == session_id]
    return {
        **gate,
        "basePolicy": policy_id if base is not None else None,
        "defaultKlWeight": DEFAULT_KL_WEIGHT,
        "klWeights": list(KL_WEIGHTS),
        "interventions": [_summary(ln) for ln in lines],
        "jobs": sorted(jobs, key=lambda j: j["startedAt"]),
    }


# ── jobs ────────────────────────────────────────────────────────────────

class TrainingError(Exception):
    """Refused before a job starts; `code` is what the API answers with."""

    def __init__(self, code: int, reason: str):
        super().__init__(reason)
        self.code = code
        self.reason = reason


def public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_")}


def job(job_id: str) -> Optional[dict]:
    found = _jobs.get(job_id)
    return public(found) if found else None


def _next_name(session_id: str) -> str:
    taken = {j["name"] for j in _jobs.values()}
    n = 1
    while True:
        name = f"{lab_checkpoints.TOUR_PREFIX}{session_id}-{n}"
        if name not in taken and not lab_checkpoints.checkpoint_path(name).exists():
            return name
        n += 1


def prune_tour_checkpoints(now: Optional[float] = None) -> list[str]:
    """Delete tour checkpoints older than `tour_ttl_hours()`; returns the names."""
    ttl = lab_checkpoints.tour_ttl_hours()
    if ttl <= 0:
        return []
    cutoff = (now or time.time()) - ttl * 3600
    removed = []
    for path in lab_checkpoints.list_checkpoints():
        if not lab_checkpoints.is_tour_checkpoint(path):
            continue
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
                path.with_suffix(".json").unlink(missing_ok=True)
                removed.append(path.stem)
        except OSError:
            continue
    return removed


def start(session_id: str, session, kl_weight: float) -> dict:
    gate = availability()
    if not gate["available"]:
        raise TrainingError(503, gate["reason"])
    if not (0 < kl_weight <= 100):
        raise TrainingError(400, "kl-weight")
    policy_id = getattr(session, "policy", "") or ""
    base = base_checkpoint(policy_id)
    if base is None:
        raise TrainingError(400, "not-learned")
    lines, skipped = _human_lines(session_id)
    if not lines:
        raise TrainingError(400, "no-interventions")

    with _lock:
        if session_id in _running:
            raise TrainingError(409, "running")
        prune_tour_checkpoints()
        name = _next_name(session_id)
        scenario = getattr(session, "scenario_preset_id", None)
        record = {
            "jobId": uuid.uuid4().hex[:12],
            "sessionId": session_id,
            "state": "running",
            "name": name,
            "policyId": lab_checkpoints.LAB_POLICY_PREFIX + name,
            "basePolicy": policy_id,
            "klWeight": float(kl_weight),
            "interventions": len(lines),
            "startedAt": time.time(),
            "finishedAt": None,
            "agreementBefore": None,
            "agreementAfter": None,
            "changedShare": None,
            "check": [],
            "error": None,
            "_scenario": scenario,
        }
        _jobs[record["jobId"]] = record
        _running[session_id] = record["jobId"]

    thread = threading.Thread(
        target=_run, args=(record, lines, skipped, base), name=f"lab-train-{record['jobId']}", daemon=True,
    )
    thread.start()
    return public(record)


def _run(record: dict, lines: list[dict], skipped: dict, base: Path) -> None:
    try:
        from lab.marl.finetune_interventions import finetune_on_lines

        scenario = record["_scenario"]
        result = finetune_on_lines(
            lines,
            name=record["name"],
            base_path=base,
            scenarios=[scenario or FALLBACK_ROLLOUT_SCENARIO],
            rollout_states_n=_setting("rollout_states", ROLLOUT_STATES),
            epochs=_setting("epochs", EPOCHS),
            kl_weight=record["klWeight"],
            # CPU on purpose: small network, and the same model for the same
            # interventions (mps/cuda kernels are not bit-reproducible).
            device="cpu",
            seed=SEED,
            extra_meta={"session_id": record["sessionId"], "skipped": skipped, "tour": True},
            log=lambda msg: log.info("[lab-train %s] %s", record["jobId"], msg),
        )
        record["agreementBefore"] = result["before"]
        record["agreementAfter"] = result["after"]
        record["changedShare"] = round(float(result["changed"]), 4)
        record["check"] = _check(Path(result["checkpoint"]), base, scenario)
        record["state"] = "done"
    except Exception as exc:  # a failed job reports; it never takes the server down
        log.exception("lab training job %s failed", record["jobId"])
        record["state"] = "error"
        record["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        record["finishedAt"] = time.time()
        with _lock:
            if _running.get(record["sessionId"]) == record["jobId"]:
                del _running[record["sessionId"]]


def _check(trained: Path, base: Path, scenario: Optional[str]) -> list[dict]:
    """Each model alone, greedy, to the episode end on a few scenarios."""
    from lab.marl.evaluate import run

    scenarios = list(_setting("check_scenarios", CHECK_SCENARIOS))
    if scenario and scenario not in scenarios:
        scenarios.insert(0, scenario)
    rows = []
    for sc in scenarios:
        row: dict[str, Any] = {"scenario": sc, "seen": sc == scenario}
        try:
            for key, path in (("base", base), ("trained", trained)):
                r = run(sc, key, {key: path})
                row["trains"] = r.trains
                row[key] = {"arrived": r.arrived, "delay": r.delay, "steps": r.steps}
        except Exception as exc:  # one broken scenario must not hide the rest
            row["error"] = f"{type(exc).__name__}: {exc}"
        rows.append(row)
    return rows


def forget_jobs() -> None:
    """Tests only."""
    with _lock:
        _jobs.clear()
        _running.clear()
