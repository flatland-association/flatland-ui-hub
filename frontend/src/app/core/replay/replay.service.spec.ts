import { signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import type { AgentDTO, SessionInfo, SessionState } from '../models';
import { SessionStore } from '../session.store';
import { WebSocketService } from '../websocket.service';
import { UiStateRegistry } from '../interaction-log/ui-state-registry.service';
import type { SessionRecord } from '../interaction-log/session-record';
import type { StateFrame } from '../interaction-log/state-log.service';
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
      applyReplayState: jasmine.createSpy('applyReplayState').and.callFake((s: SessionState) => store.state.set(s)),
    };
    ws = { disconnect: jasmine.createSpy('disconnect') };
    uiState = { apply: jasmine.createSpy('apply') };
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: store },
        { provide: WebSocketService, useValue: ws },
        { provide: UiStateRegistry, useValue: uiState },
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
});

