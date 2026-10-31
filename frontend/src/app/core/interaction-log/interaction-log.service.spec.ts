import type { SessionRecord } from './session-record';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BuildInfoService } from '../build-info.service';
import type { DecisionLogEntry } from '../decision-log';
import type { InteractionMode } from '../events/event-types';
import { LearningStore } from '../learning-store.service';
import { UiConfigService } from '../config/ui-config.service';
import { OperatorModelService } from '../operator-model.service';
import type { SessionInfo } from '../models';
import { SessionStore } from '../session.store';
import { InteractionLogService } from './interaction-log.service';
import { StreamStore } from './stream-store';

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
    replayActive: signal(false),
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
  const deployment = signal<boolean | null>(null);

  beforeEach(async () => {
    localStorage.clear();
    sinkEnabled = false;
    fetchSpy = spyOn(window, 'fetch').and.callFake(async (input: RequestInfo | URL) =>
      String(input).endsWith('/study/status')
        ? new Response(JSON.stringify({ sinkEnabled, backendVersion: '9.9.9' }), { status: 200 })
        : new Response('{}', { status: 200 }),
    );
    store = fakeStore();
    deployment.set(null);
    TestBed.configureTestingModule({
      providers: [
        { provide: SessionStore, useValue: store },
        { provide: LearningStore, useValue: { records: signal([]) } },
        { provide: BuildInfoService, useValue: { info: signal({ commit: 'test' }) } },
        { provide: OperatorModelService, useValue: { operatorId: signal('operator1') } },
        { provide: UiConfigService, useValue: { studyLogging: deployment } },
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

  it('writes streams only while "Study logging" is on', async () => {
    await create();
    const streams = TestBed.inject(StreamStore);
    const append = spyOn(streams, 'append');
    start('s1');
    log.appendStream('clicks', { n: 1 });
    expect(append).not.toHaveBeenCalled();

    log.setStudyLogging(true);
    log.appendStream('clicks', { n: 2 });
    expect(append).toHaveBeenCalledOnceWith('s1', 'clicks', { n: 2 });
    expect(localStorage.getItem(InteractionLogService.STUDY_LOGGING_KEY)).toBe('1');
  });

  it('lets a definition enforce "Study logging" over the setting', async () => {
    await create();
    log.setStudyLogging(true);
    log.setRunContext({ studyLogging: false });
    expect(log.studyLoggingEnforced()).toBeFalse();
    expect(log.studyLoggingActive()).toBeFalse();
    log.setRunContext({ studyLogging: null });
    expect(log.studyLoggingActive()).toBeTrue();
  });

  it('lets the deployment fix "Study logging", below the definition', async () => {
    await create();
    deployment.set(false);
    log.setStudyLogging(true);
    expect(log.studyLoggingSource()).toBe('deployment');
    expect(log.studyLoggingActive()).toBeFalse();
    log.setRunContext({ studyLogging: true });
    expect(log.studyLoggingSource()).toBe('definition');
    expect(log.studyLoggingActive()).toBeTrue();
  });

  it('records the operator profile and record version 3', async () => {
    await create();
    start('s1');
    const record = log.buildRecord()!;
    expect(record.version).toBe(3);
    expect(record.header.operatorId).toBe('operator1');
  });

  it('keeps the UI language with submitted answers', async () => {
    await create();
    start('s1');
    localStorage.setItem('flatland_survey_s1_post-session-recommendation', JSON.stringify({ q1: 4 }));
    log.noteSurveySubmitted('post-session-recommendation', 'de');
    const [survey] = log.buildRecord()!.surveys;
    expect(survey).toEqual(jasmine.objectContaining({ surveyId: 'post-session-recommendation', answers: { q1: 4 }, lang: 'de' }));
  });

  it('keeps a guided leg questionnaire and the final one apart, though they share a survey id', async () => {
    await create();
    start('s1');
    localStorage.setItem('flatland_survey_s1_post-session-co-learning', JSON.stringify({ q1: 2 }));
    log.noteQuestionnaire({ surveyId: 'post-session-co-learning', answers: { q1: 4 }, submittedAt: 1, lang: 'de', afterLegId: 'leg-1' });
    log.noteQuestionnaire({ surveyId: 'post-session-co-learning', answers: { q1: 2 }, submittedAt: 2, lang: 'de', afterLegId: null });
    const surveys = log.buildRecord()!.surveys;
    expect(surveys.map((q) => [q.afterLegId, q.answers['q1']])).toEqual([['leg-1', 4], [null, 2]]);
  });

  it('clears saved records from the browser', async () => {
    await create();
    start('s1');
    log.clearSaved();
    expect(log.savedRecords()).toEqual([]);
    expect(localStorage.getItem(InteractionLogService.RECORD_PREFIX + 's1')).toBeNull();
  });

  it('deletes only the selected sessions, with their answers, and does not write them back', async () => {
    await create();
    start('s1');
    start('s2');
    localStorage.setItem('flatland_survey_s2_post-session-recommendation', '{}');
    localStorage.setItem('flatland_survey_s1_post-session-recommendation', '{}');
    log.autosave();
    log.deleteSaved(['s2']);
    log.autosave();
    expect(log.savedRecords().map((r) => r.sessionId)).toEqual(['s1']);
    expect(localStorage.getItem(InteractionLogService.RECORD_PREFIX + 's2')).toBeNull();
    expect(localStorage.getItem('flatland_survey_s2_post-session-recommendation')).toBeNull();
    expect(localStorage.getItem('flatland_survey_s1_post-session-recommendation')).toBe('{}');
  });

  it('keeps imported records in memory, skips known sessions, and lists and deletes them with the rest', async () => {
    await create();
    start('s1');
    log.autosave();
    const imported = (id: string) => ({ header: { sessionId: id } }) as unknown as SessionRecord;
    expect(log.addImported([imported('s1'), imported('x1'), imported('x1'), imported('x2')])).toBe(2);
    expect(log.loadSavedRecords().map((r) => r.header.sessionId)).toEqual(['s1', 'x1', 'x2']);
    expect(localStorage.getItem(InteractionLogService.RECORD_PREFIX + 'x1')).toBeNull();
    log.deleteSaved(['x1']);
    expect(log.importedRecords().map((r) => r.header.sessionId)).toEqual(['x2']);
  });

  it('writes and saves nothing while a replay runs, and ignores the replayed session', async () => {
    await create();
    log.setStudyLogging(true);
    start('s1');
    const contextBefore = log.contextEvents().length;
    store.replayActive.set(true);
    store.session.set(session('recorded'));
    TestBed.tick();
    store.interactionMode.set('director');
    TestBed.tick();
    log.noteUiState('map.viewport', { zoom: 2 });
    expect(log.header()!.sessionId).toBe('s1');
    expect(log.contextEvents().length).toBe(contextBefore);
  });
});

