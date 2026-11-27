"""Run the same synthetic sessions as the UI: python -m app.dispatcher_batch."""
import argparse
import asyncio
import json
import logging
from pathlib import Path

from fastapi import HTTPException
from pydantic import ValidationError

from app.api.sessions import create_session, delete_session, step
from app.core.dispatcher import PROFILES, export_run
from app.core.session_manager import session_manager
from app.models.session import SessionCreateRequest, StepRequest

log = logging.getLogger(__name__)


async def run(config: dict, max_pulses: int = 250) -> dict:
    """An isolated live session using the UI's creation and step commands."""
    info = create_session(SessionCreateRequest.model_validate(config))
    session = session_manager.get(info.id)
    if session.dispatcher is None or session.dispatcher.operator_type != "synthetic_dispatcher":
        delete_session(info.id)
        raise ValueError("Batch comparison requires a synthetic_dispatcher operator")
    try:
        for _ in range(max_pulses):
            result = await step(info.id, StepRequest(policy=session.policy))
            if result.get("episode_done") or session.dispatcher.run_status == "error":
                break
        else:
            session.dispatcher.invalidate(session, "pulse_limit")
            session.dispatcher.run_status = "aborted"
            session.dispatcher.abort_reason = "pulse_limit"
        return export_run(session)
    except Exception as exc:
        log.exception("Synthetic run failed: %s", session.id)
        # Run boundary: preserve failed runs as errors, never zero performance.
        session.dispatcher.invalidate(session, "run_error")
        session.dispatcher.run_status = "error"
        session.dispatcher.abort_reason = f"{type(exc).__name__}: {exc}"
        return export_run(session)
    finally:
        delete_session(info.id)


async def main(configs: list[dict], output: Path, max_pulses: int) -> bool:
    """Retain every attempted condition and continue after rejected setup."""
    output.mkdir(parents=True, exist_ok=True)
    summaries = []
    for index, config in enumerate(configs):
        try:
            result = await run(config, max_pulses)
        except Exception as exc:
            invalid = isinstance(exc, (ValidationError, HTTPException, ValueError))
            if not invalid:
                log.exception("Synthetic session setup failed at configuration %s", index + 1)
            dispatcher = config.get("dispatcher") if isinstance(config, dict) else None
            requested = dispatcher.get("profile") if isinstance(dispatcher, dict) else None
            errors = (
                exc.errors(include_input=False, include_context=False, include_url=False)
                if isinstance(exc, ValidationError) else [{"message": str(exc)}]
            )
            result = {"schema": "flatland-synthetic-dispatcher", "version": 1,
                      "profile": requested if requested in PROFILES else "unknown",
                      "operator_type": "synthetic_dispatcher", "run_status": "error",
                      "technical_result": "invalid_configuration" if invalid else "error", "simulation_result": "not_started",
                      "abort_reason": "invalid_configuration" if invalid else "setup_failure", "errors": errors, "metrics": None, "events": []}
        name = f"{index + 1:02d}-{result['profile']}.json"
        (output / name).write_text(json.dumps(result, indent=2), encoding="utf-8")
        summaries.append({
            "file": name,
            **{key: result.get(key) for key in (
                "profile", "operator_type", "mixed", "mode", "seed", "scenario",
                "scenario_version", "code_version", "controller_version", "policy",
                "technical_result", "simulation_result", "run_status", "abort_reason", "metrics",
            )},
        })
    (output / "comparison.json").write_text(json.dumps(summaries, indent=2), encoding="utf-8")
    print(json.dumps(summaries, indent=2))
    return all(result["technical_result"] == "complete" and result["simulation_result"] == "all_arrived"
               for result in summaries)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path, help="JSON list of SessionCreateRequest configurations")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-pulses", type=int, default=250)
    args = parser.parse_args()
    succeeded = asyncio.run(main(json.loads(args.config.read_text()), args.output, args.max_pulses))
    raise SystemExit(0 if succeeded else 1)
