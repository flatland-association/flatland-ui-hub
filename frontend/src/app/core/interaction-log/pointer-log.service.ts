import { Injectable, inject } from '@angular/core';
import { InteractionLogService } from './interaction-log.service';
import { ViewTracker } from './view-tracker.service';

/** At most one pointer sample per this many ms (Q35). */
export const POINTER_SAMPLE_MS = 200;
/** A movement shorter than this (px) since the last sample is not logged. */
export const POINTER_MIN_PX = 4;
/** A window resize is logged once it has been quiet this long. */
const RESIZE_QUIET_MS = 300;

/**
 * One pointer sample (docs/plans/experiment-logging-frontend-and-replay.md
 * §5.2.1), in stream `pointer`. Positions are shares (0–1) of the window,
 * and inside a panel also of that panel's box, so they fit any window size.
 * `out` marks that the pointer left the window or the tab was hidden.
 */
export interface PointerSample {
  t: number;
  x?: number;
  y?: number;
  panel?: string;
  px?: number;
  py?: number;
  out?: true;
}

interface Pending {
  cx: number;
  cy: number;
  panel: Element | null;
}

/**
 * Logs where the pointer moves and rests (§5.2.1, Q35 b): a sample while it
 * moves, at most every `POINTER_SAMPLE_MS` and only after `POINTER_MIN_PX`,
 * with a trailing sample where a movement stops; nothing while it rests, so
 * the gap between two samples is the dwell. Mouse and pen only. Gated like
 * every stream ("Study logging", not on the start screen, not in a replay);
 * the window size is the header's `screen`, and a resize a `ui_state`.
 */
@Injectable({ providedIn: 'root' })
export class PointerLogService {
  private readonly log = inject(InteractionLogService);
  private readonly views = inject(ViewTracker);


  private _last: { t: number; cx: number; cy: number } | null = null;
  private _pending: Pending | null = null;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _out = true;
  private _resizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof document === 'undefined') return;
    document.addEventListener('pointermove', (e) => this._move(e), { capture: true, passive: true });
    // Leaving the window: a mouseout without a new target.
    document.addEventListener('mouseout', (e) => {
      if (!e.relatedTarget) this._leave();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._leave();
    });
    // A resize as `ui_state` key `screen`, once it has settled. Logged directly, not through
    // `UiStateRegistry`, so a replay never writes a recorded size back.
    window.addEventListener('resize', () => {
      if (this._resizeTimer != null) clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => {
        this._resizeTimer = null;
        if (this._logging()) this.log.noteUiState('screen', screenNow());
      }, RESIZE_QUIET_MS);
    });
  }

  private _logging(): boolean {
    return !!this.log.header() && this.log.studyLoggingActive() && this.views.currentView()?.view !== 'start';
  }

  private _move(e: PointerEvent): void {
    if (e.pointerType === 'touch' || !this._logging()) return;
    const last = this._last;
    if (last && Math.hypot(e.clientX - last.cx, e.clientY - last.cy) < POINTER_MIN_PX) return;
    const path = e.composedPath().filter((n): n is Element => n instanceof Element);
    this._pending = { cx: e.clientX, cy: e.clientY, panel: path.find((el) => el.hasAttribute('data-panel-type')) ?? null };
    const now = Date.now();
    if (!last || now - last.t >= POINTER_SAMPLE_MS) {
      this._write(now);
    } else if (this._timer == null) {
      // The trailing sample: the latest position once the interval is over.
      this._timer = setTimeout(() => {
        this._timer = null;
        this._write(Date.now());
      }, POINTER_SAMPLE_MS - (now - last.t));
    }
  }

  private _write(t: number): void {
    const p = this._pending;
    if (!p) return;
    this._pending = null;
    const sample: PointerSample = { t, x: share(p.cx, window.innerWidth), y: share(p.cy, window.innerHeight) };
    const box = p.panel?.getBoundingClientRect();
    if (p.panel && box && box.width > 0 && box.height > 0) {
      sample.panel = p.panel.getAttribute('data-panel-type')!;
      sample.px = share(p.cx - box.left, box.width);
      sample.py = share(p.cy - box.top, box.height);
    }
    this.log.appendStream('pointer', sample);
    this._last = { t, cx: p.cx, cy: p.cy };
    this._out = false;
  }

  private _leave(): void {
    if (this._timer != null) clearTimeout(this._timer);
    this._timer = null;
    this._pending = null;
    this._last = null;
    if (this._out || !this._logging()) return;
    this._out = true;
    this.log.appendStream('pointer', { t: Date.now(), out: true } satisfies PointerSample);
  }
}

function share(v: number, of: number): number {
  return of > 0 ? Math.round(Math.min(1, Math.max(0, v / of)) * 1000) / 1000 : 0;
}

function screenNow(): { width: number; height: number; dpr: number } {
  if (typeof window === 'undefined') return { width: 0, height: 0, dpr: 1 };
  return { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 };
}
