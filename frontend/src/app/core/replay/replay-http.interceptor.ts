import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { SessionStore } from '../session.store';

/**
 * While a replay runs, no request leaves the browser
 * (docs/plans/experiment-logging-frontend-and-replay.md §9.2). Runs first in
 * `withInterceptors`, so the call log never sees a replayed request. Static
 * files of the app (translations, `ui-config.json`) still load.
 */
export const replayHttpInterceptor: HttpInterceptorFn = (req, next) => {
  if (!inject(SessionStore).replayActive() || STATIC_FILE.test(req.url.split('?')[0])) return next(req);
  return throwError(() => new HttpErrorResponse({ status: 404, statusText: 'Not recorded (replay)', url: req.urlWithParams }));
};

const STATIC_FILE = /\.[a-z0-9]+$/i;
