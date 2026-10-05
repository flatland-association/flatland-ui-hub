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
    targetStep: signal<number | null>(null),
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
  let fetchSpy: jasmine.Spy;
  let sinkEnabled: boolean;

  beforeEach(async () => {
    localStorage.clear();
    sinkEnabled = false;
    fetchSpy = spyOn(window, 'fetch').and.callFake(async (input: RequestInfo | URL) =>
      String(input).endsWith('/study/status')
        ? new Response(JSON.stringify({ sinkEnabled, backendVersion: '9.9.9' }), { status: 200 })
        : new Response('{}', { status: 200 }),
    );
    store = fakeStore();
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: store },
        { provide: LearningStore, useValue: { records: signal([]) } },
        { provide: BuildInfoService, useValue: { info: signal({ commit: 'test' }) } },
      ],
    });
  });

  async function create(): Promise<void> {
    log = TestBed.inject(InteractionLogService);
    TestBed.tick();
    // Let the /study/status request and its JSON body resolve.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
  }

  afterEach(() => localStorage.clear());

  function start(id: string): void {
    store.session.set(session(id));
    TestBed.tick();
  }

  function recordPuts(): jasmine.CallInfo<typeof fetch>[] {
    return fetchSpy.calls.all().filter((c) => (c.args[1] as RequestInit | undefined)?.method === 'PUT');
  }

  it('stamps participant and condition into the header when a session starts', async () => {
    await create();
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
    expect(header.backendVersion).toBe('9.9.9');
    expect(log.contextEvents().map((e) => e.type)).toEqual(['session_start']);
    expect(localStorage.getItem(InteractionLogService.RECORD_PREFIX + 's1')).not.toBeNull();
    expect(recordPuts().length).toBe(0);
    expect(log.sinkStatus()).toBe('off');
  });

  it('mirrors the record to the server when the sink is enabled', async () => {
    sinkEnabled = true;
    await create();
    start('s1');
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));

    const puts = recordPuts();
    expect(puts.length).toBe(1);
    expect(String(puts[0].args[0])).toMatch(/\/study\/records\/s1$/);
    expect(JSON.parse((puts[0].args[1] as RequestInit).body as string).header.sessionId).toBe('s1');
    expect(log.sinkStatus()).toBe('ok');
  });

  it('logs a manual step and a Director directive start', async () => {
    await create();
    start('s1');
    store.elapsedSteps.set(4);
    store.targetStep.set(9);
    TestBed.tick();
    store.targetStep.set(null);
    store.interactionMode.set('director');
    store.playing.set(true);
    TestBed.tick();

    const events = log.contextEvents();
    expect(events.find((e) => e.type === 'step')?.payload).toEqual({ from: 4, to: 9, n: 5 });
    const directive = events.find((e) => e.type === 'directive_start');
    expect(directive?.payload).toEqual({ policy: 'shortest_path', kpiPriorities: { punctuality: 1 }, resumed: true });
  });

  it('records a mode change as a context event with from and to', async () => {
    await create();
    start('s1');
    store.interactionMode.set('director');
    TestBed.tick();

    const change = log.contextEvents().find((e) => e.type === 'mode_change');
    expect(change?.payload).toEqual({ from: 'recommendation', to: 'director' });
    expect(change?.mode).toBe('director');
  });

  it('does not report the state before the session as changes', async () => {
    await create();
    store.interactionMode.set('co-learning');
    store.playing.set(true);
    TestBed.tick();
    start('s1');

    expect(log.contextEvents().map((e) => e.type)).toEqual(['session_start']);
    expect(log.header()!.mode).toBe('co-learning');
  });

  it('keeps decisions the store has cleared from its own log', async () => {
    await create();
    start('s1');
    store.decisionLog.set([decision(1, 1), decision(2, 2)]);
    TestBed.tick();
    store.decisionLog.set([]);
    TestBed.tick();
    store.decisionLog.set([decision(3, 1)]);
    TestBed.tick();

    expect(log.buildRecord()!.decisions.map((d) => d.t)).toEqual([1, 2, 3]);
  });

  it('closes the record when the next session starts and counts runs per participant', async () => {
    await create();
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

  it('clears saved records from the browser', async () => {
    await create();
    start('s1');
    log.clearSaved();
    expect(log.savedRecords()).toEqual([]);
    expect(localStorage.getItem(InteractionLogService.RECORD_PREFIX + 's1')).toBeNull();
  });
});
