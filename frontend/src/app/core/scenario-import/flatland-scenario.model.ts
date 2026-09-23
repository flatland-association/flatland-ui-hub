/** The JSON produced by the flatland-scenarios drawing tool's "Export All
 *  (.json)" button. Only typed as deep as the app needs for listing/summary
 *  and session-start payloads — the backend (app/core/flatland_scenario_import.py)
 *  owns the full shape via the vendored upstream Scenario class. */
export interface FlatlandScenarioJson {
  gridDimensions: { rows: number; cols: number; cellSize?: number };
  grid: number[][];
  flatlandLine: {
    agent_positions: unknown[];
    agent_directions: unknown[];
    agent_targets: unknown[];
    agent_speeds: number[];
  };
  flatlandTimetable: {
    earliest_departures: unknown[];
    latest_arrivals: unknown[];
    max_episode_steps: number;
  };
  [key: string]: unknown;
}

export interface FlatlandScenarioSummary {
  id: string;
  name: string;
  updatedAt: string;
  gridWidth: number;
  gridHeight: number;
  agentCount: number;
}

/** A saved scene, as handed back by FlatlandScenarioStorageService.save()
 *  and ScenarioDrawingToolComponent's Save/Save As — carries the assigned id
 *  (the raw JSON has none of its own) so the welcome screen's saved-networks
 *  dropdown can pre-select it, the same role InfrastructureScene.id played. */
export interface ImportedFlatlandScenario {
  id: string;
  name: string;
  updatedAt: string;
  data: FlatlandScenarioJson;
}

/** Shared shape check — a scenario needs at least these keys to be buildable
 *  into a session. Used both to validate a scenario captured from the
 *  drawing tool's own Export All (.json) button (Save/Save As) and to filter
 *  a bulk "Import all scenes JSON" so one malformed/foreign entry can't
 *  corrupt the whole list (or leave a storage entry with no usable `data`). */
export function isFlatlandScenarioJson(candidate: unknown): candidate is FlatlandScenarioJson {
  const value = candidate as Partial<FlatlandScenarioJson> | null | undefined;
  return !!(value?.gridDimensions && Array.isArray(value.grid) && value.flatlandLine && value.flatlandTimetable);
}

/** The bulk multi-scene format written/read by the scene toolbar's
 *  "Export all scenes JSON"/"Import all scenes JSON" buttons — one file for
 *  every locally-saved scene, mirroring the old Infrastructure Builder's
 *  scene-manager export. */
export interface FlatlandScenarioExport {
  version: 1;
  exportedAt: string;
  scenes: ImportedFlatlandScenario[];
}
