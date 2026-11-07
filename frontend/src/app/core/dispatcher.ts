export type DispatcherOperatorType = 'human' | 'synthetic_dispatcher' | 'human_dispatcher_team';

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
  weights?: Directive; phase?: string;
}
export interface DispatcherDecision {
  command_id: string; generation: number; observed_at: number; due: number;
  command: DispatcherCommand; reason: { rule: string; fallback: string | null };
}
export interface DispatcherEvent {
  seq: number; kind: string; source: string; logical_time: number; simulation_time: number;
  decision?: DispatcherDecision;
  result?: { status: string; reason: string };
  command_id?: string; weights?: number[]; phase?: string;
}
export interface DispatcherState {
  mode: 'recommendation' | 'co-learning' | 'director';
  operator_type: string; owner: 'human' | 'synthetic'; profile: DispatcherProfile;
  config: DispatcherConfig; status: string; logical_time: number; generation: number;
  run_status: string; abort_reason: string | null;
  requires_approval?: boolean; awaiting_approval?: boolean; approved_command_id?: string | null;
  pending: DispatcherDecision | null; observation: { open_decisions: number; handles?: number[] } | null;
  metrics: Record<string, number | number[] | null>;
  events: DispatcherEvent[];
}

export interface DispatcherDemo { scenario_preset_id: string; disturbance_ids: string[]; }
export interface PreparedDispatcherDemo extends DispatcherDemo {
  operator_type?: DispatcherOperatorType;
  interaction_mode: 'recommendation' | 'director'; dispatcher: DispatcherConfig;
  seed: number; open_at_step: number; play_speed_level: number;
}
