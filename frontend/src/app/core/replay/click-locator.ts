import { DestroyRef, Injectable } from '@angular/core';
import type { ClickEvent } from '../interaction-log/click-log.service';

/** A point on screen (client pixels). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Turns what a click hit in a component (a train, a map cell, a Marey point) into a point on
 *  screen, or null where that component cannot place it. */
export type PositionLocator = (click: Pick<ClickEvent, 'at' | 'object'>) => ScreenPoint | null;

/**
 * Where a replayed click goes on screen
 * (docs/plans/experiment-logging-frontend-and-replay.md §9.2, click splashes).
 * A click carries no screen coordinates, only what it hit: a train, a map
 * cell or a Marey point, else its target (`data-log` id, element id, or tag).
 * The map and the Marey chart register the inverse of their own click
 * calculation here, so the replay needs none of their internals. A click
 * that cannot be placed for sure is left out rather than drawn elsewhere.
 */
@Injectable({ providedIn: 'root' })
export class ClickLocator {
  private readonly _locators: PositionLocator[] = [];

  /** Offer a position locator while the component lives. */
  register(locate: PositionLocator, destroyRef?: DestroyRef): () => void {
    this._locators.push(locate);
    const off = () => {
      const i = this._locators.indexOf(locate);
      if (i >= 0) this._locators.splice(i, 1);
    };
    destroyRef?.onDestroy(off);
    return off;
  }

  /** The point a click goes to now, or null if its place is not on screen. */
  locate(click: ClickEvent, root: ParentNode = document): ScreenPoint | null {
    if (click.at || click.object) {
      for (const locate of this._locators) {
        const p = locate(click);
        if (p) return p;
      }
    }
    const el = targetElement(click, root);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
  }
}

/** The screen the replay draws for a logged view, to look a tag up in (not the working screen behind it). */
const VIEW_ROOTS: Record<string, string> = {
  mode_intro: 'app-mode-intro',
  experiment: 'app-tour-briefing',
  survey: '.replay-screen app-survey',
};

/**
 * The element a click's target names: its `data-log` id, its `#id`, or for
 * the fallback `tag` / `tag[i]` the one element with that tag (and that index
 * among same-tag siblings) inside its panel, else inside its screen. Null when
 * that is ambiguous (e.g. the same rating button in every questionnaire row)
 * or the id was generated (`…-4`: Lyne numbers its elements per page load).
 */
export function targetElement(click: Pick<ClickEvent, 'target' | 'panel' | 'view'>, root: ParentNode = document): Element | null {
  const { target } = click;
  const panel = click.panel ? root.querySelector(`[data-panel-type="${cssEscape(click.panel)}"]`) : null;
  if (target.startsWith('#')) return /-\d+$/.test(target) ? null : root.querySelector(`#${cssEscape(target.slice(1))}`);
  const byId = (panel ?? root).querySelector(`[data-log="${cssEscape(target)}"]`) ?? root.querySelector(`[data-log="${cssEscape(target)}"]`);
  if (byId) return byId;
  const m = /^([a-z][\w-]*)(?:\[(\d+)\])?$/.exec(target);
  if (!m) return null;
  const scope = panel ?? (click.view && VIEW_ROOTS[click.view] ? root.querySelector(VIEW_ROOTS[click.view]) : null) ?? root;
  const index = m[2] == null ? null : Number(m[2]);
  // As `resolveTarget` names them: no index for an element without same-tag siblings.
  const matches = Array.from(scope.querySelectorAll(m[1])).filter((el) => {
    const siblings = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.tagName === el.tagName) : [el];
    return index == null ? siblings.length === 1 : siblings.length > 1 && siblings.indexOf(el) === index;
  });
  return matches.length === 1 ? matches[0] : null;
}

function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}
