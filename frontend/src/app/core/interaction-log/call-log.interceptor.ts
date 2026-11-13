import { HttpErrorResponse, HttpEvent, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Injectable, effect, inject, untracked } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { SessionStore } from '../session.store';
import { WebSocketService } from '../websocket.service';
import { InteractionLogService } from './interaction-log.service';

const MAX_RESPONSE_CACHE_ENTRIES = 64;

/**
 * One backend call as the browser saw it (docs/plans/experiment-logging-frontend-and-replay.md
 * §5.1.1), in stream `calls`. The envelope (`seq`, `t`, `simStep`, `mode`) is
 * the session record's; `seq` is also sent as `X-Client-Seq`, which joins the
 * entry to the server's log line (`client.seq`).
 */
export interface CallEntry {
  seq: number;
  t: number;
  simStep: number;
  mode: string;
  /** HTTP method, or `WS` for a WebSocket event (connect, close, episode_done, error). */
  method: string;
  url: string;
  body?: unknown;
  status: number;
  /** Round-trip in milliseconds. */
  ms: number;
  response?: unknown;
  /** The response was identical to this earlier entry's of the same call (polling). */
  response_same_as?: number;
}

/** Sequence counter and the last response per call, for deduplication. */
@Injectable({ providedIn: 'root' })
export class CallLog {
  private readonly log = inject(InteractionLogService);
  private readonly store = inject(SessionStore);
  private _seq = 0;
  private readonly _last = new Map<string, { seq: number; json: string }>();
  private _scope: { sid: string; logging: boolean; replay: boolean } | null = null;
  private _scopeGeneration = 0;

  constructor() {
    effect(() => { this.synchronizeScope(); });
    // WebSocket events as `WS` entries: connect and close, episode end, errors.
    // State messages are not calls; they go to the `states` stream (§5.4).
    const ws = inject(WebSocketService);
    let wasConnected = false;
    effect(() => {
      const connected = ws.connected();
      untracked(() => {
        if (connected === wasConnected) return;
        wasConnected = connected;
        this.recordWs(connected ? 'connect' : 'close');
      });
    });
    ws.messages.subscribe((msg) => {
      if (msg.type === 'episode_done' || msg.type === 'error') this.recordWs(msg.type, msg.message);
    });
  }

  nextSeq(): number {
    this._seq += 1;
    return this._seq;
  }

  /** Capture a request's logging lifetime; its reply cannot enter another one. */
  recordingScope(): number {
    return this.synchronizeScope().generation;
  }

  private synchronizeScope(): { sid: string; enabled: boolean; generation: number } {
    const sid = this.log.header()?.sessionId ?? '';
    const logging = this.log.studyLoggingActive();
    const replay = this.store.replayActive();
    if (!this._scope || this._scope.sid !== sid || this._scope.logging !== logging || this._scope.replay !== replay) {
      this._last.clear();
      this._scope = { sid, logging, replay };
      this._scopeGeneration += 1;
    }
    return { sid, enabled: !!sid && logging && !replay, generation: this._scopeGeneration };
  }

  /** Who sends: the participant id, or the condition id in a guided condition. */
  participant(): string {
    const header = this.log.header();
    return this.log.participantId() || header?.conditionId || '';
  }

  /** One WebSocket event of the current session. */
  recordWs(event: string, message?: string): void {
    const sid = this.log.header()?.sessionId ?? '';
    this.record({ seq: this.nextSeq(), t: Date.now(), method: 'WS', url: `/ws/session/${sid}`, status: 0, ms: 0, body: { event, ...(message ? { message } : {}) } });
  }

  /** Record one finished call. Never throws: logging must not break a request. */
  record(entry: Omit<CallEntry, 'simStep' | 'mode'>, requestScope?: number): void {
    try {
      // The effect may not have run after a session/toggle change yet. Check
      // synchronously before retaining or serialising any response/body.
      const scope = this.synchronizeScope();
      if (!scope.enabled || (requestScope !== undefined && requestScope !== scope.generation)) return;
      const full: CallEntry = { ...entry, simStep: this.store.elapsedSteps(), mode: this.store.interactionMode() };
      if (entry.response !== undefined) {
        const key = `${scope.sid} ${entry.method} ${entry.url}`;
        const json = JSON.stringify(entry.response);
        const last = this._last.get(key);
        // Touching an entry keeps the active-session cache in LRU order.
        this._last.delete(key);
        if (last && last.json === json) {
          delete full.response;
          full.response_same_as = last.seq;
          this._last.set(key, last);
        } else {
          this._last.set(key, { seq: entry.seq, json });
        }
        while (this._last.size > MAX_RESPONSE_CACHE_ENTRIES) {
          const oldest = this._last.keys().next().value;
          if (oldest === undefined) break;
          this._last.delete(oldest);
        }
      }
      this.log.appendStream('calls', full);
    } catch {
      // A response that can't be serialised is simply not logged.
    }
  }
}

/**
 * Requests never logged: the study sink itself (it uses raw `fetch` anyway)
 * and static files of the app (translations, `ui-config.json`), recognised by
 * a file extension, which no backend route has.
 */
const NOT_LOGGED = /\/study\/|\.[a-z0-9]+$/i;

/**
 * Logs every `HttpClient` call into stream `calls` and adds correlation
 * headers (`X-Client-Seq`, `X-Client-Time`, `X-Participant-Id`), so the
 * server's call log can be joined to the browser's and the clock offset
 * estimated. Writing is gated by "Study logging" (`appendStream`); the
 * headers are always sent, for the server log.
 */
export const callLogInterceptor: HttpInterceptorFn = (req, next): Observable<HttpEvent<unknown>> => {
  if (NOT_LOGGED.test(req.url.split('?')[0])) return next(req);
  const calls = inject(CallLog);
  const seq = calls.nextSeq();
  const t = Date.now();
  const participant = calls.participant();
  const requestScope = calls.recordingScope();
  const sent = req.clone({
    setHeaders: {
      'X-Client-Seq': String(seq),
      'X-Client-Time': String(t),
      ...(participant ? { 'X-Participant-Id': participant } : {}),
    },
  });
  const base = { seq, t, method: req.method, url: req.urlWithParams, ...(req.body != null ? { body: req.body } : {}) };
  return next(sent).pipe(
    tap({
      next: (event) => {
        if (event instanceof HttpResponse) {
          calls.record({ ...base, status: event.status, ms: Date.now() - t, response: event.body }, requestScope);
        }
      },
      error: (err: unknown) => {
        const status = err instanceof HttpErrorResponse ? err.status : 0;
        const response = err instanceof HttpErrorResponse ? err.error : String(err);
        calls.record({ ...base, status, ms: Date.now() - t, response }, requestScope);
      },
    }),
  );
};
