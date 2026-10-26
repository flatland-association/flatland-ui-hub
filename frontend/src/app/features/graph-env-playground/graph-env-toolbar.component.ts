// Copied from frontend/src/app/features/toolbar/toolbar.component.ts at 2f4dbcb; keep the diff to it minimal (docs/plans/graph-env-playground.md §8).
import '@sbb-esta/lyne-elements/toggle-check.js';
import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { GraphEnvStore } from './graph-env.store';
import { PolicyName } from '../../core/models';
import { PLAY_SPEED_MAX_LEVEL, PLAY_SPEED_MIN_LEVEL } from '../../core/play-speed';

@Component({
  selector: 'app-graph-env-toolbar',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './graph-env-toolbar.component.html',
  styleUrl: './graph-env-toolbar.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class GraphEnvToolbarComponent {
  /** Policy names and descriptions, and the toolbar copy, in the viewer's language. */
  readonly i18n = inject(LanguageService);

  @Input() settingsActive = false;
  @Input() scenarioPolicyActive = false;
  @Input() demoActive = false;
  @Input() demoIsLast = false;
  /** A tour may run without the survey (core/demo/tours.ts), and then the
   *  button must not promise one. */
  @Input() demoSurvey = true;
  @Output() openSettings = new EventEmitter<void>();
  @Output() openScenarioPolicy = new EventEmitter<void>();
  @Output() resetRequested = new EventEmitter<void>();
  @Output() finishDemoMode = new EventEmitter<void>();
  store = inject(GraphEnvStore);
  newWidth = signal(50);
  newHeight = signal(20);
  newAgents = signal(3);

  policy = signal<PolicyName>('deadlock_avoidance');
  enabledPolicyIds = signal<string[]>([]);
  readonly speedMin = PLAY_SPEED_MIN_LEVEL;
  readonly speedMax = PLAY_SPEED_MAX_LEVEL;
  /** The tempo in the operator's terms: how many seconds one simulated minute takes. */
  readonly secondsPerMinute = computed(() =>
    (1 / this.store.playSpeed()).toLocaleString(this.i18n.lang(), { maximumFractionDigits: 1 }),
  );

  readonly selectablePolicies = computed(() => {
    const enabled = new Set(this.enabledPolicyIds());
    return this.store.availablePolicies().filter((p) => enabled.has(p.id));
  });

  constructor() {
    // Mirror backend/session active policy into the toolbar, but never
    // re-select a policy that has just been disabled in Settings.
    effect(() => {
      const active = this.store.activePolicy();
      const enabled = this.enabledPolicyIds();
      if (!active) return;
      if (enabled.length > 0 && !enabled.includes(active)) return;
      if (active !== this.policy()) {
        this.policy.set(active);
      }
    });

    effect(() => {
      const ids = this.store.enabledControlPolicyIds();
      if (ids.length > 0) {
        this.enabledPolicyIds.set(ids);
        if (!ids.includes(this.policy()) && ids.length > 0) {
          this.policy.set(ids[0] as PolicyName);
        }
      }
    });
  }


  showSettings() {
    this.openSettings.emit();
  }

  showScenarioPolicy() {
    this.openScenarioPolicy.emit();
  }

  requestReset() {
    this.resetRequested.emit();
  }

  requestFinishDemoMode() {
    this.finishDemoMode.emit();
  }

  step(n: number) {
    this.store.step(this.currentPolicy(), n);
  }

  onPolicyChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target?.value) return;
    const p = target.value as PolicyName;
    this.policy.set(p);
  }

  togglePlay() {
    this.store.togglePlay(this.currentPolicy());
  }

  onSpeedChange(ev: Event) {
    this.store.setPlaySpeedLevel(+(ev.target as HTMLInputElement).value, this.currentPolicy());
  }

  private currentPolicy(): PolicyName {
    return this.policy();
  }
}
