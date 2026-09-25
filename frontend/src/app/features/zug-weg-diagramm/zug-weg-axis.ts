import type { RouteAxisResponse, SceneGeography } from '../../core/models';
import type { ContentionGroup } from '../../core/events/event-types';

/**
 * The axis of the Zug-Weg-Diagramm, and the geometry the widget draws on it.
 * Kept free of Angular so it reads (and tests) as plain data.
 *
 * Two axes, one model (`AxisModel`) — everything else only asks "where on the
 * axis is this cell, and which named place does it belong to":
 *
 * - **Column axis** (v1, spec §8.1): a corridor scene (Walensee), whose rows are
 *   parallel tracks, so a cell's position along the line is its column — the
 *   reading `SessionStore.sectionForCell` uses too.
 * - **Route axis** (docs/plans/zug-weg-route-selection.md): a section between
 *   two chosen stations, from `GET /hmi/route-axis`. Works in a network (Olten);
 *   cells off the route have no position and break a train's line.
 */

export interface AxisTick {
  code: string;
  name: string;
  /** Position along the axis (column, or cells from the route's start). */
  pos: number;
  /** A station with tracks (major tick) or a place without, e.g. Mühlehorn,
   *  or a line portal (minor). */
  major: boolean;
}

export interface AxisModel {
  kind: 'column' | 'route';
  /** Sorted by `pos`. */
  ticks: AxisTick[];
  /** The single-track section as a position range, when the scene names one. */
  singleTrack: { fromPos: number; toPos: number; from: string; to: string } | null;
  /** Position of a cell on the axis; null when it is not on it. */
  pos(row: number, col: number): number | null;
  /** Code of the named place a cell belongs to, if any. */
  placeAt(row: number, col: number): string | null;
}

function singleTrackOf(geo: SceneGeography, ticks: AxisTick[]): AxisModel['singleTrack'] {
  if (geo.single_track.length !== 2) return null;
  const [a, b] = geo.single_track.map((c) => ticks.find((t) => t.code === c));
  if (!a || !b) return null;
  const [lo, hi] = a.pos <= b.pos ? [a, b] : [b, a];
  return { fromPos: lo.pos, toPos: hi.pos, from: lo.name, to: hi.name };
}

/**
 * Column axis of a corridor scene. Stations with tracks come from `stations`
 * (collapsed per code, at their platform column `x`); places without tracks
 * from `locations`, only for codes the stations don't cover — their columns
 * sit a few cells west of the platforms, so mixing sources would misplace them.
 */
export function columnAxis(geo: SceneGeography | null): AxisModel | null {
  // Only a corridor has "position = column". A named network (Olten) needs a
  // chosen route instead.
  if (!geo || geo.stations.length === 0 || geo.layout !== 'corridor') return null;

  const byCode = new Map<string, AxisTick>();
  for (const s of geo.stations) {
    const code = s.code ?? s.name;
    const col = Number(s.cell[1]);
    const prev = byCode.get(code);
    if (!prev) byCode.set(code, { code, name: s.name, pos: col, major: true });
    else prev.pos = Math.min(prev.pos, col);
  }
  for (const l of geo.locations) {
    if (byCode.has(l.code)) continue;
    byCode.set(l.code, { code: l.code, name: l.name, pos: l.col, major: false });
  }
  const ticks = [...byCode.values()].sort((a, b) => a.pos - b.pos);
  const codeByCol = new Map(ticks.map((t) => [t.pos, t.code]));
  return {
    kind: 'column',
    ticks,
    singleTrack: singleTrackOf(geo, ticks),
    pos: (_row, col) => col,
    placeAt: (_row, col) => codeByCol.get(col) ?? null,
  };
}

/** Route axis from `GET /hmi/route-axis`; null when the route is unreachable. */
export function routeAxis(resp: RouteAxisResponse, geo: SceneGeography | null): AxisModel | null {
  if (resp.length == null || resp.cells.length === 0) return null;
  const key = (r: number, c: number) => `${r},${c}`;
  const posByCell = new Map(resp.cells.map(([r, c, p]) => [key(r, c), p]));
  const codeByCell = new Map(resp.stations.map((s) => [key(s.cell[0], s.cell[1]), s.code ?? s.name]));
  const codeByCol = new Map(resp.ticks.filter((t) => t.col != null).map((t) => [t.col!, t.code]));
  const ticks: AxisTick[] = resp.ticks.map((t) => ({
    code: t.code,
    name: t.name,
    pos: t.pos,
    major: t.kind !== 'place' && t.kind !== 'portal',
  }));
  return {
    kind: 'route',
    ticks,
    singleTrack: geo ? singleTrackOf(geo, ticks) : null,
    pos: (r, c) => posByCell.get(key(r, c)) ?? null,
    placeAt: (r, c) => {
      if (!posByCell.has(key(r, c))) return null;
      return codeByCell.get(key(r, c)) ?? codeByCol.get(c) ?? null;
    },
  };
}

/** Named stretch covering [lo, hi]: the nearest tick at or before the start and
 *  at or after the end. One name when both resolve to the same place. */
export function sectionName(axis: AxisModel, from: number, to: number): string | null {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  let before: AxisTick | null = null;
  let after: AxisTick | null = null;
  for (const t of axis.ticks) {
    if (t.pos <= lo) before = t;
    if (t.pos >= hi && !after) after = t;
  }
  if (!before && !after) return null;
  if (!before || !after) return (before ?? after)!.name;
  return before.code === after.code ? before.name : `${before.name} – ${after.name}`;
}

/** A grid cell at a step — what the simulation and the plan deliver. */
export interface CellPoint {
  step: number;
  row: number;
  col: number;
}

/** A cell point read on the axis. `pos` null = off the axis (breaks a line). */
export interface LinePoint {
  step: number;
  pos: number | null;
  /** Code of the named place the cell belongs to, if any. */
  place: string | null;
}

export function onAxis(axis: AxisModel, points: CellPoint[]): LinePoint[] {
  return points.map((p) => ({ step: p.step, pos: axis.pos(p.row, p.col), place: axis.placeAt(p.row, p.col) }));
}

/** A contention placed on the axis: a band in position × time. */
export interface ContentionBand {
  key: string;
  handles: number[];
  kind: ContentionGroup['kind'];
  /** Null when no contended cell lies on the axis (the chip says so). */
  fromPos: number | null;
  toPos: number | null;
  fromStep: number;
  toStep: number;
  section: string | null;
}

/**
 * Position × time extent of a forecast contention. Positions span the contended
 * window cells that lie on the axis (the path-overlap the backend computed);
 * time spans the first entry of any contender to the last presence of any, from
 * `perHandle`. Where the backend could not derive those (swap/deadlock carry no
 * window, a handle may never enter it) the band falls back to the group's step
 * and representative cell — narrower, never invented. A contention wholly off
 * the axis keeps its backend location name.
 */
export function contentionBand(g: ContentionGroup, axis: AxisModel): ContentionBand {
  const cells = (g.window ?? []).length > 0 ? g.window! : g.position ? [g.position] : [];
  const positions = cells
    .map((c) => axis.pos(Number(c[0]), Number(c[1])))
    .filter((p): p is number => p != null);
  const fromPos = positions.length ? Math.min(...positions) : null;
  const toPos = positions.length ? Math.max(...positions) : null;

  let fromStep = g.step;
  let toStep = g.step;
  for (const m of g.perHandle ?? []) {
    const entry = m.baselineOrder?.value;
    if (entry == null) continue;
    fromStep = Math.min(fromStep, entry);
    toStep = Math.max(toStep, entry + (m.headway?.value ?? 0));
  }

  return {
    key: `${g.kind}:${[...g.handles].sort((a, b) => a - b).join('-')}`,
    handles: g.handles,
    kind: g.kind,
    fromPos,
    toPos,
    fromStep,
    toStep: Math.max(toStep, fromStep + 1),
    section: fromPos != null && toPos != null ? sectionName(axis, fromPos, toPos) : (g.location?.name ?? null),
  };
}

// ── delay localisation (spec §4, priority 3) ────────────────────────

/** Where a train's delay against the timetable changes along the axis. */
export interface DelayMark {
  handle: number;
  /** Named place, or null for a live mark between places. */
  place: string | null;
  /** Position where the mark is drawn: the train's own point there. */
  pos: number;
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

function firstAt(points: LinePoint[], code: string): LinePoint | undefined {
  return points.find((p) => p.place === code && p.pos != null);
}

/**
 * Delay per named place = the step the train reaches it minus the step the
 * timetable has it there — what actually happened where it has passed, the
 * forecast beyond. Only the places where that number *changes* are returned,
 * which is exactly where a delay arises, grows or is made up. No attribution
 * model: the timetable is the yardstick, the axis's places the grid.
 */
export function delayMarks(
  handle: number,
  axis: AxisModel,
  plan: LinePoint[],
  actual: LinePoint[],
  forecast: LinePoint[],
  now: number,
): DelayMark[] {
  const visits: { place: string; pos: number; planned: number; step: number; forecast: boolean }[] = [];
  for (const t of axis.ticks) {
    const planned = firstAt(plan, t.code);
    if (!planned) continue;
    const seen = firstAt(actual, t.code);
    const at = seen ?? firstAt(forecast, t.code);
    if (!at) continue;
    visits.push({ place: t.code, pos: at.pos!, planned: planned.step, step: at.step, forecast: !seen });
  }
  visits.sort((a, b) => a.planned - b.planned);

  const out: DelayMark[] = [];
  let prev = 0;
  for (const v of visits) {
    // Early running is not a delay: only the late part counts, so a train that
    // was ahead and falls back to schedule raises no mark.
    const late = Math.max(0, v.step - v.planned);
    const delta = late - prev;
    if (delta !== 0) {
      const kind = delta < 0 ? 'recovery' : prev === 0 ? 'origin' : 'growth';
      out.push({ handle, place: v.place, pos: v.pos, step: v.step, delay: late, delta, kind, forecast: v.forecast, live: false });
    }
    prev = late;
  }

  // A train held short of its next place (waiting behind a breakdown, say)
  // accrues delay *before* it reaches anywhere named — exactly when it matters.
  // When the next place is overdue and no forecast reaches it, the delay so far
  // is marked where the train stands now.
  const here = actual[actual.length - 1];
  const visited = new Set(visits.map((v) => v.place));
  const next = axis.ticks
    .map((t) => ({ code: t.code, planned: firstAt(plan, t.code) }))
    .filter((t): t is { code: string; planned: LinePoint } => !!t.planned && !visited.has(t.code))
    .sort((a, b) => a.planned.step - b.planned.step)[0];
  if (here && here.pos != null && next && now > next.planned.step) {
    const late = now - next.planned.step;
    const delta = late - prev;
    if (delta > 0) {
      out.push({
        handle, place: null, pos: here.pos, step: now, delay: late, delta,
        kind: prev === 0 ? 'origin' : 'growth', forecast: false, live: true,
      });
    }
  }
  return out;
}
