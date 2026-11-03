import { Injectable, computed, inject, signal } from '@angular/core';
import type { SessionState } from '../models';
import { SessionStore } from '../session.store';
import { WebSocketService } from '../websocket.service';
import type { ContextEvent, SessionRecord, SurveySubmission } from '../interaction-log/session-record';
import { ShiftKpis, interventionsFrom, shiftKpis } from '../shift-review';
import { STUDY_CONDITIONS, StudyCondition, conditionId } from '../demo/study-conditions';
import { GuideStepId, TourBriefing, TourGuideStep, briefingById } from '../demo/tour-briefings';
import type { ExperimentPhase } from '../demo/experiment-run.service';
import type { DecisionLogEntry } from '../decision-log';
import type { ModeIntro } from '../demo/mode-intro-configs';
import { LanguageService } from '../i18n/language.service';
import { UiStateRegistry } from '../interaction-log/ui-state-registry.service';
import type { InteractionMode } from '../events/event-types';
import type { StateFrame } from '../interaction-log/state-log.service';
import type { ClickEvent } from '../interaction-log/click-log.service';
import type { PointerSample } from '../interaction-log/pointer-log.service';
import { applyFrame, isReplayable, legAt, pointerAt, sessionSpan, stateFromFrames } from './replay-timeline';
import { PLAY_SPEED_DEFAULT_LEVEL } from '../play-speed';

/** How often the replay clock advances while playing. */
export const REPLAY_TICK_MS = 100;
/** Replay speeds offered: recorded time per real time. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10] as const;
/** How long a replayed click stays visible as a splash (recorded time). */
export const CLICK_SPLASH_MS = 900;

/**
 * Plays a recorded session back on the normal working screen
 * (docs/plans/experiment-logging-frontend-and-replay.md §9.2): it takes the
 * place of the live sources instead of adding a second UI. `SessionStore` is
 * fed from the `states` stream in place of the WebSocket, which stays closed;
 * `store.replayActive()` makes the screen read-only and stops all logging.
 */
@Injectable({ providedIn: 'root' })
export class ReplayService {
  private readonly store = inject(SessionStore);
  private readonly ws = inject(WebSocketService);
  private readonly uiState = inject(UiStateRegistry);
  private readonly i18n = inject(LanguageService);

  /** The sessions being replayed, in order: one leg, or every leg of a run. */
  readonly legs = signal<SessionRecord[]>([]);
  /** The recorded moment on screen (epoch ms). */
  readonly time = signal(0);
  readonly playing = signal(false);
  /** Recorded time per real time (`REPLAY_SPEEDS`); only scales the clock. */
  readonly speed = signal<number>(1);
  readonly active = computed(() => this.legs().length > 0);
  readonly start = computed(() => (this.legs().length ? sessionSpan(this.legs()[0]).start : 0));
  readonly end = computed(() => (this.legs().length ? sessionSpan(this.legs()[this.legs().length - 1]).end : 0));
  /** Index into `legs` of the session on screen. */
  readonly legIndex = computed(() => legAt(this.legs(), this.time()));
  readonly leg = computed<SessionRecord | null>(() => this.legs()[this.legIndex()] ?? null);
  /** The layout on screen at the replay time: the leg's, then its `layout_change` events (AppComponent applies it). */
  readonly layoutId = signal<string | null>(null);
  /** The recorded screen (`view_enter`): it decides which recorded screen the replay draws. */
  readonly view = signal<{ view: string; detail?: Record<string, unknown> } | null>(null);

  /** The recorded screens the replay draws itself, read-only: a questionnaire, or the Schichtbilanz.
   *  The Schichtbilanz follows the shift's end (`shift_end`): a dialog over it, such as a pending
   *  rationale, can take the logged view, so the view alone may never name it. */
  readonly screen = computed<'survey' | 'shiftSummary' | null>(() => {
    const v = this.view();
    if (v?.view === 'survey') return 'survey';
    if (this._runDone()) return null;
    if (this.store.shiftEnded() || v?.view === 'shift_review' || (v?.view === 'experiment' && v.detail?.['phase'] === 'review')) return 'shiftSummary';
    return null;
  });
  /** The guided condition's run is over (after the final questionnaire). */
  private readonly _runDone = computed(() => this.view()?.view === 'experiment' && this.view()?.detail?.['phase'] === 'done');
  /** Recorded screens drawn in place of the working screen, as live: the briefing, a leg's intro, the run's end. */
  readonly mainScreen = computed<'briefing' | 'intro' | 'done' | null>(() => {
    const v = this.view();
    if (this._runDone()) return 'done';
    if (v?.view === 'experiment' && v.detail?.['phase'] === 'briefing') return this.briefing() ? 'briefing' : null;
    if (v?.view === 'mode_intro') return 'intro';
    return null;
  });
  /** The condition the leg on screen was recorded in, if it still exists. */
  readonly condition = computed<StudyCondition | null>(() => {
    const id = this.leg()?.header.conditionId;
    return (id && STUDY_CONDITIONS.find((c) => conditionId(c) === id)) || null;
  });
  /** The condition's briefing in the viewer's language (English, else the first one, as fallback). */
  readonly briefing = computed<TourBriefing | null>(() => {
    const ids = this.condition()?.briefingIds;
    if (!ids) return null;
    return briefingById(ids[this.i18n.lang()] ?? ids.en ?? Object.values(ids)[0]) ?? null;
  });
  /** The intro card of the leg on screen, chosen as live (`TourContextService.modeIntroFor`):
   *  the leg's own card, else the briefing's for this leg or mode; null for the default card. */
  readonly intro = computed<ModeIntro | null>(() => {
    const leg = this._recordedLeg();
    const own = leg?.intro;
    const card = own ? own[this.i18n.lang()] ?? own.en ?? Object.values(own)[0] : undefined;
    if (card) return card;
    const mode = this.leg()?.header.mode;
    const at = this.view()?.detail?.['leg'];
    const byLeg = this.briefing()?.legIntros?.[typeof at === 'number' ? at : this.legIndex()];
    if (byLeg && byLeg.mode === mode) return byLeg;
    return (mode && this.briefing()?.modeIntros?.[mode]) || null;
  });
  /** "⟨name⟩ (k/N)" above the intro card, as live; null outside a guided condition. */
  readonly introStep = computed<string | null>(() => {
    const legs = this.condition()?.legs;
    const leg = this._recordedLeg();
    if (!legs || !leg) return null;
    const name = this.i18n.t(leg.nameKey, undefined, leg.id);
    return this.i18n.t('experimentRun.legLabel', { name, k: legs.indexOf(leg) + 1, n: legs.length });
  });
  /** The condition's leg the screen is about: an intro names it (the next leg's intro is logged
   *  at the end of the previous leg's record), else the leg whose record is on screen. */
  private readonly _recordedLeg = computed(() => {
    const named = this.view()?.detail?.['legId'];
    const id = typeof named === 'string' ? named : this.leg()?.header.legId;
    return (id && this.condition()?.legs?.find((l) => l.id === id)) || null;
  });
  /** Where the guided condition stood at the replay time, as `ExperimentRunService.phase` live:
   *  from the recorded screen. Null outside a guided condition. */
  readonly experimentPhase = computed<ExperimentPhase | null>(() => {
    if (!this.condition()?.legs?.length) return null;
    if (this.mainScreen() === 'briefing') return 'briefing';
    if (this._runDone()) return 'done';
    if (this.screen() === 'survey') return this.survey()?.afterLegId ? 'legSurvey' : 'finalSurvey';
    if (this.screen() === 'shiftSummary') return 'review';
    return 'running';
  });
  /** The condition's legs, and the one on screen (its index there). */
  readonly experimentLegs = computed(() => this.condition()?.legs ?? []);
  readonly experimentLegIndex = computed(() => {
    const leg = this._recordedLeg();
    return leg ? this.experimentLegs().indexOf(leg) : this.legIndex();
  });
  /** A guided condition with several legs: the stepper shows, as live. */
  readonly multiLeg = computed(() => this.experimentLegs().length > 1);
  /** The guide strip shows only while a leg runs when there are several legs, as live. */
  readonly guideVisible = computed(() => !this.multiLeg() || this.experimentPhase() === 'running');

  /** "⟨name⟩ (k/N)" for the condition's leg at `index`. */
  legLabel(index: number): string {
    const legs = this.experimentLegs();
    const leg = legs[index];
    if (!leg) return '';
    const name = this.i18n.t(leg.nameKey, undefined, leg.id);
    return this.i18n.t('experimentRun.legLabel', { name, k: index + 1, n: legs.length });
  }

  /** The guide's current step as logged with the working screen (`view_enter` detail `guideStep`):
   *  undefined until one is logged in the leg, null once every live step was done. */
  readonly guideStep = signal<GuideStepId | null | undefined>(undefined);
  readonly guideSteps = computed<TourGuideStep[]>(() => this.briefing()?.guide ?? []);
  /**
   * The guide steps done at the replay time: every step before the logged current one, and
   * what the recording shows happened by then, read as `TourGuideService` does live (a
   * malfunction, the participant's decisions, their step and rationale). A step the run
   * ticked while a dialog covered the screen is so not missed.
   */
  readonly guideDone = computed<ReadonlySet<GuideStepId>>(() => {
    const steps = this.guideSteps();
    const done = new Set<GuideStepId>();
    const logged = this.guideStep();
    const at = logged === null ? steps.filter((s) => !s.afterEpisode).length : logged ? steps.findIndex((s) => s.id === logged) : 0;
    steps.slice(0, Math.max(0, at)).forEach((s) => done.add(s.id));
    const t = this.time();
    const human = ((this.leg()?.decisions ?? []) as DecisionLogEntry[]).filter((e) => e.accountableOwner === 'human' && e.t <= t);
    if (human.length || this.store.agents().some((a) => !!a.is_malfunctioning || (a.malfunction_remaining ?? 0) > 0)) done.add('detect');
    if (human.length) {
      done.add('decide');
      if (human.some((e) => this.store.elapsedSteps() > e.simStep)) done.add('execute');
      if (human.some((e) => !!e.rationale)) done.add('reflect');
    }
    return done;
  });

  /** The clicks of the last moment (`CLICK_SPLASH_MS`) in the leg on screen, drawn as splashes. */
  readonly recentClicks = computed<ClickEvent[]>(() => {
    const t = this.time();
    return ((this.leg()?.clicks ?? []) as ClickEvent[]).filter((c) => c.t <= t && c.t > t - CLICK_SPLASH_MS);
  });
  /** The recorded pointer at the replay time, for the ghost cursor (plan §5.2.1); null when out. */
  readonly pointer = computed(() => pointerAt((this.leg()?.pointer ?? []) as PointerSample[], this.time()));
  /** Every submitted questionnaire of the replayed legs, in submit order. */
  private readonly _surveys = computed(() =>
    this.legs()
      .flatMap((leg) => leg.surveys ?? [])
      .filter((s) => s.submittedAt != null)
      .sort((a, b) => a.submittedAt! - b.submittedAt!),
  );
  /** On a questionnaire screen: the one being filled in, i.e. the next submitted after the replay time,
   *  shown with its final answers (plan §9.3, level A1). */
  readonly survey = computed<SurveySubmission | null>(() => {
    if (this.screen() !== 'survey') return null;
    const all = this._surveys();
    return all.find((s) => s.submittedAt! >= this.time()) ?? all.at(-1) ?? null;
  });
  /** The questionnaire parts the shown one had, from its condition (after a leg, or the final one);
   *  null for a condition that no longer exists, and the survey then shows the answered sections. */
  readonly surveyParts = computed<readonly string[] | null>(() => {
    const shown = this.survey();
    const id = this.leg()?.header.conditionId;
    const condition = shown && id ? STUDY_CONDITIONS.find((c) => conditionId(c) === id) : undefined;
    if (!condition) return null;
    return (shown!.afterLegId ? condition.legSurveyParts : condition.surveyParts) ?? null;
  });
  /** The Schichtbilanz rows: each leg's trains at its end, and its interventions. */
  readonly legSummaries = computed<{ kpis: ShiftKpis | null; interventions: number }[]>(() =>
    this.legs().map((leg) => {
      const end = stateFromFrames((leg.states ?? []) as StateFrame[]);
      return { kpis: end ? shiftKpis(end.agents ?? []) : null, interventions: interventionsFrom(leg.decisions ?? []).length };
    }),
  );

  /** What has been applied of the current leg, so a step forward only applies what is new. */
  private _applied: { leg: number; time: number; frames: number; events: number; state: SessionState | null } | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  /** The viewer's own tempo, given back on exit so a replayed one does not
   *  carry into the next live session (docs/plans/toolbar-under-guide.md D13). */
  private _viewerSpeedLevel: number | null = null;

  /** Start replaying these sessions (only those with train movements). Returns false if none can be. */
  load(records: readonly SessionRecord[]): boolean {
    const legs = records.filter(isReplayable).sort((a, b) => a.header.startedAt - b.header.startedAt);
    if (!legs.length) return false;
    this.pause();
    this.ws.disconnect();
    this.store.playing.set(false);
    if (!this.store.replayActive()) this._viewerSpeedLevel = this.store.playSpeedLevel();
    this.store.replayActive.set(true);
    this._applied = null;
    this.legs.set(legs);
    this.seek(sessionSpan(legs[0]).start);
    return true;
  }

  play(): void {
    if (!this.active() || this._timer) return;
    if (this.time() >= this.end()) this.seek(this.start());
    this.playing.set(true);
    this._timer = setInterval(() => this._tick(), REPLAY_TICK_MS);
  }

  pause(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.playing.set(false);
  }

  /**
   * Show the recorded moment `t` (scrubbing). Forwards applies every change
   * up to `t` at once, without drawing in between; backwards restarts the leg
   * and does the same. Panel contents follow, since the interceptor answers
   * with the latest response before the new time.
   */
  seek(t: number): void {
    const time = Math.min(Math.max(t, this.start()), this.end());
    this.time.set(time);
    this._apply(time);
  }

  /** Leave the replay: the start screen, with nothing of the replay left in the store. */
  exit(): void {
    this.pause();
    this.legs.set([]);
    this._applied = null;
    this.store.session.set(null);
    this.store.state.set(null);
    this.store.trajectories.set(new Map());
    this.store.shiftEnded.set(false);
    this.store.reflectionRequested.set(false);
    this.store.selectedHandle.set(null);
    this.layoutId.set(null);
    this.view.set(null);
    this.guideStep.set(undefined);
    if (this._viewerSpeedLevel !== null) this.store.playSpeedLevel.set(this._viewerSpeedLevel);
    this._viewerSpeedLevel = null;
    this.store.replayActive.set(false);
  }

  private _tick(): void {
    const next = this.time() + REPLAY_TICK_MS * this.speed();
    this.seek(next);
    if (next >= this.end()) this.pause();
  }

  /** Bring the store to `t`: forwards from what is shown, or the leg from its start. */
  private _apply(t: number): void {
    const index = legAt(this.legs(), t);
    const leg = this.legs()[index];
    if (!leg) return;
    if (!this._applied || this._applied.leg !== index || t < this._applied.time) this._startLeg(index, leg);
    const applied = this._applied!;
    const frames = (leg.states ?? []) as StateFrame[];
    let state = applied.state;
    let i = applied.frames;
    for (; i < frames.length && frames[i].t <= t; i++) {
      state = applyFrame(state, frames[i]);
      if (state) this.store.applyReplayState(state);
    }
    const events = leg.context ?? [];
    let e = applied.events;
    for (; e < events.length && events[e].t <= t; e++) this._applyEvent(events[e]);
    this._applied = { ...applied, time: t, frames: i, events: e, state };
  }

  /** One recorded change, "latest value wins": mode, layout, centre tab, dialogs, panels, viewports. */
  private _applyEvent(event: ContextEvent): void {
    const p = (event.payload ?? {}) as Record<string, unknown>;
    switch (event.type) {
      case 'mode_change':
        this.store.interactionMode.set(p['to'] as InteractionMode);
        break;
      case 'layout_change':
        this.layoutId.set((p['to'] as string | null) ?? null);
        break;
      case 'speed_change':
        this.store.playSpeedLevel.set(p['to'] as number);
        break;
      case 'shift_end':
        this.store.shiftEnded.set(true);
        break;
      case 'reflection_open':
      case 'reflection_close':
        this.store.reflectionRequested.set(event.type === 'reflection_open');
        break;
      case 'ui_state':
        this.uiState.apply(p['key'] as string, p['value']);
        break;
      case 'view_enter': {
        const detail = p['detail'] as Record<string, unknown> | undefined;
        this.view.set({ view: p['view'] as string, ...(detail ? { detail } : {}) });
        if (detail && 'guideStep' in detail) this.guideStep.set((detail['guideStep'] as GuideStepId | null) ?? null);
        if (p['view'] === 'session' && detail?.['centerTab'] === 'marey') {
          this.store.showMarey.set(true);
          this.store.showMap.set(false);
        } else if (p['view'] === 'session' && detail?.['centerTab'] === 'map') {
          this.store.showMap.set(true);
          this.store.showMarey.set(false);
        }
        break;
      }
    }
  }

  /** A leg comes on screen: its session, mode and an empty map, as when it started. */
  private _startLeg(index: number, leg: SessionRecord): void {
    const h = leg.header;
    this.store.trajectories.set(new Map());
    this.store.state.set(null);
    this.store.interactionMode.set(h.mode);
    // The participant's tempo, as the toolbar showed it; "Normal" for records
    // made before the header had it.
    this.store.playSpeedLevel.set(h.playSpeedLevel ?? PLAY_SPEED_DEFAULT_LEVEL);
    this.store.showMap.set(true);
    this.store.showMarey.set(false);
    this.store.shiftEnded.set(false);
    this.store.reflectionRequested.set(false);
    this.store.selectedHandle.set(null);
    this.layoutId.set(h.layoutId);
    this.view.set(null);
    this.guideStep.set(undefined);
    this.store.session.set({
      id: h.sessionId,
      width: h.grid?.width ?? 0,
      height: h.grid?.height ?? 0,
      num_agents: h.grid?.numAgents ?? 0,
      scenario_preset_id: h.scenarioId,
      disturbance_ids: h.disturbanceIds,
    });
    this._applied = { leg: index, time: h.startedAt, frames: 0, events: 0, state: null };
  }
}
