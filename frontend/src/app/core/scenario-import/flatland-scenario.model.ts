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

/** A saved import, as handed back by FlatlandScenarioStorageService.save()
 *  and emitted by ScenarioDrawingToolComponent — carries the assigned id
 *  (the raw JSON has none of its own) so the welcome screen's saved-networks
 *  dropdown can pre-select it, the same role InfrastructureScene.id played. */
export interface ImportedFlatlandScenario {
  id: string;
  name: string;
  updatedAt: string;
  data: FlatlandScenarioJson;
}
