/**
 * Play tempo levels. The UI shows an abstract 1–5 scale; the backend play
 * loop takes steps per second, and one step is one minute.
 *
 * «Normal» (level 2) is 0.5 steps/s — one minute every two seconds — for
 * decision-heavy runs. The interactive default is level 4 (3 steps/s);
 * single-mode Director tours opt back into Normal to leave time for planning.
 */
export const PLAY_SPEED_STEPS_PER_SECOND = [0.25, 0.5, 1, 3, 10] as const;
export const PLAY_SPEED_MIN_LEVEL = 1;
export const PLAY_SPEED_MAX_LEVEL = PLAY_SPEED_STEPS_PER_SECOND.length;
export const PLAY_SPEED_DEFAULT_LEVEL = 4;

export function clampPlaySpeedLevel(level: number): number {
  if (!Number.isFinite(level)) return PLAY_SPEED_DEFAULT_LEVEL;
  return Math.min(PLAY_SPEED_MAX_LEVEL, Math.max(PLAY_SPEED_MIN_LEVEL, Math.round(level)));
}

export function playSpeedForLevel(level: number): number {
  return PLAY_SPEED_STEPS_PER_SECOND[clampPlaySpeedLevel(level) - 1];
}
