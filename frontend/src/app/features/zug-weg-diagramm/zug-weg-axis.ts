import type { SceneGeography, } from '../../core/models';
import type { ContentionGroup } from '../../core/events/event-types';

/**
 * The corridor axis of the Zug-Weg-Diagramm, and the geometry the widget draws
 * on it. Kept free of Angular so it reads (and tests) as plain data.
 *
 * v1 axis path (spec docs/plans/widget-b4-zug-weg-diagramm.md §8.1): the scene's
 * own geography, not `StationsLinks`. The PF–CH scenes are corridors — rows are
 * parallel tracks — so a cell's position along the line is its column, the same
 * reading `SessionStore.sectionForCell` uses.
 */

export interface AxisTick {
  code: string;
  name: string;
  /** Grid column — the position along the corridor. */
  col: number;
  /** A station with platform tracks (major tick) or a place modelled without
   *  tracks, e.g. Mühlehorn (minor tick). */
  major: boolean;
}

export interface CorridorAxis {
  ticks: AxisTick[];
  /** The single-track section as a column range, when the scene names one. */
  singleTrack: { fromCol: number; toCol: number; from: string; to: string } | null;
}

/**
 * Stations with tracks come from `stations` (one entry per platform track,
 * collapsed per code, placed at their platform column `x`) — the axis the spec
 * fixes. Places without tracks come from `locations` (`locationColumns`), only
 * for codes the stations don't already cover: their columns sit a few cells
 * west of the platforms, so mixing the two sources for one code would misplace
 * it.
 */
export function buildCorridorAxis(geo: SceneGeography | null): CorridorAxis | null {
  // Only a corridor has "position = column". A named network (Olten) needs an
  // axis along a chosen A→B route instead (docs/plans/zug-weg-route-selection.md).
  if (!geo || geo.stations.length === 0 || geo.layout !== 'corridor') return null;

  const byCode = new Map<string, AxisTick>();
  for (const s of geo.stations) {
    const code = s.code ?? s.name;
    const col = Number(s.cell[1]);
    const prev = byCode.get(code);
    if (!prev) byCode.set(code, { code, name: s.name, col, major: true });
    else prev.col = Math.min(prev.col, col);
  }
  for (const l of geo.locations) {
    if (byCode.has(l.code)) continue;
    byCode.set(l.code, { code: l.code, name: l.name, col: l.col, major: false });
  }
  const ticks = [...byCode.values()].sort((a, b) => a.col - b.col);

  let singleTrack: CorridorAxis['singleTrack'] = null;
  if (geo.single_track.length === 2) {
    const [a, b] = geo.single_track.map((c) => byCode.get(c));
    if (a && b) {
      const [lo, hi] = a.col <= b.col ? [a, b] : [b, a];
      singleTrack = { fromCol: lo.col, toCol: hi.col, from: lo.name, to: hi.name };
    }
  }
  return { ticks, singleTrack };
}

/** Named stretch of the corridor covering [fromCol, toCol]: the nearest tick
 *  at or before the start and at or after the end. One name when both ends
 *  resolve to the same place. Null outside the named places. */
export function sectionName(axis: CorridorAxis, fromCol: number, toCol: number): string | null {
  const lo = Math.min(fromCol, toCol);
  const hi = Math.max(fromCol, toCol);
  let before: AxisTick | null = null;
  let after: AxisTick | null = null;
  for (const t of axis.ticks) {
    if (t.col <= lo) before = t;
    if (t.col >= hi && !after) after = t;
  }
  if (!before && !after) return null;
  if (!before || !after) return (before ?? after)!.name;
  return before.code === after.code ? before.name : `${before.name} – ${after.name}`;
}

/** One point of a train line: step on the time axis, column on the corridor. */
export interface LinePoint {
  step: number;
  col: number;
}

/** A contention placed on the axis: a band in column × time. */
export interface ContentionBand {
  key: string;
  handles: number[];
  kind: ContentionGroup['kind'];
  fromCol: number;
  toCol: number;
  fromStep: number;
  toStep: number;
  section: string | null;
  singleTrack: boolean;
}

/**
 * Column × time extent of a forecast contention. Columns span the contended
 * window (the path-overlap the backend computed); time spans the first entry
 * of any contender to the last presence of any, from `perHandle`. Where the
 * backend could not derive those (swap/deadlock kinds carry no window, a
 * handle may never enter it), the band falls back to the group's step and
 * representative cell — narrower, never invented.
 */
export function contentionBand(g: ContentionGroup, axis: CorridorAxis): ContentionBand | null {
  const cols = (g.window ?? []).map((c) => Number(c[1]));
  if (cols.length === 0 && g.position) cols.push(Number(g.position[1]));
  if (cols.length === 0) return null;
  const fromCol = Math.min(...cols);
  const toCol = Math.max(...cols);

  let fromStep = g.step;
  let toStep = g.step;
  for (const m of g.perHandle ?? []) {
    const entry = m.baselineOrder?.value;
    if (entry == null) continue;
    fromStep = Math.min(fromStep, entry);
    toStep = Math.max(toStep, entry + (m.headway?.value ?? 0));
  }

  const st = axis.singleTrack;
  const singleTrack = !!st && fromCol <= st.toCol && toCol >= st.fromCol;
  return {
    key: `${g.kind}:${[...g.handles].sort((a, b) => a - b).join('-')}`,
    handles: g.handles,
    kind: g.kind,
    fromCol,
    toCol,
    fromStep,
    toStep: Math.max(toStep, fromStep + 1),
    section: sectionName(axis, fromCol, toCol),
    singleTrack,
  };
}

// ── delay localisation (spec §4, priority 3) ────────────────────────

/** Where a train's delay against the timetable changes along the corridor. */
export interface DelayMark {
  handle: number;
  col: number;
  /** Step the train reaches this place (actual, or forecast when `forecast`). */
  step: number;
  /** Delay here, in steps: observed/forecast step − scheduled step, late part
   *  only (running early counts as 0). */
  delay: number;
  /** Change against the previous place, in steps. */
  delta: number;
  /** `origin`: the delay first appears here · `growth`: it grows · `recovery`:
   *  it shrinks (time made up). */
  kind: 'origin' | 'growth' | 'recovery';
  /** Read off the forecast rather than what actually happened. */
  forecast: boolean;
  /** Accruing right now: the train is overdue at the next place and has not
   *  reached it — drawn at its current position, at the now-line. */
  live: boolean;
}

function firstAt(points: LinePoint[], col: number): LinePoint | undefined {
  return points.find((p) => p.col === col);
}

/**
 * Delay per named place = the step the train reaches it minus the step the
 * timetable has it there — what actually happened where it has passed, the
 * forecast beyond. Only the places where that number *changes* are returned,
 * which is exactly where a delay arises, grows or is made up. No attribution
 * model: the timetable is the yardstick, the corridor's places the grid.
 */
export function delayMarks(
  handle: number,
  axis: CorridorAxis,
  plan: LinePoint[],
  actual: LinePoint[],
  forecast: LinePoint[],
  now: number,
): DelayMark[] {
  const visits: { col: number; planned: number; step: number; forecast: boolean }[] = [];
  for (const t of axis.ticks) {
    const planned = firstAt(plan, t.col);
    if (!planned) continue;
    const seen = firstAt(actual, t.col);
    const predicted = seen ? undefined : firstAt(forecast, t.col);
    const at = seen ?? predicted;
    if (!at) continue;
    visits.push({ col: t.col, planned: planned.step, step: at.step, forecast: !seen });
  }
  visits.sort((a, b) => a.planned - b.planned);

  const out: DelayMark[] = [];
  let prev = 0;
  for (const v of visits) {
    const delay = v.step - v.planned;
    // Early running is not a delay: only the late part counts, so a train that
    // was ahead and falls back to schedule raises no mark.
    const late = Math.max(0, delay);
    const delta = late - prev;
    if (delta !== 0) {
      const kind = delta < 0 ? 'recovery' : prev === 0 ? 'origin' : 'growth';
      out.push({ handle, col: v.col, step: v.step, delay: late, delta, kind, forecast: v.forecast, live: false });
    }
    prev = late;
  }

  // A train held short of its next place (waiting behind a breakdown, say)
  // accrues delay *before* it reaches anywhere named — exactly when it matters.
  // When the next place is overdue and no forecast reaches it, the delay so far
  // is marked where the train stands now.
  const here = actual[actual.length - 1];
  const visited = new Set(visits.map((v) => v.col));
  const next = axis.ticks
    .map((t) => ({ col: t.col, planned: firstAt(plan, t.col) }))
    .filter((t): t is { col: number; planned: LinePoint } => !!t.planned && !visited.has(t.col))
    .sort((a, b) => a.planned.step - b.planned.step)[0];
  if (here && next && now > next.planned.step) {
    const late = now - next.planned.step;
    const delta = late - prev;
    if (delta > 0) {
      out.push({
        handle, col: here.col, step: now, delay: late, delta,
        kind: prev === 0 ? 'origin' : 'growth', forecast: false, live: true,
      });
    }
  }
  return out;
}
