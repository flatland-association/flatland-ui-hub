import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BuildInfoService } from '../build-info.service';
import type { DecisionLogEntry } from '../decision-log';
import type { InteractionMode } from '../events/event-types';
import { LearningStore } from '../learning-store.service';
import type { SessionInfo } from '../models';
import { SessionStore } from '../session.store';
import { InteractionLogService } from './interaction-log.service';

function fakeStore() {
  return {
    session: signal<SessionInfo | null>(null),
    decisionLog: signal<DecisionLogEntry[]>([]),
    state: signal<unknown>(null),
    interactionMode: signal<InteractionMode>('recommendation'),
    activePolicy: signal('shortest_path'),
    playing: signal(false),
    playSpeedLevel: signal(1),
    reflectionRequested: signal(false),
    episodeDone: signal(false),
    shiftEnded: signal(false),
    kpiPriorities: signal<Record<string, number>>({ punctuality: 1 }),
    elapsedSteps: signal(0),
  };
}

function session(id: string): SessionInfo {
  return { id, width: 30, height: 20, num_agents: 4 };
}

function decision(t: number, seq: number): DecisionLogEntry {
  return { t, seq, simStep: 0, mode: 'recommendation', handle: 1 } as DecisionLogEntry;
}

describe('InteractionLogService', () => {
  let store: ReturnType<typeof fakeStore>;
  let log: InteractionLogService;

  beforeEach(() => {
    localStorage.clear();
    store = fakeStore();
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: store },
        { provide: LearningStore, useValue: { records: signal([]) } },
        { provide: BuildInfoService, useValue: { info: signal({ commit: 'test' }) } },
      ],
    });
    log = TestBed.inject(InteractionLogService);
    TestBed.tick();
  });

  afterEach(() => localStorage.clear());

  function start(id: string): void {
    store.session.set(session(id));
    TestBed.tick();
  }

  it('stamps participant and condition into the header when a session starts', () => {
    log.setParticipantId(' P07 ');
    log.setRunContext({ conditionId: 'cond-a', conditionLabel: 'A', layoutId: 'lay', tourId: null, scenarioId: 'x' });
    start('s1');

    const header = log.header()!;
    expect(header.sessionId).toBe('s1');
    expect(header.participantId).toBe('P07');
    expect(header.conditionId).toBe('cond-a');
    expect(header.layoutId).toBe('lay');
    expect(header.runIndex).toBe(1);
    expect(header.appVersion).toBe('test');
    expect(log.contextEvents().map((e) => e.type)).toEqual(['session_start']);
    expect(localStorage.getItem(InteractionLogService.RECORD_PREFIX + 's1')).not.toBeNull();
  });

  it('records a mode change as a context event with from and to', () => {
    start('s1');
    store.interactionMode.set('director');
    TestBed.tick();

    const change = log.contextEvents().find((e) => e.type === 'mode_change');
    expect(change?.payload).toEqual({ from: 'recommendation', to: 'director' });
    expect(change?.mode).toBe('director');
  });

  it('does not report the state before the session as changes', () => {
    store.interactionMode.set('co-learning');
    store.playing.set(true);
    TestBed.tick();
    start('s1');

    expect(log.contextEvents().map((e) => e.type)).toEqual(['session_start']);
    expect(log.header()!.mode).toBe('co-learning');
  });

  it('keeps decisions the store has cleared from its own log', () => {
    start('s1');
    store.decisionLog.set([decision(1, 1), decision(2, 2)]);
    TestBed.tick();
    store.decisionLog.set([]);
    TestBed.tick();
    store.decisionLog.set([decision(3, 1)]);
    TestBed.tick();

    expect(log.buildRecord()!.decisions.map((d) => d.t)).toEqual([1, 2, 3]);
  });

  it('closes the record when the next session starts and counts runs per participant', () => {
    log.setParticipantId('P07');
    start('s1');
    start('s2');

    const first = JSON.parse(localStorage.getItem(InteractionLogService.RECORD_PREFIX + 's1')!);
    expect(first.header.endedAt).not.toBeNull();
    expect(first.context.at(-1).type).toBe('session_end');
    expect(log.header()!.sessionId).toBe('s2');
    expect(log.header()!.runIndex).toBe(2);
    expect(log.savedRecords().map((s) => s.sessionId)).toEqual(['s2', 's1']);
  });

  it('clears saved records from the browser', () => {
    start('s1');
    log.clearSaved();
    expect(log.savedRecords()).toEqual([]);
    expect(localStorage.getItem(InteractionLogService.RECORD_PREFIX + 's1')).toBeNull();
  });
});
