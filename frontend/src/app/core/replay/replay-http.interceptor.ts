import { HttpErrorResponse, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { of, throwError } from 'rxjs';
import type { CallEntry } from '../interaction-log/call-log.interceptor';
import { SessionStore } from '../session.store';
import { ReplayService } from './replay.service';
import { responseAt } from './replay-timeline';

/**
 * While a replay runs, every request is answered from the recorded calls of
 * the leg on screen, and none leaves the browser
 * (docs/plans/experiment-logging-frontend-and-replay.md §9.2): the same
 * method and URL, the latest response at or before the replay time (else
 * the first after it). A call that was never made gets a 404. Runs first in
 * `withInterceptors`, so the call log never sees a replayed request. Static
 * files of the app (translations, `ui-config.json`) still load.
 */
export const replayHttpInterceptor: HttpInterceptorFn = (req, next) => {
  if (!inject(SessionStore).replayActive() || STATIC_FILE.test(req.url.split('?')[0])) return next(req);
  const replay = inject(ReplayService);
  const calls = (replay.leg()?.calls ?? []) as CallEntry[];
  const hit = responseAt(calls, req.method, req.urlWithParams, replay.time());
  if (!hit) return throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not recorded (replay)', url: req.urlWithParams }));
  if (hit.status >= 400 || hit.status === 0) {
    return throwError(() => new HttpErrorResponse({ status: hit.status, error: hit.body, url: req.urlWithParams }));
  }
  return of(new HttpResponse({ status: hit.status, body: hit.body, url: req.urlWithParams }));
};

const STATIC_FILE = /\.[a-z0-9]+$/i;
