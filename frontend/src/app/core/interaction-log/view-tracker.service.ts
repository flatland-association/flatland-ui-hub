import { Injectable, Signal, computed, effect, inject, signal, untracked } from '@angular/core';
import { ExperimentRunService } from '../demo/experiment-run.service';
import { TourGuideService } from '../demo/tour-guide.service';
import { SessionStore } from '../session.store';
import { InteractionLogService } from './interaction-log.service';

/** The screen on display (docs/plans/experiment-logging-frontend-and-replay.md §5.3). */
export interface AppView {
  view: string;
  detail?: Record<string, unknown>;
}

/**
 * Read-only view signals that live in `AppComponent` (no router: screens are
 * `@if` blocks). The component hands them over once with `attach()`.
 */
export interface AppViewSource {
  sessionActive: Signal<boolean>;
  tourId: Signal<string | null>;
  layoutId: Signal<string | null>;
  tourOpeningOpen: Signal<boolean>;
  demoComplete: Signal<boolean>;
  shiftScreenOpen: Signal<boolean>;
  debrief: Signal<boolean>;
  surveyActive: Signal<boolean>;
  helpActive: Signal<boolean>;
  settingsMode: Signal<boolean>;
  settingsTab: Signal<string>;
  scenarioPolicyMode: Signal<boolean>;
  pendingResume: Signal<boolean>;
  /** Layout Designer, galleries, …: pages outside experiments; null on the main app. */
  page: Signal<string | null>;
}

/**
 * Logs which screen the participant sees and when, as `view_enter` context
 * events (§5.3, pattern P6). It derives the view from signals that already
 * exist and changes none of them. Time in a view is the gap to the next
 * `view_enter`; there is no leave event.
 *
 * - Overlays (help, settings, a survey, a reflection dialog) take precedence;
 *   when they close, the view below is entered again.
 * - Each new session's record starts with a `view_enter` for the screen shown,
 *   because a leg's intro appears a moment before its session exists.
 * - A hidden browser tab is a view of its own (`hidden`).
 */
@Injectable({ providedIn: 'root' })
export class ViewTracker {
  private readonly log = inject(InteractionLogService);
  private readonly store = inject(SessionStore);
  private readonly run = inject(ExperimentRunService);
  private readonly guide = inject(TourGuideService);

  private readonly _source = signal<AppViewSource | null>(null);
  private readonly _hidden = signal(typeof document !== 'undefined' && document.hidden);

  /** The view as derived now; `null` before `attach()`. */
  readonly currentView = computed<AppView | null>(() => {
    const app = this._source();
    if (!app) return null;
    if (this._hidden()) return { view: 'hidden' };
    const page = app.page();
    if (page) return { view: page };
    if (app.helpActive()) return { view: 'help' };
    if (app.settingsMode()) return { view: 'settings', detail: { tab: app.settingsTab() } };
    if (app.scenarioPolicyMode()) return { view: 'settings', detail: { tab: 'scenarioPolicy' } };
    if (app.surveyActive()) return { view: 'survey', detail: this._runDetail() };
    if (this.store.reflectionRequested()) return { view: 'reflection', detail: { kind: 'co-learning' } };
    if (this.store.pendingRationale()) return { view: 'reflection', detail: { kind: 'rationale' } };
    if (this.store.pendingStrategyReflection()) return { view: 'reflection', detail: { kind: 'strategy' } };
    if (!app.sessionActive()) return app.pendingResume() ? { view: 'resume_prompt' } : { view: 'start' };
    const runActive = this.run.active();
    const phase = this.run.phase();
    if (app.tourOpeningOpen()) {
      return runActive ? { view: 'experiment', detail: { phase: 'briefing' } } : { view: 'tour_opening', detail: { tourId: app.tourId() } };
    }
    if (this.store.demoActive() && this.store.demoIntroPending()) {
      return {
        view: 'mode_intro',
        detail: { tourId: app.tourId(), leg: this.store.demoStepIndex(), mode: this.store.interactionMode(), ...this._runDetail() },
      };
    }
    if (runActive && phase !== 'running' && phase !== 'briefing') return { view: 'experiment', detail: { phase, ...this._runDetail() } };
    if (app.demoComplete()) return { view: 'demo_complete', detail: { tourId: app.tourId() } };
    if (app.shiftScreenOpen()) return { view: 'shift_review', detail: { debrief: app.debrief() } };
    return {
      view: 'session',
      detail: {
        centerTab: this.store.showMarey() ? 'marey' : this.store.showMap() ? 'map' : 'other',
        layoutId: app.layoutId(),
        ...(this.guide.active() ? { guideStep: this.guide.current()?.id ?? null } : {}),
      },
    };
  });

  private _last: AppView | null = null;

  constructor() {
    effect(() => {
      const view = this.currentView();
      untracked(() => this._enter(view));
    });
    // A new record opens with the screen already on display (Q14).
    let lastSid: string | null = null;
    effect(() => {
      const sid = this.log.header()?.sessionId ?? null;
      untracked(() => {
        if (sid === lastSid) return;
        lastSid = sid;
        if (sid && this._last) this.log.noteView(this._last.view, this._last.detail, null);
      });
    });
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this._hidden.set(document.hidden));
    }
  }

  /** Called once by `AppComponent` with its view signals. */
  attach(source: AppViewSource): void {
    this._source.set(source);
  }

  private _enter(view: AppView | null): void {
    if (!view || sameView(view, this._last)) return;
    const from = this._last?.view ?? null;
    this._last = view;
    this.log.noteView(view.view, view.detail, from);
  }

  private _runDetail(): Record<string, unknown> {
    const leg = this.run.active() ? this.run.currentLeg()?.id ?? null : null;
    return leg ? { legId: leg } : {};
  }
}

function sameView(a: AppView, b: AppView | null): boolean {
  return !!b && a.view === b.view && JSON.stringify(a.detail ?? null) === JSON.stringify(b.detail ?? null);
}
