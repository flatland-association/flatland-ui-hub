import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, Input, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Observable } from 'rxjs';
import { LanguageService } from '../../core/i18n/language.service';
import { OnlineVersionEntry } from '../../core/models';
import { OnlineLearningService } from '../../core/online-learning.service';
import { OnlineLearningSourcesComponent } from './online-learning-sources.component';

const SOURCE_LABEL_KEYS: Record<string, string> = {
  'online-ppo': 'online.source.onlinePpo',
  learner: 'online.source.onlinePpo',
  deadlock_avoidance: 'policies.deadlock_avoidance.label',
  shortest_path: 'policies.shortest_path.label',
  learned_ppo: 'policies.learned_ppo.label',
  random: 'policies.random.label',
  random_policy: 'policies.random.label',
  fallback: 'online.source.fallback',
  unproposed: 'online.source.unproposed',
  user: 'online.source.user',
  executed: 'online.source.executed',
  simulated: 'online.source.simulated',
  user_executed: 'online.source.userExecuted',
  user_simulated: 'online.source.userSimulated',
};

/**
 * Learning monitor — the online PPO learner (docs/plans/online-ppo-learning.md).
 *
 * Shows that the learning policy is being updated: its state, the stable
 * version the hub offers as `lab:online-ppo`, the rollout progress towards the
 * next update, the five buffers and the version history with each candidate's
 * evaluation against the last stable version and the baseline. When the stable
 * version changes it says so. Global learning-source settings are also
 * available in Session Settings; the only training control here is Reset to
 * scratch.
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
  imports: [TranslocoPipe, OnlineLearningSourcesComponent],
  templateUrl: './online-learning.component.html',
  styleUrl: './online-learning.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class OnlineLearningComponent {
  @Input() embedded = false;

  private readonly learning = inject(OnlineLearningService);
  private readonly i18n = inject(LanguageService);
  readonly status = this.learning.status;
  readonly statusError = this.learning.statusError;
  readonly updatedTo = this.learning.updatedTo;

  readonly busy = signal(false);
  readonly requestError = signal<string | null>(null);

  readonly bufferOrder = BUFFER_ORDER;
  readonly rolloutPercent = computed(() => {
    const p = this.status()?.rollout_progress;
    return p && p[1] > 0 ? Math.min(100, Math.round((100 * p[0]) / p[1])) : 0;
  });

  /** Newest first. */
  readonly history = computed<OnlineVersionEntry[]>(() => [...(this.status()?.history ?? [])].reverse());

  constructor() {
    inject(DestroyRef).onDestroy(this.learning.use());
  }

  resetToScratch(): void {
    if (!window.confirm(this.i18n.t('online.resetConfirm'))) return;
    this.run(this.learning.resetToScratch());
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
        this.requestError.set(e?.error?.detail ?? this.i18n.t('online.requestError'));
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

  sourceRows(counts: Record<string, number> | undefined): { id: string; count: number }[] {
    return Object.entries(counts ?? {}).map(([id, count]) => ({ id, count }));
  }

  sourceLabel(id: string): string {
    const key = SOURCE_LABEL_KEYS[id];
    return key ? this.i18n.t(key) : id;
  }
}
