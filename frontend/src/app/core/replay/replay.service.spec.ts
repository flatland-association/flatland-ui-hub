import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import type { AgentDTO, SessionInfo, SessionState } from '../models';
import { SessionStore } from '../session.store';
import { WebSocketService } from '../websocket.service';
import { UiStateRegistry } from '../interaction-log/ui-state-registry.service';
import type { SessionRecord } from '../interaction-log/session-record';
import type { StateFrame } from '../interaction-log/state-log.service';
import { LanguageService } from '../i18n/language.service';
import { REPLAY_TICK_MS, ReplayService } from './replay.service';

const map = { width: 3, height: 2, rail_grid: [[0]], rail_tiles: [], decision_cells: [] };
const agent = (handle: number, col: number) => ({ handle, position: [0, col] }) as unknown as AgentDTO;

function leg(sessionId: string, startedAt: number, extra: Partial<SessionRecord> = {}): SessionRecord {
  const states: StateFrame[] = [
    { seq: 1, t: startedAt + 100, simStep: 0, maxSteps: 10, episodeDone: false, agents: [agent(0, 0)], map },
    { seq: 2, t: startedAt + 300, simStep: 1, agents: [agent(0, 1)] },
  ];
  return {
    header: { sessionId, startedAt, endedAt: startedAt + 500, mode: 'co-learning', layoutId: null, scenarioId: 'wal', disturbanceIds: [], grid: { width: 3, height: 2, numAgents: 1 } },
    context: [],
    states,
    ...extra,
  } as unknown as SessionRecord;
}

describe('ReplayService', () => {
  let store: {
    session: ReturnType<typeof signal<SessionInfo | null>>;
    state: ReturnType<typeof signal<SessionState | null>>;
    trajectories: ReturnType<typeof signal<Map<number, unknown>>>;
    interactionMode: ReturnType<typeof signal<string>>;
    playing: ReturnType<typeof signal<boolean>>;
    replayActive: ReturnType<typeof signal<boolean>>;
    showMap: ReturnType<typeof signal<boolean>>;
    showMarey: ReturnType<typeof signal<boolean>>;
    shiftEnded: ReturnType<typeof signal<boolean>>;
    reflectionRequested: ReturnType<typeof signal<boolean>>;
    selectedHandle: ReturnType<typeof signal<number | null>>;
    agents: () => AgentDTO[];
    elapsedSteps: () => number;
    applyReplayState: jasmine.Spy;
  };
  let uiState: { apply: jasmine.Spy };
  let ws: { disconnect: jasmine.Spy };
  let replay: ReplayService;

  beforeEach(() => {
    store = {
      session: signal<SessionInfo | null>(null),
      state: signal<SessionState | null>(null),
      trajectories: signal(new Map()),
      interactionMode: signal('recommendation'),
      playing: signal(true),
      replayActive: signal(false),
      showMap: signal(true),
      showMarey: signal(false),
      shiftEnded: signal(false),
      reflectionRequested: signal(false),
      selectedHandle: signal<number | null>(3),
      agents: () => (store.state()?.agents ?? []) as AgentDTO[],
      elapsedSteps: () => 0,
      applyReplayState: jasmine.createSpy('applyReplayState').and.callFake((s: SessionState) => store.state.set(s)),
    };
    ws = { disconnect: jasmine.createSpy('disconnect') };
    uiState = { apply: jasmine.createSpy('apply') };
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: store },
        { provide: WebSocketService, useValue: ws },
        { provide: UiStateRegistry, useValue: uiState },
        { provide: LanguageService, useValue: { lang: signal('de'), t: (key: string, _p?: unknown, fallback?: string) => fallback ?? key } },
      ],
    });
    replay = TestBed.inject(ReplayService);
  });

  it('takes over the store: recorded session, mode, no WebSocket, read-only', () => {
    expect(replay.load([leg('s1', 1000)])).toBeTrue();
    expect(ws.disconnect).toHaveBeenCalled();
    expect(store.replayActive()).toBeTrue();
    expect(store.playing()).toBeFalse();
    expect(store.session()?.id).toBe('s1');
    expect(store.interactionMode()).toBe('co-learning');
    expect(store.state()).toBeNull();
  });

  it('shows the trains of the moment, forwards and after a jump back', () => {
    replay.load([leg('s1', 1000)]);
    replay.seek(1350);
    expect(store.state()!.agents[0].position).toEqual([0, 1]);
    replay.seek(1150);
    expect(store.state()!.agents[0].position).toEqual([0, 0]);
    expect(store.applyReplayState).toHaveBeenCalledTimes(3);
  });

  it('plays on the clock and stops at the end', fakeAsync(() => {
    replay.load([leg('s1', 1000)]);
    replay.play();
    tick(REPLAY_TICK_MS * 4);
    expect(replay.time()).toBe(1400);
    expect(store.state()!.agents[0].position).toEqual([0, 1]);
    tick(REPLAY_TICK_MS * 10);
    expect(replay.playing()).toBeFalse();
    expect(replay.time()).toBe(1500);
  }));

  it('scales the clock with the speed', fakeAsync(() => {
    replay.load([leg('s1', 1000)]);
    replay.speed.set(2);
    replay.play();
    tick(REPLAY_TICK_MS * 2);
    expect(replay.time()).toBe(1400);
    replay.pause();
  }));

  it('refuses sessions without train movements and leaves cleanly', () => {
    expect(replay.load([leg('s0', 1000, { states: [] })])).toBeFalse();
    expect(store.replayActive()).toBeFalse();
    replay.load([leg('s1', 1000)]);
    replay.exit();
    expect(store.replayActive()).toBeFalse();
    expect(store.session()).toBeNull();
    expect(replay.active()).toBeFalse();
  });

  it('applies the recorded screens, mode, layout and UI state at their time, again after a jump back', () => {
    const ev = (t: number, type: string, payload: Record<string, unknown>) => ({ seq: t, t, simStep: 0, mode: 'co-learning', type, payload });
    replay.load([
      leg('s1', 1000, {
        context: [
          ev(1050, 'view_enter', { view: 'session', detail: { centerTab: 'map' } }),
          ev(1100, 'ui_state', { key: 'map.viewport', value: { zoom: 2 } }),
          ev(1200, 'mode_change', { from: 'co-learning', to: 'director' }),
          ev(1250, 'layout_change', { from: null, to: 'preset-plan-b' }),
          ev(1300, 'view_enter', { view: 'session', detail: { centerTab: 'marey' } }),
          ev(1400, 'view_enter', { view: 'survey', detail: { legId: 'l1' } }),
        ],
      } as Partial<SessionRecord>),
    ]);
    expect(store.selectedHandle()).toBeNull();
    replay.seek(1350);
    expect(uiState.apply).toHaveBeenCalledOnceWith('map.viewport', { zoom: 2 });
    expect(store.interactionMode()).toBe('director');
    expect(replay.layoutId()).toBe('preset-plan-b');
    expect([store.showMap(), store.showMarey()]).toEqual([false, true]);
    replay.seek(1450);
    expect(replay.view()?.view).toBe('survey');
    replay.seek(1150);
    expect(store.interactionMode()).toBe('co-learning');
    expect(replay.layoutId()).toBeNull();
    expect([store.showMap(), store.showMarey()]).toEqual([true, false]);
    expect(uiState.apply).toHaveBeenCalledTimes(2);
  });

  it('replays a run leg after leg, including the screens after a leg ended', () => {
    const ev = (t: number, view: string) => ({ seq: t, t, simStep: 0, mode: 'co-learning', type: 'view_enter', payload: { view } });
    const first = leg('s1', 1000, { context: [ev(1600, 'survey')] } as Partial<SessionRecord>);
    const second = leg('s2', 2000);
    replay.load([second, first]);
    expect(replay.legs().map((l) => l.header.sessionId)).toEqual(['s1', 's2']);
    expect(replay.end()).toBe(2500);
    replay.seek(1700);
    expect(store.session()?.id).toBe('s1');
    expect(replay.view()?.view).toBe('survey');
    replay.seek(2350);
    expect(store.session()?.id).toBe('s2');
    expect(replay.legIndex()).toBe(1);
    expect(store.state()!.agents[0].position).toEqual([0, 1]);
  });
  it('draws the questionnaires with their final answers and the Schichtbilanz over all legs', () => {
    const ev = (t: number, view: string, detail?: Record<string, unknown>) => ({ seq: t, t, simStep: 0, mode: 'co-learning', type: 'view_enter', payload: { view, ...(detail ? { detail } : {}) } });
    const done = { seq: 3, t: 0, simStep: 2, agents: [{ handle: 0, position: null, state: 'DONE', delay: 4 }] };
    const first = leg('s1', 1000, {
      context: [ev(1600, 'survey', { legId: 'a' }), ev(1800, 'experiment', { phase: 'running' })],
      surveys: [{ surveyId: 'post-session-co-learning', answers: { tlx_1: 3 }, submittedAt: 1700, afterLegId: 'a' }],
      decisions: [],
    } as unknown as Partial<SessionRecord>);
    const second = leg('s2', 2000, {
      context: [
        { seq: 2550, t: 2550, simStep: 0, mode: 'co-learning', type: 'shift_end' },
        ev(2600, 'reflection', { kind: 'rationale' }),
        ev(2700, 'survey', { legId: 'b' }),
      ],
      surveys: [{ surveyId: 'post-session-co-learning', answers: { trust_1: 5 }, submittedAt: 2800, afterLegId: null }],
      decisions: [],
    } as unknown as Partial<SessionRecord>);
    (second.states as StateFrame[]).push({ ...done, t: 2400 } as unknown as StateFrame);
    replay.load([first, second]);

    replay.seek(1650);
    expect(replay.screen()).toBe('survey');
    expect(replay.survey()?.answers).toEqual({ tlx_1: 3 });
    replay.seek(1900);
    expect(replay.screen()).toBeNull();
    expect(replay.survey()).toBeNull();
    replay.seek(2500);
    expect(replay.screen()).toBeNull();
    replay.seek(2650);
    expect(replay.screen()).toBe('shiftSummary');
    expect(replay.legSummaries().map((r) => r.kpis?.arrived)).toEqual([0, 1]);
    expect(replay.legSummaries()[1].kpis?.totalDelay).toBe(4);
    replay.seek(2750);
    expect(replay.survey()?.answers).toEqual({ trust_1: 5 });
  });
  it('draws the recorded briefing and the intro card of each leg in place of the working screen', () => {
    const ev = (t: number, view: string, detail?: Record<string, unknown>) => ({ seq: t, t, simStep: 0, mode: 'co-learning', type: 'view_enter', payload: { view, ...(detail ? { detail } : {}) } });
    const header = (h: SessionRecord['header'], legId: string) => ({ ...h, conditionId: 'plan-b-p01', legId });
    const first = leg('s1', 1000, {
      context: [
        ev(1000, 'experiment', { phase: 'briefing' }),
        ev(1050, 'mode_intro', { leg: 0, legId: 'wal-single-track' }),
        ev(1080, 'session'),
        // The next leg's intro is logged before the next leg's record starts.
        ev(1450, 'mode_intro', { leg: 1, legId: 'wal-follower' }),
      ],
    } as Partial<SessionRecord>);
    const second = leg('s2', 2000, { context: [ev(2000, 'mode_intro', { leg: 1, legId: 'wal-follower' }), ev(2100, 'session')] } as Partial<SessionRecord>);
    first.header = header(first.header, 'wal-single-track');
    second.header = header(second.header, 'wal-follower');
    replay.load([first, second]);

    replay.seek(1020);
    expect(replay.mainScreen()).toBe('briefing');
    expect(replay.briefing()?.id).toBe('colearning-experiment-2x');
    replay.seek(1060);
    expect(replay.mainScreen()).toBe('intro');
    replay.seek(1090);
    expect(replay.mainScreen()).toBeNull();
    replay.seek(1460);
    expect(replay.mainScreen()).toBe('intro');
    expect(replay.intro()).toBe(replay.condition()!.legs![1].intro!.de!);
    replay.seek(2050);
    expect(replay.mainScreen()).toBe('intro');
    // The follower leg brings its own German card; the step names it as live.
    expect(replay.intro()).toBeTruthy();
    expect(replay.introStep()).toBe('experimentRun.legLabel');
  });
  it('follows the run for the stepper and the guide, and runs on to the final questionnaire\'s submit', () => {
    const ev = (t: number, view: string, detail?: Record<string, unknown>) => ({ seq: t, t, simStep: 0, mode: 'co-learning', type: 'view_enter', payload: { view, ...(detail ? { detail } : {}) } });
    const header = (h: SessionRecord['header'], legId: string) => ({ ...h, conditionId: 'plan-b-p01', legId });
    const decision = { t: 1200, simStep: 0, accountableOwner: 'human', handle: 0, action: 'stop' };
    const first = leg('s1', 1000, {
      context: [ev(1000, 'experiment', { phase: 'briefing' }), ev(1080, 'session', { guideStep: 'detect' }), ev(1400, 'survey', { legId: 'wal-single-track' })],
      decisions: [decision],
      surveys: [{ afterLegId: 'wal-single-track', submittedAt: 1450, answers: {} }],
    } as unknown as Partial<SessionRecord>);
    const second = leg('s2', 2000, {
      context: [ev(2100, 'session', { guideStep: 'assess' }), ev(2600, 'survey', { legId: 'wal-follower' })],
      surveys: [{ afterLegId: null, submittedAt: 2900, answers: {} }],
    } as unknown as Partial<SessionRecord>);
    first.header = header(first.header, 'wal-single-track');
    second.header = header(second.header, 'wal-follower');
    replay.load([first, second]);

    expect(replay.multiLeg()).toBeTrue();
    replay.seek(1020);
    expect(replay.experimentPhase()).toBe('briefing');
    replay.seek(1100);
    expect(replay.experimentPhase()).toBe('running');
    expect(replay.guideVisible()).toBeTrue();
    expect(replay.guideDone().size).toBe(0);
    // The recorded decision ticks "decide" even before a new guide step is logged.
    replay.seek(1250);
    expect([...replay.guideDone()]).toEqual(jasmine.arrayContaining(['detect', 'decide']));
    replay.seek(1420);
    expect(replay.experimentPhase()).toBe('legSurvey');
    expect(replay.experimentLegIndex()).toBe(0);
    expect(replay.guideVisible()).toBeFalse();
    replay.seek(2200);
    expect(replay.experimentLegIndex()).toBe(1);
    expect(replay.guideDone().has('detect')).toBeTrue();
    // The final questionnaire stays until it was submitted.
    expect(replay.end()).toBe(2900);
    replay.seek(2800);
    expect(replay.experimentPhase()).toBe('finalSurvey');
  });
  it('keeps the clicks of the last moment for the splashes', () => {
    const c = (seq: number, t: number) => ({ seq, t, simStep: 0, mode: 'co-learning', target: 'toolbar.play', panel: null, view: 'session' });
    const later = { seq: 9, t: 2500, simStep: 0, mode: 'co-learning', type: 'pause' };
    replay.load([leg('s1', 1000, { clicks: [c(1, 1100), c(2, 1300)], context: [later] } as unknown as Partial<SessionRecord>)]);
    replay.seek(1150);
    expect(replay.recentClicks().map((k) => k.seq)).toEqual([1]);
    replay.seek(1350);
    expect(replay.recentClicks().map((k) => k.seq)).toEqual([1, 2]);
    replay.seek(1300 + 950);
    expect(replay.recentClicks()).toEqual([]);
  });
});

