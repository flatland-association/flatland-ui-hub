/**
 * Play tempo levels. The UI shows an abstract 1–5 scale; the backend play
 * loop takes steps per second, and one step is one minute.
 *
 * «Normal» is 0.5 steps/s — one minute every two seconds. That is the pace at
 * which a person can follow the situation and step in (decided 2026-09-27).
 * With smooth train motion (PR #101, docs/plans/smooth-playback.md) it no
 * longer reads as jerky. One slower level sits below it for reading a tight
 * spot, three faster ones above it for skipping calm phases.
 *
 * The levels are factors of a base pace, the speed of «normal». An experiment
 * scenario may set its own (`seconds_per_step` in its `scenario.json`); the
 * other levels then keep their ratio to it
 * (docs/plans/experiment-scenario-import.md §3.8).
 */
/** Steps per second at «normal» unless the scenario sets its own pace. */
export const PLAY_SPEED_DEFAULT_BASE = 0.5;
/** Each level's speed as a multiple of the base: 0.25, 0.5, 1, 3, 10 steps/s by default. */
export const PLAY_SPEED_FACTORS = [0.5, 1, 2, 6, 20] as const;
export const PLAY_SPEED_MIN_LEVEL = 1;
export const PLAY_SPEED_MAX_LEVEL = PLAY_SPEED_FACTORS.length;
export const PLAY_SPEED_DEFAULT_LEVEL = 2;

export function clampPlaySpeedLevel(level: number): number {
  if (!Number.isFinite(level)) return PLAY_SPEED_DEFAULT_LEVEL;
  return Math.min(PLAY_SPEED_MAX_LEVEL, Math.max(PLAY_SPEED_MIN_LEVEL, Math.round(level)));
}

/** Steps per second at a level, for a base pace (steps per second at «normal»). */
export function playSpeedForLevel(level: number, base: number = PLAY_SPEED_DEFAULT_BASE): number {
  return PLAY_SPEED_FACTORS[clampPlaySpeedLevel(level) - 1] * base;
}

/** The base pace of a scenario with `seconds_per_step`, else the default. */
export function playSpeedBaseFor(secondsPerStep: number | null | undefined): number {
  return secondsPerStep != null && secondsPerStep > 0 ? 1 / secondsPerStep : PLAY_SPEED_DEFAULT_BASE;
}
