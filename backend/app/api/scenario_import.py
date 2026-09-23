"""Standalone flatland-scenarios JSON -> RailEnvPersister .pkl conversion.

The drawing tool's own "Flatland Download" button hands the user a
standalone Python script that rebuilds the env and pickles it — we do NOT
execute that (or any) user-supplied script server-side, since that would be
arbitrary code execution. Instead this calls the same vendored
Scenario.to_rail_env() our native session-import path already trusts
(app/core/flatland_scenario_import.py), then persists the result exactly the
way scenario_presets.py's Olten fixtures were built, and returns the bytes —
same end artifact, no code execution.
"""
import logging
import re
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException
from flatland.envs.persistence import RailEnvPersister
from pydantic import BaseModel
from starlette.responses import Response

from app.core.vendor.scenario_generator.model.scenario import Scenario

_perf_log = logging.getLogger("flatland.perf")

router = APIRouter()

_SAFE_FILENAME = re.compile(r"[^A-Za-z0-9_-]+")


class FlatlandScenarioPklRequest(BaseModel):
    flatland_scenario_json: dict
    filename: str | None = None


@router.post("/scenario-import/pkl")
def flatland_scenario_to_pkl(req: FlatlandScenarioPklRequest):
    try:
        env, _obs, _info = Scenario(req.flatland_scenario_json).to_rail_env()
    except Exception as e:
        raise HTTPException(400, f"Could not build a RailEnv from this scenario: {e!r}")

    filename = _SAFE_FILENAME.sub("", (req.filename or "scenario").strip()) or "scenario"
    _perf_log.info("[INFRA] scenario-import/pkl built env=%sx%s agents=%s", env.width, env.height, len(env.agents))

    with tempfile.TemporaryDirectory() as tmp:
        pkl_path = Path(tmp) / f"{filename}.pkl"
        RailEnvPersister.save(env, str(pkl_path))
        data = pkl_path.read_bytes()

    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}.pkl"'},
    )
