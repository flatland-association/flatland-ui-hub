import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { SessionStore } from '../session.store';
import { CurrentDelayService } from '../timetable/current-delay.service';
import { TrainActionService } from './train-action.service';

/** Flatland STOP_MOVING: hold the train where it is. */
export const HOLD_ACTION = 4;
/** Steps after release before the outcome is read against the expectation. */
export const OUTCOME_STEPS = 5;

export type StagedAction = 'hold' | 'proceed';
export type DelayExpectation = 'less' | 'same' | 'more';

export interface StagedDisposition {
  id: number;
  handle: number;
  action: StagedAction;
  expectation: DelayExpectation | null;
  stagedAt: number;
  releasedAt: number | null;
  /** Delay (minutes) when released. */
  delayAtRelease: number | null;
  /** Last delay (minutes) seen since release; kept when the train arrives. */
  delayLatest: number | null;
}

/**
 * Dispositions prepared before they act: stage, state an expectation, release.
 * Release goes through TrainActionService (origin `staged`), so the decision
 * log and the backend see a normal override. Browser-only; reset per session.
 * Spec: docs/plans/widget-staged-dispositions.md.
 */
@Injectable({ providedIn: 'root' })
export class StagedDispositionService {
  private readonly store = inject(SessionStore);
  private readonly delays = inject(CurrentDelayService);
  private readonly actions = inject(TrainActionService);

  readonly entries = signal<StagedDisposition[]>([]);
  private nextId = 1;
  private sessionId: string | null = null;

  constructor() {
    effect(() => {
      const sid = this.store.session()?.id ?? null;
      untracked(() => {
        if (sid === this.sessionId) return;
        this.sessionId = sid;
        this.entries.set([]);
      });
    });
    effect(() => {
      const minutes = this.delays.minutes();
      untracked(() => {
        if (!this.entries().some((e) => e.releasedAt != null)) return;
        this.entries.update((list) =>
          list.map((e) => {
            const m = minutes.get(e.handle);
            return e.releasedAt != null && m != null && m !== e.delayLatest ? { ...e, delayLatest: m } : e;
          }),
        );
      });
    });
  }

  stage(handle: number, action: StagedAction): void {
    this.entries.update((list) => [
      ...list.filter((e) => !(e.handle === handle && e.releasedAt == null)),
      {
        id: this.nextId++,
        handle,
        action,
        expectation: null,
        stagedAt: this.store.elapsedSteps(),
        releasedAt: null,
        delayAtRelease: null,
        delayLatest: null,
      },
    ]);
  }

  setExpectation(id: number, expectation: DelayExpectation): void {
    this.entries.update((list) => list.map((e) => (e.id === id ? { ...e, expectation } : e)));
  }

  discard(id: number): void {
    this.entries.update((list) => list.filter((e) => e.id !== id || e.releasedAt != null));
  }

  release(id: number): void {
    const entry = this.entries().find((e) => e.id === id);
    if (!entry || entry.releasedAt != null) return;
    if (entry.action === 'hold') this.actions.set(entry.handle, HOLD_ACTION, 'staged');
    else this.actions.clear(entry.handle, 'staged');
    const delay = this.delays.minutes().get(entry.handle) ?? 0;
    const now = this.store.elapsedSteps();
    this.entries.update((list) =>
      list.map((e) => (e.id === id ? { ...e, releasedAt: now, delayAtRelease: delay, delayLatest: delay } : e)),
    );
  }

  /** True once any released entry carries an expectation (tour guide step). */
  hasReleasedExpectation(): boolean {
    return this.entries().some((e) => e.releasedAt != null && e.expectation != null);
  }
}

/** The observed direction of the delay since release, or null while still observing. */
export function observedOutcome(e: StagedDisposition, now: number): DelayExpectation | null {
  if (e.releasedAt == null || e.delayAtRelease == null || e.delayLatest == null) return null;
  if (now - e.releasedAt < OUTCOME_STEPS) return null;
  const diff = e.delayLatest - e.delayAtRelease;
  return diff < 0 ? 'less' : diff > 0 ? 'more' : 'same';
}
