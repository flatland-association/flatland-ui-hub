/**
 * The playable Event Simulation sandbox (step 8) — the backend side is
 * `backend/app/api/sandbox.py`. A checkpoint is a fork of the episode kept at a
 * decision moment; an option is played from it to the end of the episode.
 *
 * Outcomes have the shape of a precomputed sandbox variant
 * (`sandbox-outcomes.ts`), so played and precomputed variants read alike.
 */

import { SandboxTrainOutcome } from './sandbox-outcomes';

export type SandboxOption = 'hold_until' | 'hold' | 'proceed' | 'reroute';

export interface SandboxItem {
  handle: number;
  blocked_by: number | null;
  clears_in_steps: number;
  can_reroute: boolean;
}

export interface SandboxCheckpoint {
  id: number;
  step: number;
  /** What the impact analysis listed at that moment. */
  items: SandboxItem[];
  /** 'decision': kept during the shift; 'test': a case never played, added to
   *  check a rule (`POST /sandbox/case`). */
  kind: 'decision' | 'test';
  /** For a test case, the disruption it was built from. */
  case: string | null;
}

export interface SandboxOutcome {
  arrived: number;
  total: number;
  /** Summed delay against the plan, over the trains that arrived. */
  totalDelayVsPlan: number;
  deadlocks: number;
  trains: SandboxTrainOutcome[];
}

export interface SandboxState {
  session_id: string;
  checkpoints: SandboxCheckpoint[];
  /** The run as it was played; completed by simulation if the shift ended early. */
  played: SandboxOutcome;
  played_completed_by_simulation: boolean;
  plan_arrival_steps: Record<string, number>;
}

export interface SandboxRunResult {
  checkpoint: number;
  step: number;
  handle: number;
  option: SandboxOption;
  release_step: number | null;
  outcome: SandboxOutcome;
}
