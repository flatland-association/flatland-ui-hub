import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, Input, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiService } from '../../core/api.service';
import { OnlineLearningStatus, OnlineVersionEntry } from '../../core/models';

/**
 * Learning monitor — the online PPO learner (docs/plans/online-ppo-learning.md).
 *
 * Shows that the learning policy is being updated: its state, the stable
 * version the hub offers as `lab:online-ppo`, the rollout progress towards the
 * next update, the five buffers and the version history with each candidate's
 * evaluation against the last stable version and the baseline. When the stable
 * version changes it says so. Start, pause, resume and stop the learner here.
 *
 * The same in every mode: the learner is a policy among equals and changes no
 * mode's behaviour, so there is nothing to frame per mode.
 */
const POLL_MS = 2000;
const BANNER_MS = 8000;

export const BUFFER_ORDER = [
  'ppo_rollout_buffer',
  'multi_policy_prediction_buffer',
  'user_interaction_buffer',
  'counterfactual_evaluation_buffer',
  'distillation_buffer',
] as const;

@Component({
  selector: 'app-online-learning',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './online-learning.component.html',
  styleUrl: './online-learning.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class OnlineLearningComponent {
  @Input() embedded = false;

  private readonly api = inject(ApiService);
  readonly status = signal<OnlineLearningStatus | null>(null);
  readonly init = signal<'scratch' | 'ecml'>('scratch');
  readonly busy = signal(false);
  readonly requestError = signal<string | null>(null);
  /** Set for a few seconds after the stable version changed. */
  readonly updatedTo = signal<number | null>(null);

  readonly bufferOrder = BUFFER_ORDER;
  readonly running = computed(() => ['running', 'updating', 'starting'].includes(this.status()?.state ?? ''));
  readonly paused = computed(() => this.status()?.state === 'paused');
  readonly canStart = computed(() => !this.status()?.alive && (this.status()?.available ?? false));

  readonly rolloutPercent = computed(() => {
    const p = this.status()?.rollout_progress;
    return p && p[1] > 0 ? Math.min(100, Math.round((100 * p[0]) / p[1])) : 0;
  });

  /** Newest first. */
  readonly history = computed<OnlineVersionEntry[]>(() => [...(this.status()?.history ?? [])].reverse().slice(0, 8));

  private lastStable: number | null = null;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.poll();
    const timer = setInterval(() => this.poll(), POLL_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      if (this.bannerTimer) clearTimeout(this.bannerTimer);
    });
  }

  private poll(): void {
    this.api.getOnlineLearningStatus().subscribe({
      next: (s) => {
        const stable = s.stable_version ?? null;
        if (stable != null && this.lastStable != null && stable > this.lastStable && s.run_id === this.status()?.run_id) {
          this.showUpdated(stable);
        }
        this.lastStable = stable;
        this.status.set(s);
      },
      error: () => {},
    });
  }

  private showUpdated(version: number): void {
    this.updatedTo.set(version);
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => this.updatedTo.set(null), BANNER_MS);
  }

  start(): void {
    this.run(this.api.startOnlineLearning(this.init()));
  }

  control(command: 'pause' | 'resume' | 'stop'): void {
    this.run(this.api.controlOnlineLearning(command));
  }

  private run(req: ReturnType<ApiService['controlOnlineLearning']>): void {
    this.busy.set(true);
    this.requestError.set(null);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.poll();
      },
      error: (e) => {
        this.busy.set(false);
        this.requestError.set(e?.error?.detail ?? 'request');
      },
    });
  }

  decisionKey(e: OnlineVersionEntry): string {
    return `online.decision.${e.decision}`;
  }

  percent(v: number | null | undefined): string {
    return v == null ? '–' : `${Math.round(v * 100)} %`;
  }

  score(v: number | null | undefined): string {
    return v == null ? '–' : v.toFixed(3);
  }
}
