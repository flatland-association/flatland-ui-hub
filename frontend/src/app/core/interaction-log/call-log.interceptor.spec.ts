import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Subject } from 'rxjs';
import { SessionStore } from '../session.store';
import { WebSocketService, WSMessage } from '../websocket.service';
import { CallEntry, callLogInterceptor } from './call-log.interceptor';
import { InteractionLogService } from './interaction-log.service';

describe('callLogInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let appendStream: jasmine.Spy;
  let ws: { connected: ReturnType<typeof signal<boolean>>; messages: Subject<WSMessage> };

  beforeEach(() => {
    appendStream = jasmine.createSpy('appendStream');
    ws = { connected: signal(false), messages: new Subject<WSMessage>() };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([callLogInterceptor])),
        provideHttpClientTesting(),
        {
          provide: InteractionLogService,
          useValue: { header: signal({ sessionId: 's1', conditionId: 'plan-b-p03' }), participantId: signal('P07'), appendStream },
        },
        { provide: SessionStore, useValue: { elapsedSteps: signal(12), interactionMode: signal('co-learning') } },
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
});
