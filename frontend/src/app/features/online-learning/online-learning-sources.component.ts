import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, Input, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Observable } from 'rxjs';
import {
  OnlineComparisonPolicy,
  OnlineLearningSettings,
  OnlineLearningSource,
} from '../../core/models';
import { LanguageService } from '../../core/i18n/language.service';
import { OnlineLearningService } from '../../core/online-learning.service';

const DEFAULT_COMPARISON_POLICIES: OnlineComparisonPolicy[] = [
  'deadlock_avoidance',
  'shortest_path',
  'learned_ppo',
];

const LEARNING_SOURCES: { key: OnlineLearningSource; slug: string }[] = [
  { key: 'policy_predictions', slug: 'policy-predictions' },
  { key: 'user_interactions', slug: 'user-interactions' },
  { key: 'counterfactual_evaluations', slug: 'counterfactual-evaluations' },
  { key: 'distillation_targets', slug: 'distillation-targets' },
  { key: 'experience_samples', slug: 'experience-samples' },
];

const COMPARISON_POLICIES: {
  id: OnlineComparisonPolicy;
  slug: string;
  labelKey: string;
}[] = [
  { id: 'deadlock_avoidance', slug: 'dla', labelKey: 'policies.deadlock_avoidance.label' },
  { id: 'shortest_path', slug: 'shortest-path', labelKey: 'policies.shortest_path.label' },
  { id: 'learned_ppo', slug: 'learned-ppo', labelKey: 'policies.learned_ppo.label' },
];

@Component({
  selector: 'app-online-learning-sources',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './online-learning-sources.component.html',
  styleUrl: './online-learning-sources.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class OnlineLearningSourcesComponent {
  @Input() testIdPrefix = 'online';
  @Input() disabled = false;

  private readonly learning = inject(OnlineLearningService);
  private readonly i18n = inject(LanguageService);
  readonly status = this.learning.status;
  readonly statusError = this.learning.statusError;
  readonly sourceOrder = LEARNING_SOURCES;
  readonly comparisonPolicyOrder = COMPARISON_POLICIES;
  readonly busy = signal(false);
  readonly requestError = signal<string | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(this.learning.use());
  }

  sourceEnabled(source: OnlineLearningSource): boolean {
    return this.status()?.learning_settings?.learning_sources?.[source] ?? true;
  }

  comparisonPolicyEnabled(policy: OnlineComparisonPolicy): boolean {
    const selected = this.status()?.learning_settings?.comparison_policies ?? DEFAULT_COMPARISON_POLICIES;
    return selected.includes(policy);
  }

  setSource(source: OnlineLearningSource, enabled: boolean): void {
    const settings = this.status()?.learning_settings;
    if (!settings) return;
    this.save({
      learning_sources: { ...settings.learning_sources, [source]: enabled },
      comparison_policies: settings.comparison_policies ?? DEFAULT_COMPARISON_POLICIES,
    });
  }

  setComparisonPolicy(policy: OnlineComparisonPolicy, enabled: boolean): void {
    const settings = this.status()?.learning_settings;
    if (!settings) return;
    const selected = new Set(settings.comparison_policies ?? DEFAULT_COMPARISON_POLICIES);
    if (enabled) selected.add(policy);
    else selected.delete(policy);
    this.save({
      learning_sources: settings.learning_sources,
      comparison_policies: this.comparisonPolicyOrder
        .map((option) => option.id)
        .filter((id) => selected.has(id)),
    });
  }

  private save(settings: Pick<OnlineLearningSettings, 'learning_sources' | 'comparison_policies'>): void {
    this.busy.set(true);
    this.requestError.set(null);
    this.saveRequest(this.learning.updateSettings(settings));
  }

  private saveRequest(request: Observable<OnlineLearningSettings>): void {
    request.subscribe({
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
}
