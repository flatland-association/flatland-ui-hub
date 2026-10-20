import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import { TourContextService } from './demo/tour-context.service';
import { OnlineLearningStatus } from './models';
import { SessionStore } from './session.store';

/** The id the stable version of the online learner is offered under. */
export const ONLINE_POLICY_ID = 'lab:online-ppo';

/** How a tour wants the learner started (`TourBriefing.onlineLearning`). */
export interface OnlineLearningTourConfig {
  init: 'scratch' | 'ecml';
  scenarios: string[];
  evalScenarios: string[];
  minRolloutSteps?: number;
  learningRate?: number;
}

export type OnlineLearningScope = 'scenario' | 'generated';

const POLL_MS = 2000;
const BANNER_MS = 8000;
/** Generated networks added to a single-scenario evaluation, so a version
 *  that only memorises one scenario is not taken for better. */
const GUARD_EVAL = ['gen:30x30:3:101', 'gen:30x30:3:102'];

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
  private readonly tour = inject(TourContextService);

  readonly status = signal<OnlineLearningStatus | null>(null);
  /** Set for a few seconds after the stable version changed. */
  readonly updatedTo = signal<number | null>(null);
  readonly tourConfig = computed<OnlineLearningTourConfig | null>(() => this.tour.briefing()?.onlineLearning ?? null);

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
      next: (s) => this.receive(s),
      error: () => {},
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

  /** The config sent to the backend: the tour's, or one built from the choice. */
  configFor(init: 'scratch' | 'ecml', scope: OnlineLearningScope): Record<string, unknown> {
    const tour = this.tourConfig();
    if (tour) {
      return {
        scenarios: tour.scenarios,
        eval_scenarios: tour.evalScenarios,
        ...(tour.minRolloutSteps ? { min_rollout_steps: tour.minRolloutSteps } : {}),
        ...(tour.learningRate ? { learning_rate: tour.learningRate } : {}),
      };
    }
    // Fine-tuning a trained policy wants smaller, more frequent steps.
    const finetune = init === 'ecml' ? { min_rollout_steps: 1024, learning_rate: 1e-4 } : {};
    const preset = this.store.session()?.scenario_preset_id;
    if (scope === 'scenario' && preset) {
      return { scenarios: [preset], eval_scenarios: [preset, ...GUARD_EVAL], ...finetune };
    }
    return finetune;
  }

  start(init: 'scratch' | 'ecml', scope: OnlineLearningScope): Observable<unknown> {
    const tourInit = this.tourConfig()?.init;
    return this.api.startOnlineLearning(tourInit ?? init, this.configFor(tourInit ?? init, scope));
  }

  control(command: 'pause' | 'resume' | 'stop'): Observable<unknown> {
    return this.api.controlOnlineLearning(command);
  }
}
