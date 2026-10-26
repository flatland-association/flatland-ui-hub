/** Payloads of the graph env playground API (backend/app/api/graph_env.py). Coordinates are `[lat, lon]`. */
export type LatLon = [number, number];

export interface GraphEnvNode {
  id: string;
  lat: number;
  lon: number;
  is_switch: boolean;
}

export interface GraphEnvNetwork {
  /** One polyline per track. */
  tracks: LatLon[][];
  nodes: GraphEnvNode[];
  /** `[[south, west], [north, east]]`. */
  bounds: [LatLon, LatLon];
}

export interface GraphEnvAgent {
  handle: number;
  /** flatland `TrainState` name, e.g. `WAITING`, `MOVING`, `DONE`. */
  state: string;
  edge: [string, string] | null;
  fraction: number | null;
  /** Position and heading (degrees clockwise from north); null while off the map. */
  lat: number | null;
  lon: number | null;
  bearing: number | null;
  /** The remaining route, one polyline per edge, starting at the train. */
  remaining_path: LatLon[][];
  target: LatLon;
  /** Not sent yet: read by the event feed's triage, kept from the original (features/triaged-events). */
  time_to_deadline?: number | null;
  is_malfunctioning?: boolean;
}

/** The step response, with `step` as `elapsed_steps` - the name the copied toolbar reads (SessionState). */
export interface GraphEnvState {
  elapsed_steps: number;
  max_episode_steps: number;
  done: boolean;
  agents: GraphEnvAgent[];
}

export interface GraphEnvStateResponse {
  step: number;
  max_episode_steps: number;
  done: boolean;
  agents: GraphEnvAgent[];
}

export interface GraphEnvSessionResponse {
  id: string;
  state: GraphEnvStateResponse;
}
