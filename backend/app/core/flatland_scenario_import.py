"""Build Flatland generators from a flatland-scenarios drawing-tool export.

Uses the vendored `scenario_generator.model.scenario.Scenario`
(app/core/vendor/scenario_generator/) rather than re-implementing the JSON ->
RailEnv conversion — see app/core/vendor/scenario_generator/SOURCE.md for why
`to_rail_generator()`/`to_line_generator()`/`to_timetable_generator()` are the
integration seam (not `to_rail_env()`).

Expects the JSON produced by the drawing tool's "Export All (.json)" button —
it already includes the derived `flatlandLine`/`flatlandTimetable` keys these
generators read, alongside the editable grid/lines/timetables. (The tool's
separate "Flatland Download" button emits a standalone Python script, not
JSON — irrelevant here.)
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable

_VENDOR_DIR = Path(__file__).parent / "vendor"
if str(_VENDOR_DIR) not in sys.path:
    sys.path.insert(0, str(_VENDOR_DIR))

from scenario_generator.model.scenario import Scenario  # noqa: E402


def scenario_dimensions(flatland_scenario_json: dict[str, Any]) -> tuple[int, int, int]:
    """(width, height, number_of_agents) read off the upstream JSON."""
    grid_dims = flatland_scenario_json.get("gridDimensions") or {}
    width = int(grid_dims.get("cols", 0))
    height = int(grid_dims.get("rows", 0))
    number_of_agents = len((flatland_scenario_json.get("flatlandLine") or {}).get("agent_positions", []))
    return width, height, number_of_agents


def flatland_scenario_to_generators(flatland_scenario_json: dict[str, Any]) -> tuple[Callable, Callable, Callable]:
    """(rail_generator, line_generator, timetable_generator) for StationAwareRailEnv."""
    scenario = Scenario(flatland_scenario_json)
    return (
        scenario.to_rail_generator(),
        scenario.to_line_generator(),
        scenario.to_timetable_generator(),
    )
