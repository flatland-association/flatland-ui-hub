"""A completed CLI attempt is successful only when every train arrived."""
import asyncio
import json

import pytest

from app import dispatcher_batch


@pytest.mark.parametrize("outcome,success", [("all_arrived", True), ("horizon", False), ("unfinished", False)])
def test_summary_retains_condition_and_operational_outcome(tmp_path, monkeypatch, outcome, success):
    arrived = 16 if outcome == "all_arrived" else 15
    async def completed(_config, _max_pulses):
        return {
            "profile": "baseline", "operator_type": "synthetic_dispatcher", "mixed": False,
            "mode": "recommendation", "seed": 42, "scenario": "pf-ch-corridor-stops",
            "scenario_version": "fixture-a", "code_version": "code-a", "controller_version": "controller-a",
            "policy": "scripted_plan", "technical_result": "complete", "simulation_result": outcome,
            "run_status": "finished", "abort_reason": None, "metrics": {"arrived": arrived, "total_trains": 16},
        }

    monkeypatch.setattr(dispatcher_batch, "run", completed)
    assert asyncio.run(dispatcher_batch.main([{}], tmp_path, 320)) is success
    summary = json.loads((tmp_path / "comparison.json").read_text())[0]
    assert summary["simulation_result"] == outcome
    assert summary["technical_result"] == "complete"
    assert summary["operator_type"] == "synthetic_dispatcher"
    assert summary["scenario"] == "pf-ch-corridor-stops"
    assert summary["seed"] == 42
    assert summary["code_version"] == "code-a"
    assert summary["metrics"] == {"arrived": arrived, "total_trains": 16}


def test_unattended_batch_does_not_invent_team_consent(monkeypatch):
    from types import SimpleNamespace

    session = SimpleNamespace(dispatcher=SimpleNamespace(operator_type="human_dispatcher_team"))
    deleted = []
    monkeypatch.setattr(dispatcher_batch, "create_session", lambda _request: SimpleNamespace(id="team"))
    monkeypatch.setattr(dispatcher_batch.session_manager, "get", lambda _id: session)
    monkeypatch.setattr(dispatcher_batch, "delete_session", deleted.append)
    with pytest.raises(ValueError, match="synthetic_dispatcher"):
        asyncio.run(dispatcher_batch.run({}))
    assert deleted == ["team"]
