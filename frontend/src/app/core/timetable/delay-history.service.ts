import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { SessionStore } from '../session.store';
import { CurrentDelayService } from './current-delay.service';

/** One sample: a train's delay in minutes at an elapsed step. */
export interface DelaySample {
  step: number;
  minutes: number;
}

export type DelayTrend = 'growing' | 'stable' | 'shrinking';

/** Steps compared for the trend: delay now against delay this many steps ago. */
export const TREND_WINDOW = 5;
const MAX_SAMPLES = 120;

/**
 * Each train's current delay (CurrentDelayService) recorded per elapsed step,
 * so widgets can show whether a deviation grows. Browser-only: it starts when
 * the session is loaded, drops samples past `now` on a seek-back, and resets on
 * a new session.
 */
@Injectable({ providedIn: 'root' })
export class DelayHistoryService {
  private readonly store = inject(SessionStore);
  private readonly delays = inject(CurrentDelayService);

  readonly history = signal<Map<number, DelaySample[]>>(new Map());
  private sessionId: string | null = null;

  constructor() {
    effect(() => {
      const sid = this.store.session()?.id ?? null;
      const step = this.store.elapsedSteps();
      const minutes = this.delays.minutes();
      untracked(() => this.record(sid, step, minutes));
    });
  }

  private record(sid: string | null, step: number, minutes: Map<number, number>): void {
    if (sid !== this.sessionId) {
      this.sessionId = sid;
      this.history.set(new Map());
    }
    if (!sid || minutes.size === 0) return;
    const next = new Map<number, DelaySample[]>();
    for (const [h, samples] of this.history()) {
      next.set(h, samples.filter((s) => s.step < step));
    }
    for (const [h, m] of minutes) {
      const samples = next.get(h) ?? [];
      samples.push({ step, minutes: m });
      next.set(h, samples.slice(-MAX_SAMPLES));
    }
    this.history.set(next);
  }

  /** Trend per train: delay now against the sample TREND_WINDOW steps back. */
  readonly trends = computed(() => {
    const out = new Map<number, DelayTrend>();
    for (const [h, samples] of this.history()) {
      out.set(h, trendOf(samples));
    }
    return out;
  });
}

export function trendOf(samples: DelaySample[]): DelayTrend {
  if (samples.length < 2) return 'stable';
  const last = samples[samples.length - 1];
  const ref = [...samples].reverse().find((s) => s.step <= last.step - TREND_WINDOW) ?? samples[0];
  if (last.minutes > ref.minutes) return 'growing';
  if (last.minutes < ref.minutes) return 'shrinking';
  return 'stable';
}
