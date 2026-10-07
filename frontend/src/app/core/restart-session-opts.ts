import type { SessionStore } from './session.store';

export type NewSessionOpts = NonNullable<Parameters<SessionStore['newSession']>[0]>;

/** How the running session was created, kept so "Restart run" can recreate it. */
export interface LastSessionStart {
  opts: NewSessionOpts;
  /** A random env built from the Settings fields, as opposed to a pinned world
   *  (scenario preset, saved scene, Guided Demo Environment). */
  randomEnv: boolean;
}

/**
 * The options "Restart run" creates the next session with.
 *
 * A pinned world — a tour's scenario preset with its disruptions, open step
 * and (live variant) seed, a saved scene, the Guided Demo Environment — is
 * restarted as it was started. Only a random env is rebuilt from the Settings
 * fields, which the Settings panel promises take effect from the next restart.
 * The AI policies always follow the current selection, and the play speed is
 * left where the person set it.
 */
export function restartSessionOpts(last: LastSessionStart | null, fromSettings: NewSessionOpts): NewSessionOpts {
  if (!last || last.randomEnv) return fromSettings;
  const { playSpeedLevel: _speed, ...opts } = last.opts;
  return {
    ...opts,
    strategyIds: fromSettings.strategyIds,
    policyControlIds: fromSettings.policyControlIds,
  };
}
