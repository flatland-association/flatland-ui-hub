import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { OnlineLearningSettings, OnlineLearningStatus } from './models';
import { SessionStore } from './session.store';

/** The id the stable version of the online learner is offered under. */
export const ONLINE_POLICY_ID = 'lab:online-ppo';

const POLL_MS = 2000;
const BANNER_MS = 8000;

/**
 * The online learner's state, shared by the Learning Monitor panel and the tour
 * guide (docs/plans/online-ppo-learning.md). Polls only while someone uses it.
 * When a new stable version is published, the session's policy picker learns
 * about `lab:online-ppo` — a checkpoint that may not have existed when the
 * session started.
 */
@Injectable({ providedIn: 'root' })
export class OnlineLearningService {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);

  readonly status = signal<OnlineLearningStatus | null>(null);
  readonly statusError = signal(false);
  /** Set for a few seconds after the stable version changed. */
  readonly updatedTo = signal<number | null>(null);

  private users = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRun: string | null = null;
  private lastStable: number | null = null;
  private adopted = '';

  /** Start polling; call the returned function to stop using it. */
  use(): () => void {
    this.users += 1;
    if (!this.timer) {
      this.poll();
      this.timer = setInterval(() => this.poll(), POLL_MS);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users -= 1;
      if (this.users <= 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  poll(): void {
    this.api.getOnlineLearningStatus().subscribe({
      next: (s) => {
        this.statusError.set(false);
        this.receive(s);
      },
      error: () => this.statusError.set(true),
    });
  }

  private receive(s: OnlineLearningStatus): void {
    const stable = s.stable_version ?? null;
    const run = s.run_id ?? null;
    if (run && run === this.lastRun && stable != null && this.lastStable != null && stable > this.lastStable) {
      this.updatedTo.set(stable);
      if (this.bannerTimer) clearTimeout(this.bannerTimer);
      this.bannerTimer = setTimeout(() => this.updatedTo.set(null), BANNER_MS);
    }
    // Every published version (v0 included) may be new to this session.
    const key = `${run}:${stable}`;
    if (run && stable != null && key !== this.adopted) {
      this.adopted = key;
      this.store.adoptPolicy(ONLINE_POLICY_ID);
    }
    this.lastRun = run;
    this.lastStable = stable;
    this.status.set(s);
  }

  updateSettings(
    settings: Pick<OnlineLearningSettings, 'learning_sources' | 'comparison_policies'>,
  ): Observable<OnlineLearningSettings> {
    return this.api.updateOnlineLearningSettings(settings);
  }

  resetToScratch(): Observable<unknown> {
    return this.api.resetOnlineLearningToScratch();
  }
}
