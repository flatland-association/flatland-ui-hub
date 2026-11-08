import { DispatcherTargetDirective } from '../../core/dispatcher-target.directive';
import { DispatcherActivityService } from '../../core/dispatcher-activity.service';
import '@sbb-esta/lyne-elements/toggle-check.js';
import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Input, Output, computed, effect, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { SessionStore } from '../../core/session.store';
import { UiConfigService } from '../../core/config/ui-config.service';
import { PolicyName } from '../../core/models';
import { ApiService } from '../../core/api.service';
import { PLAY_SPEED_MAX_LEVEL, PLAY_SPEED_MIN_LEVEL } from '../../core/play-speed';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [DispatcherTargetDirective, TranslocoPipe],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ToolbarComponent {
  readonly dispatcherActivity = inject(DispatcherActivityService);
  /** Policy names and descriptions, and the toolbar copy, in the viewer's language. */
  readonly i18n = inject(LanguageService);

  @Input() settingsActive = false;
  @Input() scenarioPolicyActive = false;
  @Input() demoActive = false;
  @Input() demoIsLast = false;
  /** A tour may run without the survey (core/demo/tours.ts), and then the
   *  button must not promise one. */
  @Input() demoSurvey = true;
  /** A guided condition names where its finish button leads (docs/plans/experiment-workflow.md §5.4). */
  @Input() finishLabel: string | null = null;
  @Output() openSettings = new EventEmitter<void>();
  @Output() openScenarioPolicy = new EventEmitter<void>();
  @Output() resetRequested = new EventEmitter<void>();
  @Output() finishDemoMode = new EventEmitter<void>();
  store = inject(SessionStore);
  readonly uiConfig = inject(UiConfigService);
  readonly experimentRun = inject(ExperimentRunService);
  private api = inject(ApiService);
  newWidth = signal(50);
  newHeight = signal(20);
  newAgents = signal(3);

  /** Starts from the session's policy, not a fixed one: the toolbar is created
   *  anew whenever its slot reappears, and Play sends this value
   *  (docs/plans/toolbar-under-guide.md D9). */
  policy = signal<PolicyName>(this.store.activePolicy());
  enabledPolicyIds = signal<string[]>([]);
  readonly speedMin = PLAY_SPEED_MIN_LEVEL;
  readonly speedMax = PLAY_SPEED_MAX_LEVEL;
  /** The tempo in the operator's terms: how many seconds one simulated minute takes. */
  readonly secondsPerMinute = computed(() =>
    (1 / this.store.playSpeed()).toLocaleString(this.i18n.lang(), { maximumFractionDigits: 1 }),
  );

  readonly selectablePolicies = computed(() => {
    const enabled = new Set(this.enabledPolicyIds());
    const allowlist = this.uiConfig.policyAllowlist();
    return this.store
      .availablePolicies()
      .filter((p) => enabled.has(p.id))
      .filter((p) => allowlist === null || allowlist.includes(p.id));
  });

  /** The divider before the finish button separates it from what stands left
   *  of it; under Plan B that can be nothing (docs/plans/toolbar-under-guide.md F11). */
  readonly finishDividerShown = computed(
    () =>
      !this.uiConfig.isHidden('control.playback') ||
      this.selectablePolicies().length > 1 ||
      this.store.episodeDone() ||
      this.store.loading() ||
      !!this.store.message(),
  );

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

    effect(() => {
      const sid = this.store.session()?.id;
      // Installing PP can enable a plan after creation. Ask the server for
      // availability again when its active driver changes; never infer writes
      // from the active policy or widen the deployment allowlist locally.
      const active = this.store.activePolicy();
      if (this.store.sessionCreating()) return;
      if (!sid) {
        this.enabledPolicyIds.set([]);
        return;
      }
      this.api.getScenarioPolicies(sid).subscribe({
        next: (cfg) => {
          if (this.store.sessionCreating() || this.store.session()?.id !== sid || this.store.activePolicy() !== active) return;
          const controlIds = cfg.enabled_policy_ids ?? cfg.enabled_ids;
          this.enabledPolicyIds.set(controlIds);
          this.store.setEnabledScenarioPolicyIds(cfg.enabled_ids);
          this.store.setEnabledControlPolicyIds(controlIds);
          if (!controlIds.includes(this.policy()) && controlIds.length > 0) {
            this.policy.set(controlIds[0] as PolicyName);
          }
        },
        error: () => {
          if (!this.store.sessionCreating() && this.store.session()?.id === sid && this.store.activePolicy() === active) this.enabledPolicyIds.set([]);
        },
      });
    });
  }


  newSession() {
    this.store.newSession({
      width: this.newWidth(),
      height: this.newHeight(),
      agents: this.newAgents(),
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

  onPolicyChange(event: Event) {
    const target = event.target as HTMLInputElement;
    if (!target?.value) return;
    const p = target.value as PolicyName;
    this.policy.set(p);

    const sess = this.store.session();
    if (!sess) return;
    this.api.setPolicy(sess.id, p).subscribe({
      next: () => {
        this.store.setActivePolicy(p);
        this.store.previewScenarioId.set(null);
        this.store.refreshForecasts();
      },
      error: (e) => this.store.error.set(this.i18n.t('status.failed.setPolicy', { reason: e.message })),
    });
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
