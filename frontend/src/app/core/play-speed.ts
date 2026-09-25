/**
 * Play tempo levels. The UI shows an abstract 1–5 scale; the backend play
 * loop takes steps per second. «Normal» (3 steps/s) is the default; there
 * is one slow level below it and three faster ones above.
 */
export const PLAY_SPEED_STEPS_PER_SECOND = [0.5, 3, 5, 10, 20] as const;
export const PLAY_SPEED_MIN_LEVEL = 1;
export const PLAY_SPEED_MAX_LEVEL = PLAY_SPEED_STEPS_PER_SECOND.length;
export const PLAY_SPEED_DEFAULT_LEVEL = 2;

export function clampPlaySpeedLevel(level: number): number {
  if (!Number.isFinite(level)) return PLAY_SPEED_DEFAULT_LEVEL;
  return Math.min(PLAY_SPEED_MAX_LEVEL, Math.max(PLAY_SPEED_MIN_LEVEL, Math.round(level)));
}

export function playSpeedForLevel(level: number): number {
  return PLAY_SPEED_STEPS_PER_SECOND[clampPlaySpeedLevel(level) - 1];
}
