export type PolicyName =
  | 'deadlock_avoidance'
  | 'shortest_path'
  | 'forward_only'
  | 'do_nothing'
  | 'random'
  | 'goal_directed'
  /** Drives the scenario's premade plan. Only offered by a scenario that
   *  ships one; the backend selects it at session creation. */
  | 'plan'
  /** The learned PPO of the ECML 2026 starter kit, and every checkpoint the
   *  MARL lab trained (backend/lab/checkpoints/<name>.pt). */
  | 'learned_ppo'
  | `lab:${string}`;

export interface PolicyInfo {
  id: PolicyName;
  label: string;
  description: string;
  is_default: boolean;
  show_in_ui: boolean;
  supports_scenarios: boolean;
  /** Catalog metadata for the Algorithm Gallery. Served straight from the
   *  backend policy registry (app/policies/registry.py), which is already the
   *  single source of truth for runtime behaviour — so unlike the widget
   *  catalog there is no second copy that could drift out of sync. */
  family: 'rule-based' | 'search-based' | 'learned' | 'hybrid';
  deterministic: boolean;
  role: 'operational' | 'baseline' | 'diagnostic';
  observation: string;
  at_conflict: string;
  provenance: string;
  licence: string;
  grounding: string;
}

/** Where an algorithm plugs in (docs/plans/algorithm-catalog-all-seams.md):
 *  a policy drives every train each step, a proposal agent proposes courses
 *  (the "KI" column), a recommender assesses who a malfunction affects. */
export type AlgorithmLayer = 'policy' | 'proposal-agent' | 'recommender';

/** One entry of `GET /policies/catalog`, which reads every algorithm registry
 *  in the backend. Same fields as `PolicyInfo`, plus the seam and the other
 *  places that run the same algorithm. Ids are unique per layer only. */
export interface AlgorithmInfo extends Omit<PolicyInfo, 'id'> {
  id: string;
  layer: AlgorithmLayer;
  used_in: string[];
}

export interface ScenarioPoliciesConfig {
  session_id: string;
  // Scenario policies
  enabled_ids: string[];
  available_ids: string[];
  // Runtime / toolbar policy control
  enabled_policy_ids?: string[];
  available_policy_ids?: string[];
}

export type CellType = 'OUTSIDE' | 'FORWARD_ONLY' | 'MERGING' | 'SWITCH' | 'DONE' | 'UNKNOWN';

/** RailEnvActions 0–4, plus `REROUTE_ACTION` on the override channel only. */
export type ActionInt = 0 | 1 | 2 | 3 | 4 | 5;

/**
 * Override value for "reroute": not one move at the next switch but a whole
 * route around the blocked cells, which the backend fixes when it is set and
 * drives until the train arrives (backend `app/core/route_overrides.py`). The
 * backend refuses it (409) when no way around the block exists — the impact
 * item's `can_reroute`.
 */
export const REROUTE_ACTION = 5 as const;

export interface DecisionOption {
  action: ActionInt;
  action_name: string;
  label: string;
  target_position: [number, number];
}

export interface NextDecision {
  path: [number, number][];
  decision_position: [number, number];
  decision_direction: number;
  cell_type: 'SWITCH' | 'MERGING';
  options: DecisionOption[];
}

/** One ordered stop of a train (ECML intermediate stops with time windows).
 *  stops[0] is the origin, stops[-1] the target, the middle ones intermediate. */
export interface AgentStop {
  cell: [number, number] | null;
  earliest_departure: number | null;
  latest_arrival: number | null;
}

export interface AgentDTO {
  handle: number;
  position: [number, number] | null;
  direction: number | null;
  initial_position: [number, number] | null;
  initial_direction: number | null;
  target: [number, number];
  /** Ordered stops incl. intermediate stops; may be absent on older payloads. */
  stops?: AgentStop[];
  state: string;
  speed: number;
  earliest_departure: number | null;
  latest_arrival: number | null;
  eta_to_depart: number | null;
  time_to_deadline: number | null;
  delay: number;
  is_visible: boolean;
  delay_color_intensity: number;
  cell_type: CellType;
  next_decision: NextDecision | null;
  override_action: ActionInt | null;
  malfunction_remaining: number;
  is_malfunctioning: boolean;
  /** Speed, braking and occupied cells under vehicle dynamics; absent otherwise. */
  dynamics?: AgentDynamics;
}

export interface RailTile {
  r: number;
  c: number;
  rot: number;
  svg: string;
  binary?: number;
  hex?: string;
  description?: string;
}

export interface SessionState {
  width: number;
  height: number;
  num_agents: number;
  infrastructure_scene_id?: string | null;
  infrastructure_scene_diagnostics?: InfrastructureSceneDiagnostics | null;
  elapsed_steps: number;
  max_episode_steps: number;
  agents: AgentDTO[];
  rail_grid: number[][];
  rail_tiles: RailTile[];
  episode_done: boolean;
  decision_cells?: DecisionCell[];
}

export interface InfrastructureSceneDiagnostics {
  scene_cell_count: number;
  scene_switch_count: number;
  scene_agent_count: number;
  routable_agent_count: number;
  rail_cell_count: number;
  rail_tile_count: number;
  rail_switch_tile_count: number;
  switch_cell_tiles?: Array<{
    id?: string;
    x: number;
    y: number;
    connections?: string[];
    switchFacing?: string;
    svg?: string;
    rot?: number;
    visual_kind?: string;
  }>;
  switch_cell_visual_counts?: {
    switch: number;
    crossing: number;
    track: number;
  };
  unknown_tile_count: number;
  unknown_tiles: RailTile[];
  mismatched_cell_count?: number;
  mismatched_cells?: Array<{
    id?: string;
    x: number;
    y: number;
    kind?: string;
    reason?: string;
    connections?: string[];
    expected?: number;
    actual?: number;
  }>;
}

export interface SessionInfo {
  id: string;
  width: number;
  height: number;
  num_agents: number;
  infrastructure_scene_id?: string | null;
  scenario_preset_id?: string | null;
  /** True when the scenario shipped a plan; then `active_policy` is the plan
   *  policy and the trains follow it from the first step. */
  has_plan?: boolean;
  /** Policy the backend put the session on. Set for a planned scenario, which
   *  chooses its own policy rather than inheriting the UI's default. */
  active_policy?: string | null;
  /** Disturbances the backend actually applied. */
  disturbance_ids?: string[];
  /** Set on a live run (random breakdowns): the seed that replays it. */
  live_seed?: number | null;
  /** Set when the session runs with vehicle dynamics (Explore_hardware probe). */
  dynamics?: DynamicsSessionInfo | null;
}

/** A station (stop) derived from the trains' origins and targets. The `label`
 *  is the single shared identifier used both by the map station layer and the
 *  timetable tile, so a stop on the map can be matched to a row in the schedule. */
/** A scene's geography (`GET /session/{id}/hmi/geography`): named platform
 *  cells, named places along the line by column, and the single-track section.
 *  Empty lists for a generated network. */
export interface SceneGeography {
  /** `corridor`: a scene whose places line up along one line (column = position);
   *  `network`: named cells of a network without a single line (Olten's sidecar);
   *  absent when nothing is named. */
  layout?: 'corridor' | 'network';
  stations: {
    code: string | null;
    name: string;
    track: number | null;
    cell: [number, number];
    /** Network sidecars only: platform, intermediate stop or line portal. */
    kind?: 'platform' | 'stop' | 'portal';
    /** Portals: the line they lead onto, e.g. "Hauenstein-Basistunnel". */
    via?: string;
  }[];
  locations: { code: string; name: string; col: number }[];
  single_track: string[];
}

/** `GET /hmi/plan` — the baseline timetable cell by cell (steps). The Soll of
 *  the Zug-Weg-Diagramm; stays the timetable even after an accepted replan. */
export interface PlanResponse {
  hasPlan: boolean;
  trainruns: { [handle: string]: { step: number; row: number; col: number }[] };
}

/** `GET /hmi/route-axis` — a time-distance axis between two stations
 *  (docs/plans/zug-weg-route-selection.md). `pos` counts cells from `from`. */
export interface RouteAxisResponse {
  from: string;
  to: string;
  /** Null when `to` cannot be reached from `from`. */
  length: number | null;
  cells: [number, number, number][];
  stations: (SceneGeography['stations'][number] & { pos: number })[];
  /** One per named place on the route; `col` only for track-less places. */
  ticks: { code: string; name: string; kind: string | null; pos: number; col?: number }[];
}

/** One strategy for a contention (`GET /hmi/contention-strategies`). */
export interface ContentionStrategy {
  /** 'keep' | 'policy:<id>' | 'pp' | 'pp-human'. */
  id: string;
  kind: 'keep' | 'policy' | 'pp';
  policy?: string;
  /** PP only: the priority order of the contending trains it was solved for. */
  priority?: number[];
  metrics: { lateness: number; lateTrains: number; notArrivedDue: number; deadlocks: number; arrived: number; score: number };
  /** Order in which the contending trains enter the contended cells. */
  passOrder: number[];
  /** Lateness saved against 'keep', in steps (negative = costs time). */
  lateSavedSteps: number;
}

export interface ContentionStrategiesResponse {
  step: number;
  horizonSteps: number;
  handles: number[];
  location?: { kind: string; name: string | null; cell: [number, number] | null } | null;
  recommended?: string;
  confidence?: 'high' | 'medium' | 'low';
  strategies: ContentionStrategy[];
}

export interface StationRef {
  /** Stable cell key "row,col". */
  id: string;
  /** Human-facing short label, e.g. "S1". */
  label: string;
  row: number;
  col: number;
}

/** One scripted disturbance a scenario offers: what goes wrong, and when.
 *  Any subset can be selected at session start, including none (the control
 *  condition). See backend `app/core/disturbances.py`. */
export interface ScenarioDisturbance {
  id: string;
  name: string;
  description: string;
}

/** A prebuilt scenario preset (e.g. an ECML 2026 scene) offered in the picker. */
export interface ScenarioPreset {
  id: string;
  name: string;
  width: number;
  height: number;
  agents: number;
  source?: string;
  /** True when the scenario ships a plan: every train's exact route and
   *  timing. Such a session runs the plan from its first step. */
  has_plan?: boolean;
  /** Scripted disturbances offered alongside the scenario; empty if none. */
  disturbances?: ScenarioDisturbance[];
  network?: string;
  traffic?: string;
  disruption?: string;
  description?: string;
  available_modes?: Array<'recommendation' | 'co-learning' | 'director'>;
}

export interface StepResponse {
  session_id: string;
  elapsed_steps: number;
  rewards?: Record<string, unknown>;
  dones?: Record<string, unknown>;
  all_done?: boolean;
  episode_done?: boolean;
  message?: string;
}

export interface PlayRequest {
  speed?: number;
  policy?: PolicyName;
}

export interface DecisionCell {
  r: number;
  c: number;
  kind: 'switch' | 'merge';
  directions?: number[]; // 0=N, 1=E, 2=S, 3=W (incoming)
  switch_exits?: number[];   // for SWITCH cells: directions a train can leave by
}

/** MARL lab (docs/plans/marl-lab-plan.md, step 4): the learned policy's choice
 *  where a train next decides — `GET /session/{id}/lab/ai-choice/{handle}`. */
export interface LabAiChoice {
  available: boolean;
  reason?: 'not-learned' | 'no-decision' | 'not-reached';
  handle?: number;
  step?: number;
  stepsAhead?: number;
  decisionPosition?: [number, number];
  /** RailEnvActions value: 0 do nothing, 1 left, 2 forward, 3 right, 4 stop. */
  action?: number;
  /** Summed over the raw actions that lead onto the same option. */
  probability?: number | null;
  optionProbabilities?: Record<string, number>;
  /** The policy's raw distribution over the five actions. */
  probabilities?: number[];
  overridden?: boolean;
  policy?: string;
}

/** One outcome row of the AI Track Record, rolled to the episode end. */
export interface LabOutcome {
  id: 'with-you' | 'ai-alone' | 'previous-checkpoint';
  policy: string;
  fromStep?: number;
  arrived: number;
  trains: number;
  lateness: number;
  deadlocks: number;
  endStep: number;
}

/** `GET /session/{id}/lab/review` — widget A3, first cut. */
export interface LabReview {
  available: boolean;
  learned: boolean;
  policy: string;
  step: number;
  interventions: number;
  agreed: number;
  agreementRate: number | null;
  ratePer100Steps: number;
  sinceStep: number | null;
  byMode: Record<string, { interventions: number; agreed: number }>;
  choices: { total: number; keptAi: number; followedRecommendation: number };
  outcomes: LabOutcome[];
  originStep: number | null;
  outcomeError?: string;
}

/** Vehicle dynamics of one train (docs/plans/train-dynamics-probe.md). */
export interface AgentDynamics {
  speedKmh: number;
  accelerationMs2: number;
  maxSpeedKmh: number;
  braking: boolean;
  /** From the train's end to its reservation point (front + braking distance). */
  occupiedCells: [number, number][];
}

export interface DynamicsSessionInfo {
  timeStepS: number;
  cellLengthM: number;
  lineSpeedKmh: number;
  trainLengthM: number;
  brakingMs2: number;
}
