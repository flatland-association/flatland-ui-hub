import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { SessionStore } from '../session.store';
import { WebSocketService, WSMessage } from '../websocket.service';
import { CallEntry, CallLog, callLogInterceptor } from './call-log.interceptor';
import { InteractionLogService } from './interaction-log.service';

describe('callLogInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let appendStream: jasmine.Spy;
  let ws: { connected: ReturnType<typeof signal<boolean>>; messages: Subject<WSMessage> };
  let header: ReturnType<typeof signal<{ sessionId: string; conditionId: string } | null>>;
  let logging: ReturnType<typeof signal<boolean>>;
  let replay: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    appendStream = jasmine.createSpy('appendStream');
    ws = { connected: signal(false), messages: new Subject<WSMessage>() };
    header = signal<{ sessionId: string; conditionId: string } | null>({ sessionId: 's1', conditionId: 'plan-b-p03' });
    logging = signal(true);
    replay = signal(false);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([callLogInterceptor])),
        provideHttpClientTesting(),
        {
          provide: InteractionLogService,
          useValue: { header, studyLoggingActive: logging, participantId: signal('P07'), appendStream },
        },
        { provide: SessionStore, useValue: { elapsedSteps: signal(12), interactionMode: signal('co-learning'), replayActive: replay } },
        { provide: WebSocketService, useValue: ws },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  const entries = () => appendStream.calls.allArgs().filter(([s]) => s === 'calls').map(([, e]) => e as CallEntry);

  it('sends the correlation headers and logs request and response', () => {
    http.post('/session/s1/step', { n: 3 }).subscribe();
    const req = backend.expectOne('/session/s1/step');
    expect(req.request.headers.get('X-Client-Seq')).toBe('1');
    expect(req.request.headers.get('X-Participant-Id')).toBe('P07');
    expect(Number(req.request.headers.get('X-Client-Time'))).toBeGreaterThan(0);
    req.flush({ ok: true });
    const [entry] = entries();
    expect(entry).toEqual(jasmine.objectContaining({
      seq: 1, method: 'POST', url: '/session/s1/step', body: { n: 3 }, status: 200, response: { ok: true }, simStep: 12, mode: 'co-learning',
    }));
  });

  it('a repeated identical response is a reference to the first', () => {
    http.get('/session/s1/state').subscribe();
    backend.expectOne('/session/s1/state').flush({ step: 1 });
    http.get('/session/s1/state').subscribe();
    backend.expectOne('/session/s1/state').flush({ step: 1 });
    const [first, second] = entries();
    expect(first.response).toEqual({ step: 1 });
    expect(second.response).toBeUndefined();
    expect(second.response_same_as).toBe(first.seq);
  });

  it('logs failed calls with their status', () => {
    http.get('/session/s1/state').subscribe({ error: () => undefined });
    backend.expectOne('/session/s1/state').flush({ detail: 'gone' }, { status: 404, statusText: 'Not Found' });
    expect(entries()[0]).toEqual(jasmine.objectContaining({ status: 404, response: { detail: 'gone' } }));
  });

  it('leaves static files and the study sink alone', () => {
    http.get('/i18n/de.json').subscribe();
    const asset = backend.expectOne('/i18n/de.json');
    expect(asset.request.headers.has('X-Client-Seq')).toBeFalse();
    asset.flush({});
    expect(entries()).toEqual([]);
  });

  it('logs WebSocket connect, episode end and close as WS entries', () => {
    http.get('/policies').subscribe(); // creates the call log
    backend.expectOne('/policies').flush([]);
    ws.connected.set(true);
    TestBed.tick();
    ws.messages.next({ type: 'state' });
    ws.messages.next({ type: 'episode_done' });
    ws.connected.set(false);
    TestBed.tick();
    const events = entries().filter((e) => e.method === 'WS').map((e) => (e.body as { event: string }).event);
    expect(events).toEqual(['connect', 'episode_done', 'close']);
  });

  for (const gate of ['no-header', 'logging-off', 'replay'] as const) {
    it(`keeps correlation headers without retaining responses when ${gate}`, () => {
      if (gate === 'no-header') header.set(null);
      if (gate === 'logging-off') logging.set(false);
      if (gate === 'replay') replay.set(true);
      http.get('/session/s1/state').subscribe();
      const req = backend.expectOne('/session/s1/state');
      expect(req.request.headers.get('X-Client-Seq')).toBe('1');
      expect(req.request.headers.get('X-Participant-Id')).toBe('P07');
      const serialize = spyOn(JSON, 'stringify').and.callThrough();
      req.flush({ large: 'response' });
      expect(serialize).not.toHaveBeenCalled();
      expect(appendStream).not.toHaveBeenCalled();
      ws.messages.next({ type: 'episode_done' });
      expect(appendStream).not.toHaveBeenCalled();
    });
  }

  it('clears old-session responses synchronously before the scope effect runs', () => {
    const calls = TestBed.inject(CallLog);
    const record = (seq: number) => calls.record({ seq, t: 1, method: 'GET', url: '/policies', status: 200, ms: 0, response: ['actor'] });
    record(1);
    header.set({ sessionId: 's2', conditionId: 'plan-b-p03' });
    record(2);
    header.set({ sessionId: 's1', conditionId: 'plan-b-p03' });
    record(3);
    expect(entries().map(entry => entry.response)).toEqual([['actor'], ['actor'], ['actor']]);
    expect(entries().every(entry => entry.response_same_as === undefined)).toBeTrue();
  });

  for (const gate of ['logging', 'replay'] as const) {
    it(`clears deduplication when ${gate} changes off and on`, () => {
      const calls = TestBed.inject(CallLog);
      const record = (seq: number) => calls.record({ seq, t: 1, method: 'GET', url: '/policies', status: 200, ms: 0, response: ['actor'] });
      record(1);
      if (gate === 'logging') logging.set(false); else replay.set(true);
      record(2); // Observe the gate synchronously, before any Angular effect.
      if (gate === 'logging') logging.set(true); else replay.set(false);
      record(3);
      record(4);
      expect(entries().map(entry => entry.seq)).toEqual([1, 3, 4]);
      expect(entries()[1].response).toEqual(['actor']);
      expect(entries()[2].response_same_as).toBe(3);
    });
  }

  it('scope effects release cached responses even when no further call arrives', () => {
    const calls = TestBed.inject(CallLog);
    calls.record({ seq: 1, t: 1, method: 'GET', url: '/policies', status: 200, ms: 0, response: ['actor'] });
    logging.set(false);
    TestBed.tick();
    logging.set(true);
    calls.record({ seq: 2, t: 1, method: 'GET', url: '/policies', status: 200, ms: 0, response: ['actor'] });
    expect(entries()[1].response).toEqual(['actor']);
    expect(entries()[1].response_same_as).toBeUndefined();
  });

  it('does not attach a previous-scope in-flight response to the next session', () => {
    http.get('/session/s1/state').subscribe();
    const old = backend.expectOne('/session/s1/state');
    header.set({ sessionId: 's2', conditionId: 'plan-b-p03' });
    old.flush({ previousSession: true });
    expect(appendStream).not.toHaveBeenCalled();
    http.get('/session/s2/state').subscribe();
    backend.expectOne('/session/s2/state').flush({ currentSession: true });
    expect(entries().map(entry => entry.response)).toEqual([{ currentSession: true }]);
  });

  it('does not capture a call started with logging off after logging resumes', () => {
    logging.set(false);
    http.get('/session/s1/state').subscribe();
    const old = backend.expectOne('/session/s1/state');
    logging.set(true);
    old.flush({ madeWhileOff: true });
    expect(appendStream).not.toHaveBeenCalled();
  });

  it('bounds the active cache and emits a complete response after eviction', () => {
    const calls = TestBed.inject(CallLog);
    const record = (seq: number, url: string) => calls.record({ seq, t: 1, method: 'GET', url, status: 200, ms: 0, response: { full: 'not truncated' } });
    record(1, '/first');
    for (let i = 0; i < 64; i++) record(i + 2, `/other/${i}`);
    record(66, '/first');
    record(67, '/first');
    expect(entries()[65].response).toEqual({ full: 'not truncated' });
    expect(entries()[65].response_same_as).toBeUndefined();
    expect(entries()[66].response_same_as).toBe(66);
    expect(entries().slice(0, 66).every(entry => entry.response !== undefined)).toBeTrue();
  });

  it('keeps a hot deduplication entry when colder entries are evicted', () => {
    const calls = TestBed.inject(CallLog);
    const record = (seq: number, url: string) => calls.record({ seq, t: 1, method: 'GET', url, status: 200, ms: 0, response: { ok: true } });
    record(1, '/hot');
    for (let i = 0; i < 63; i++) record(i + 2, `/other/${i}`);
    record(65, '/hot');
    record(66, '/new');
    record(67, '/hot');
    expect(entries()[64].response_same_as).toBe(1);
    expect(entries()[66].response_same_as).toBe(1);
  });
});
