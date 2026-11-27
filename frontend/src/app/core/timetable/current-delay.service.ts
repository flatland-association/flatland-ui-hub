import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from '../api.service';
import { MINUTES_PER_STEP } from '../combined-actions/combined-actions-preview';
import { SessionStore } from '../session.store';
import { PlannedCell, currentDelaySteps } from './current-delay';

/**
 * The session's baseline timetable (loaded once per session) and every train's
 * current delay in minutes against it. Shared, so the time-distance diagram and
 * the track diagram label a train with the same number.
 */
@Injectable({ providedIn: 'root' })
export class CurrentDelayService {
  private readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);

  /** Baseline timetable per train, cell by cell (`/hmi/plan`); empty until loaded. */
  readonly plan = signal<Map<number, PlannedCell[]>>(new Map());
  private planSession: string | null = null;

  constructor() {
    effect(() => {
      const sid = this.store.session()?.id ?? null;
      untracked(() => {
        if (sid === this.planSession) return;
        this.planSession = sid;
        this.plan.set(new Map());
        if (!sid) return;
        this.api.getPlan(sid).subscribe({
          next: (resp) => {
            if (this.planSession !== sid) return;
            const m = new Map<number, PlannedCell[]>();
            for (const [h, run] of Object.entries(resp.trainruns ?? {})) {
              m.set(Number(h), run.map((e) => ({ step: e.step, row: e.row, col: e.col })));
            }
            this.plan.set(m);
          },
          error: () => {},
        });
      });
    });
  }

  /** Minutes late now per train handle; absent when there is nothing to measure. */
  readonly minutes = computed(() => {
    const plan = this.plan();
    const out = new Map<number, number>();
    if (plan.size === 0) return out;
    const now = this.store.elapsedSteps();
    const traj = this.store.trajectories();
    for (const a of this.store.agents()) {
      const run = plan.get(a.handle);
      if (!run) continue;
      const late = currentDelaySteps(run, traj.get(a.handle) ?? [], a.position, a.state, now);
      if (late != null) out.set(a.handle, late * MINUTES_PER_STEP);
    }
    return out;
  });

  /** "+5" (steps) for a late train, "0" when on time (early running is not
   *  shown), '' when there is nothing to measure — the label suffix. No unit
   *  sign: times are steps, and the ZWL says so at its axis
   *  (docs/plans/plan-b-small-changes.md, item 8; plan-b-round2-general.md,
   *  item 1). */
  label(handle: number): string {
    return delayLabel(this.minutes().get(handle));
  }
}

/** The label for a delay in steps: "+n" when late, "0" when on time, '' when
 *  unknown. */
export function delayLabel(late: number | null | undefined): string {
  if (late == null) return '';
  return late > 0 ? `+${late}` : '0';
}
