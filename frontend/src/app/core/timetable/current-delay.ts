/**
 * A train's delay *now*, against the timetable the session started from — the
 * "+12" a dispatcher reads next to a train number in the time-distance
 * diagram and on the track diagram.
 *
 * Not `AgentDTO.delay`: that one stays 0 until a train has overrun the
 * deadline at its *final* stop. Framework-free so the map and the
 * time-distance diagram show the same number.
 */

/** One planned cell entry of the baseline timetable (`/hmi/plan`). */
export interface PlannedCell {
  step: number;
  row: number;
  col: number;
}

/** One compressed run of the executed trajectory (`SessionStore.trajectories`). */
export interface ExecutedCell {
  step: number;
  endStep?: number;
  position: [number, number] | null;
}

/**
 * Late steps now, or null when there is nothing to measure against: the train
 * has arrived, the scenario has no timetable, or the train stands on a cell its
 * timetable never uses (rerouted off its planned path).
 *
 * - Not yet on the map: late departure, `now` past the planned first step.
 * - On the map: the larger of how late it *entered* its current cell and how
 *   far it has overstayed the planned time to leave it. So a train that arrived
 *   five minutes late keeps "+5" while it dwells, and a train held at a signal
 *   gains a minute with every minute it stands.
 * - Early running is not shown: never below zero.
 */
export function currentDelaySteps(
  plan: readonly PlannedCell[],
  executed: readonly ExecutedCell[],
  position: readonly [number, number] | null,
  state: string,
  now: number,
): number | null {
  if (state === 'DONE' || plan.length === 0) return null;
  if (!position) return Math.max(0, now - plan[0].step);

  const [row, col] = position;
  // The planned visit of this cell closest to now — a line may pass a cell twice.
  let best = -1;
  for (let i = 0; i < plan.length; i++) {
    if (plan[i].row !== row || plan[i].col !== col) continue;
    if (best < 0 || Math.abs(plan[i].step - now) < Math.abs(plan[best].step - now)) best = i;
  }
  if (best < 0) return null;
  const plannedEntry = plan[best].step;
  const plannedLeave = plan[best + 1]?.step ?? plannedEntry;

  let enteredAt = now;
  for (let i = executed.length - 1; i >= 0; i--) {
    const p = executed[i].position;
    if (executed[i].step > now) continue;
    if (!p || p[0] !== row || p[1] !== col) break;
    enteredAt = executed[i].step;
  }
  return Math.max(0, enteredAt - plannedEntry, now - plannedLeave);
}
