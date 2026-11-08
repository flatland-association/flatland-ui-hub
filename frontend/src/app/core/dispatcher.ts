import type { ContentionStrategiesResponse } from './models';

export type DispatcherOperatorType = 'human' | 'synthetic_dispatcher' | 'human_dispatcher_team';

export type PreparedDispatcherDemoKey = 'recommendation' | 'director' | 'team' | 'shift' | 'shift-team';

export type DispatcherProfile = 'baseline' | 'delayed' | 'priority' | 'goal-switch';
export interface Directive { punctuality: number; connections: number; stability: number; }
export interface DispatcherConfig {
  profile: DispatcherProfile;
  delay: number;
  priority: number[];
  objective: keyof Directive;
  initial: Directive;
  switched: Directive;
  switch_at: number;
}
export const DEFAULT_DISPATCHER: DispatcherConfig = {
  profile: 'baseline', delay: 3, priority: [], objective: 'punctuality',
  initial: { punctuality: 1, connections: 1, stability: 1 },
  switched: { punctuality: 5, connections: 1, stability: 1 }, switch_at: 10,
};
export interface DispatcherCommand {
  kind: 'strategy' | 'directive'; strategy?: string; handles?: number[];
  contention_id?: string; situation?: string;
  weights?: Directive; phase?: string;
}
export interface DispatcherForecastReference {
  source: 'plan' | 'latest_arrival' | 'unavailable'; reference_steps: Record<string, number>;
}
export interface DispatcherExplanation {
  kind: 'forecast_comparison' | 'director_objective'; rule: string; fallback: string | null;
  contention_id?: string; location?: Record<string, unknown> | null; horizon_steps?: number; forecast_step?: number | null; conflict_step?: number | null;
  forecast_reference?: DispatcherForecastReference;
  selected_strategy?: string; baseline_metrics?: Record<string, number | null>;
  selected_metrics?: Record<string, number | null>; forecast_delta?: Record<string, number | null>; weights?: number[];
}
export interface DispatcherQueueEntry {
  contention_id: string; handles: number[]; location: Record<string, unknown> | null;
  forecast_step: number | null; status: 'pending' | 'answered' | 'queued' | 'unavailable';
}
export interface DispatcherObservedMetrics {
  arrived: number; simulation_steps: number; total_arrival_delay: number | null; delay_denominator: number;
}
export interface DispatcherEffect {
  command_id: string; contention_id?: string; scope: 'observed_since_command'; causal_claim: false;
  before: DispatcherObservedMetrics; after: DispatcherObservedMetrics; delta: DispatcherObservedMetrics;
  intervening_commands: number;
  contention_observation?: { status: 'visible' | 'not_visible'; simulation_time: number };
}
export interface DispatcherDecision {
  command_id: string; generation: number; observed_at: number; due: number;
  explanation?: DispatcherExplanation; offer?: ContentionStrategiesResponse; elapsed_ms?: number;
  command: DispatcherCommand; reason: { rule: string; fallback: string | null };
}
export interface DispatcherEvent {
  elapsed_ms?: number;
  seq: number; kind: string; source: string; logical_time: number; simulation_time: number;
  decision?: DispatcherDecision;
  result?: { status: string; reason: string };
  command_id?: string; weights?: number[]; phase?: string;
}
export interface DispatcherState {
  mode: 'recommendation' | 'co-learning' | 'director';
  operator_type: string; owner: 'human' | 'synthetic'; profile: DispatcherProfile;
  config: DispatcherConfig; status: string; logical_time: number; generation: number;
  elapsed_ms?: number;
  arrival_reference_source?: 'authored_plan' | 'latest_arrival' | 'unavailable';
  run_status: string; abort_reason: string | null;
  requires_approval?: boolean; awaiting_approval?: boolean; approved_command_id?: string | null;
  pending: DispatcherDecision | null; observation: { open_decisions: number; handles?: number[] } | null;
  metrics: Record<string, number | number[] | null>;
  last_result?: DispatcherEvent | null; last_effective?: DispatcherEvent | null;
  queue?: DispatcherQueueEntry[]; effects?: DispatcherEffect[];
  events: DispatcherEvent[];
}

export interface DispatcherDemo { scenario_preset_id: string; disturbance_ids: string[]; }
export interface PreparedDispatcherDemo extends DispatcherDemo {
  operator_type?: DispatcherOperatorType;
  interaction_mode: 'recommendation' | 'director'; dispatcher: DispatcherConfig;
  max_episode_steps?: number; malfunction_rate?: number;
  seed: number; open_at_step: number; play_speed_level: number;
}
