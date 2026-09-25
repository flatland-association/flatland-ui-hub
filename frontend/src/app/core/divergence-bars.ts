import { DirectorStrategy } from './api.service';
import { ContentionGroup } from './events/event-types';
import { ViewBoxRect } from './contention-anchor';

/**
 * The option bars: one lane per strategy focus above the map, showing where along
 * the line that option departs from the plan that is driving.
 *
 * Why a bar and not a mark. On the PF-CH corridor a cell is about four screen
 * pixels wide, so the existing branch mark (radius 10.9 user units) arrives at
 * roughly 1.4 px — smaller than its own outline. Extent along the line is the one
 * dimension with pixels to spare: the deviating stretches measure 40-45 of 191
 * columns, which is 180-200 px at the same scale.
 *
 * Why above the map and not on it. The 191 x 9 network in a wide panel makes
 * `viewBox()` stretch the height, leaving the track band in the middle with empty
 * rows above and below. The bars go in that room, on the map's own x axis, so a
 * column in a lane sits over the same place on the track.
 *
 * Why this only works on a line. The lanes are indexed by column, which is a
 * position along the route only when the network is a corridor. Measured on the
 * generated 36 x 24 demo network, the three options occupy columns 0..17 of 36 at
 * every sampled step — three bars of identical extent, discriminating nothing.
 * That is why the Director tour was moved to the corridor rather than this being
 * drawn everywhere.
 *
 * Geometry only: no colour, no copy, no layer gate.
 */

/** One option's lane. */
export interface DivergenceLane {
  id: string;
  /** 'A' | 'B' | 'C' as the backend assigns it. */
  ident: string;
  focus: string;
  /** Left edge in map units, or null when this option changes nothing. */
  x: number | null;
  /** Width in map units; 0 when there is nothing to draw. */
  width: number;
  /** The earliest column at which any train departs from the running plan — the
   *  last place the choice is still open, so the bar is emphasised there. */
  branchX: number | null;
  /** How many trains take another route, and how many wait. Both from the
   *  divergence, the same source as the map marks. */
  reroutes: number;
  holds: number;
  /** True when this option has a plan but deviates nowhere. Distinct from "no
   *  plan yet": an empty lane and an unplanned lane are different states. */
  unchanged: boolean;
  /** True while the option has no plan at all (still computing, or degraded). */
  unplanned: boolean;
  /** Committed = this is the plan actually driving. */
  isActive: boolean;
}

/** The conflict the options answer, as an extent on the same axis. */
export interface ContentionLane {
  x: number;
  width: number;
  /** Station name where the backend resolved one, else null. */
  name: string | null;
  trains: number;
}

function columnExtent(strategy: DirectorStrategy): { min: number; max: number } | null {
  const reroutes = strategy.divergence?.reroutes ?? {};
  let min = Infinity;
  let max = -Infinity;
  for (const entry of Object.values(reroutes)) {
    for (const point of entry.points ?? []) {
      const col = Number(point.col);
      if (!Number.isFinite(col)) continue;
      if (col < min) min = col;
      if (col > max) max = col;
    }
  }
  for (const hold of strategy.divergence?.holds ?? []) {
    const col = Number(hold.col);
    if (!Number.isFinite(col)) continue;
    if (col < min) min = col;
    if (col > max) max = col;
  }
  return Number.isFinite(min) ? { min, max } : null;
}

/** The earliest branch column, which is where the deviation begins. */
function earliestBranchColumn(strategy: DirectorStrategy): number | null {
  const reroutes = Object.values(strategy.divergence?.reroutes ?? {});
  if (reroutes.length === 0) return null;
  let best: number | null = null;
  let bestStep = Infinity;
  for (const entry of reroutes) {
    const step = Number(entry.branch?.step ?? Infinity);
    const col = Number(entry.branch?.col);
    if (!Number.isFinite(col)) continue;
    if (step < bestStep) {
      bestStep = step;
      best = col;
    }
  }
  return best;
}

/**
 * One lane per option, in the order the backend returned them (A, B, C).
 *
 * `activeStrategyId` marks the committed one so the lane can say "this is what is
 * driving" rather than "this is a possibility" — the same distinction the map
 * overlay draws with `directorPreviewIsCommitted`, and the one the badge over the
 * map exists to make.
 */
export function divergenceLanes(
  strategies: readonly DirectorStrategy[],
  cellSize: number,
  activeStrategyId: string | null,
): DivergenceLane[] {
  return strategies.map((strategy) => {
    const extent = columnExtent(strategy);
    const branch = earliestBranchColumn(strategy);
    const reroutes = Object.keys(strategy.divergence?.reroutes ?? {}).length;
    const holds = (strategy.divergence?.holds ?? []).length;
    return {
      id: strategy.id,
      ident: strategy.ident,
      focus: strategy.focus,
      x: extent ? extent.min * cellSize : null,
      width: extent ? (extent.max - extent.min + 1) * cellSize : 0,
      branchX: branch === null ? null : branch * cellSize + cellSize / 2,
      reroutes,
      holds,
      unchanged: strategy.plan !== null && extent === null,
      unplanned: strategy.plan === null,
      isActive: activeStrategyId !== null && strategy.id === activeStrategyId,
    };
  });
}

/**
 * The contention as a lane on the same axis, from the most urgent group.
 *
 * Only the first group: the lane strip is read as "here is the problem, there is
 * what each option does about it", and several problem extents stacked in one
 * strip would make that sentence ambiguous. The map still tints every group.
 */
export function contentionLane(
  groups: readonly ContentionGroup[],
  cellSize: number,
): ContentionLane | null {
  const group = groups.find((g) => (g.window ?? []).length > 0);
  if (!group) return null;
  const cols = (group.window ?? []).map((cell) => Number(cell[1])).filter(Number.isFinite);
  if (cols.length === 0) return null;
  const min = Math.min(...cols);
  const max = Math.max(...cols);
  return {
    x: min * cellSize,
    width: (max - min + 1) * cellSize,
    name: group.location?.name ?? null,
    trains: group.handles?.length ?? 0,
  };
}

/** A map-unit span projected onto the element, in percent of the viewport. */
export interface LaneBox {
  left: number;
  width: number;
}

/**
 * Project a span onto the element so a lane sits over the track it describes.
 *
 * Clamped rather than dropped, unlike the conflict label: a bar that runs off the
 * edge is still telling the truth about the part you can see, and cutting it
 * entirely would read as "this option changes nothing". Returns null only when
 * the span is wholly outside the view.
 */
export function projectLane(
  x: number,
  width: number,
  viewBox: ViewBoxRect,
): LaneBox | null {
  if (!(viewBox.w > 0)) return null;
  const left = ((x - viewBox.x) / viewBox.w) * 100;
  const right = ((x + width - viewBox.x) / viewBox.w) * 100;
  if (right <= 0 || left >= 100) return null;
  const clampedLeft = Math.max(0, left);
  const clampedRight = Math.min(100, right);
  return { left: clampedLeft, width: Math.max(0.4, clampedRight - clampedLeft) };
}

/** A single map x projected onto the element, in percent, or null when off view. */
export function projectX(x: number, viewBox: ViewBoxRect): number | null {
  if (!(viewBox.w > 0)) return null;
  const left = ((x - viewBox.x) / viewBox.w) * 100;
  return left < 0 || left > 100 ? null : left;
}
