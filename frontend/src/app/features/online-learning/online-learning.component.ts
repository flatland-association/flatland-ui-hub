import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, Input, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Observable } from 'rxjs';
import { OnlineVersionEntry } from '../../core/models';
import { OnlineLearningScope, OnlineLearningService } from '../../core/online-learning.service';
import { SessionStore } from '../../core/session.store';

/**
 * Learning monitor — the online PPO learner (docs/plans/online-ppo-learning.md).
 *
 * Shows that the learning policy is being updated: its state, the stable
 * version the hub offers as `lab:online-ppo`, the rollout progress towards the
 * next update, the five buffers and the version history with each candidate's
 * evaluation against the last stable version and the baseline. When the stable
 * version changes it says so. Start, pause, resume and stop the learner here;
 * a tour can fix where it starts and what it learns on.
 *
 * The same in every mode: the learner is a policy among equals and changes no
 * mode's behaviour, so there is nothing to frame per mode.
 */
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

  private readonly learning = inject(OnlineLearningService);
  private readonly store = inject(SessionStore);
  readonly status = this.learning.status;
  readonly updatedTo = this.learning.updatedTo;
  readonly tourConfig = this.learning.tourConfig;

  readonly init = signal<'scratch' | 'ecml'>('scratch');
  readonly scope = signal<OnlineLearningScope>('scenario');
  readonly busy = signal(false);
  readonly requestError = signal<string | null>(null);

  readonly bufferOrder = BUFFER_ORDER;
  /** The session's scenario, when it is a preset the learner can play. */
  readonly scenarioId = computed(() => this.store.session()?.scenario_preset_id ?? null);
  readonly running = computed(() => ['running', 'updating', 'starting'].includes(this.status()?.state ?? ''));
  readonly paused = computed(() => this.status()?.state === 'paused');
  readonly canStart = computed(() => !this.status()?.alive && (this.status()?.available ?? false));

  readonly rolloutPercent = computed(() => {
    const p = this.status()?.rollout_progress;
    return p && p[1] > 0 ? Math.min(100, Math.round((100 * p[0]) / p[1])) : 0;
  });

  /** Newest first. */
  readonly history = computed<OnlineVersionEntry[]>(() => [...(this.status()?.history ?? [])].reverse().slice(0, 8));

  constructor() {
    inject(DestroyRef).onDestroy(this.learning.use());
  }

  start(): void {
    const scope: OnlineLearningScope = this.scenarioId() ? this.scope() : 'generated';
    this.run(this.learning.start(this.init(), scope));
  }

  control(command: 'pause' | 'resume' | 'stop'): void {
    this.run(this.learning.control(command));
  }

  private run(req: Observable<unknown>): void {
    this.busy.set(true);
    this.requestError.set(null);
    req.subscribe({
      next: () => {
        this.busy.set(false);
        this.learning.poll();
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
