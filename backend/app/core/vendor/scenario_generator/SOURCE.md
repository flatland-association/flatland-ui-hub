# scenario_generator — source and licence

Vendored verbatim from
[`flatland-association/flatland-scenarios`](https://github.com/flatland-association/flatland-scenarios),
**MIT licensed**, commit `88c5c3cbfa78a820c791f3186d1e60428f8651e1` (2026-07-20),
paths `scenario_generator/model/scenario.py` and
`scenario_generator/flatland_integration/flatland_generators.py`.

Copied 2026-09-23 so the backend can build a `RailEnv` directly from the
[Flatland Environment Drawing Tool](https://github.com/flatland-association/flatland-scenarios/blob/main/scenario_generator/flatland_environment_drawing_tool.html)'s
JSON export, without lossily converting it into our own `InfrastructureScene`
shape first (see `app/core/flatland_scenario_import.py`).

Kept as an unmodified subtree (not flattened) so future re-vendoring is a
plain file diff against upstream. `Scenario.to_rail_generator()` /
`to_line_generator()` / `to_timetable_generator()` are the integration seam we
use for a *session* — each returns a plain generator callable, the same shape
`app/core/infrastructure_scene_adapter.py` already produces for
`StationAwareRailEnv`. `Scenario.to_rail_env()` builds a plain
`flatland.envs.rail_env.RailEnv` itself, which would bypass
`StationAwareRailEnv` (our subclass that retains station grouping for the
map/dispatcher UI — see `app/core/station_aware_env.py`), so we don't use it
for sessions either — but it *is* used deliberately by the standalone `.pkl`
export endpoint (`app/api/scenario_import.py`), which hands the caller a raw
`RailEnv` pickle and has no need for `StationAwareRailEnv`'s session-only
extras.

The drawing tool's "Export All (.json)" button is the one JSON export that
carries everything `Scenario` needs (it already includes the derived
`flatlandLine`/`flatlandTimetable` keys). Its separate "Flatland Download"
button emits a standalone Python script, not JSON — not usable here.

Not vendored: `scenario_generator/flatland_integration/run.py` and
`run_dla.py` (training-loop scripts, unused here).
