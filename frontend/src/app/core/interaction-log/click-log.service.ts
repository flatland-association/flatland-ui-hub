import { Injectable, inject } from '@angular/core';
import { SessionStore } from '../session.store';
import { InteractionLogService } from './interaction-log.service';
import { ViewTracker } from './view-tracker.service';

/** A domain object a click was about, attached by the handler that knows it. */
export type ClickObject =
  | { kind: 'agent'; handle: number }
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'station'; id: string }
  | { kind: 'pill'; handle: number; action: string }
  | { kind: 'option'; handle: number; option: string }
  | { kind: string; [key: string]: unknown };

/** Where in the domain a map or Marey click landed (Q32). */
export type ClickPosition = { row: number; col: number } | { step: number; pos: number };

/**
 * One click (docs/plans/experiment-logging-frontend-and-replay.md §5.2), in
 * stream `clicks`. Same envelope as the record's events.
 */
export interface ClickEvent {
  seq: number;
  t: number;
  simStep: number;
  mode: string;
  /** `data-log` id (a translation key), else the element id, else a fallback. */
  target: string;
  /** Closest `[data-panel-type]`, if any. */
  panel: string | null;
  view: string | null;
  object?: ClickObject;
  at?: ClickPosition;
  /** A click into a text field: its value is never logged. */
  field?: true;
}

/**
 * Logs every click, with one capture-phase listener on `document`
 * (pattern P9). The click is written after the event has been dispatched, so
 * the handler that knows the domain object can attach it with `object()` or
 * `at()`; no SVG element needs a `data-*` attribute. Gated like every stream
 * by "Study logging"; the start screen is not logged (Q14).
 */
@Injectable({ providedIn: 'root' })
export class ClickLogService {
  private readonly log = inject(InteractionLogService);
  private readonly store = inject(SessionStore);
  private readonly views = inject(ViewTracker);
  private _seq = 0;
  private _sid: string | null = null;
  private _open: ClickEvent | null = null;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('click', (ev) => this._capture(ev), { capture: true });
    }
  }

  /** The handler's domain object for the click being dispatched. */
  object(obj: ClickObject): void {
    if (this._open) this._open.object = obj;
  }

  /** The domain position of the click being dispatched (map cell, or Marey step and position). */
  at(pos: ClickPosition): void {
    if (this._open) this._open.at = pos;
  }

  private _capture(ev: MouseEvent): void {
    const sid = this.log.header()?.sessionId ?? null;
    const view = this.views.currentView()?.view ?? null;
    if (!sid || !this.log.studyLoggingActive() || view === 'start') return;
    if (sid !== this._sid) {
      this._sid = sid;
      this._seq = 0;
    }
    const path = ev.composedPath().filter((n): n is Element => n instanceof Element);
    const click: ClickEvent = {
      seq: ++this._seq,
      t: Date.now(),
      simStep: this.store.elapsedSteps(),
      mode: this.store.interactionMode(),
      target: resolveTarget(path),
      panel: path.find((el) => el.hasAttribute('data-panel-type'))?.getAttribute('data-panel-type') ?? null,
      view,
      ...(isTextField(path[0]) ? { field: true as const } : {}),
    };
    this._open = click;
    // After the click has reached its handlers, which may attach object or position.
    setTimeout(() => {
      if (this._open === click) this._open = null;
      this.log.appendStream('clicks', click);
    });
  }
}

/** `data-log` wins, then `id`, then the tag with its position among same-tag siblings. */
export function resolveTarget(path: Element[]): string {
  for (const el of path) {
    const id = el.getAttribute('data-log');
    if (id) return id;
  }
  const withId = path.find((el) => el.id);
  if (withId) return `#${withId.id}`;
  // Prefer a meaningful host (an SBB Lyne component or a native control) over inner spans.
  const host = path.find((el) => el.tagName.includes('-') || ['BUTTON', 'A', 'INPUT', 'SELECT', 'LABEL'].includes(el.tagName)) ?? path[0];
  if (!host) return 'unknown';
  const tag = host.tagName.toLowerCase();
  const siblings = host.parentElement ? Array.from(host.parentElement.children).filter((c) => c.tagName === host.tagName) : [];
  return siblings.length > 1 ? `${tag}[${siblings.indexOf(host)}]` : tag;
}

function isTextField(el: Element | undefined): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return (el as HTMLElement).isContentEditable === true;
  const type = (el as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(type);
}
