import { ContentionGroup } from './events/event-types';

/**
 * Map geometry for the forecast contention the Director's options answer.
 *
 * The A/B/C overlay says what a focus *changes* — a branch mark per rerouted
 * train, a wait mark per hold. Nothing on the map said what it changes things
 * *for*. `/hmi/contentions` has carried the answer all along and no map layer
 * read it: the contended cell set (`window`), the place it bites (`location` —
 * a station name where the window overlaps a named station, else the cell) and
 * the contending trains.
 *
 * The window is drawn cell by cell, not as one band across its column range,
 * because its width is not a constant. Measured on the shipped presets: 23–24
 * columns with three trains (12 % of the 191-column corridor, `location`
 * resolving to "WAL 2"), but 82–131 columns with sixteen (43–68 %). A band would
 * claim a bottleneck where the second case has a broad path overlap. Per cell, a
 * local contention reads as a compact patch and a broad one as a long faint
 * stretch, which is what each of them is.
 *
 * Geometry only — no colour, no copy, no layer gate. The caller owns those.
 */

/** One contended cell, as the top-left corner of its grid cell. */
export interface ContentionWindowCell {
  id: string;
  x: number;
  y: number;
}

/** Where a contention bites, at the centre of `location.cell`. */
export interface ContentionBite {
  id: string;
  /** Group index in the response, which is urgency order (most urgent first). */
  index: number;
  x: number;
  y: number;
  /** How many trains contend. `handles.length`, never a guess. */
  trains: number;
  /** Steps from now until the contention is forecast to engage; 0 once due. */
  inSteps: number;
  /** Station name where the backend resolved one, else null — never invented. */
  name: string | null;
  /** The name is of a place close by, not one the conflict overlaps ("near Olten"). */
  near: boolean;
  /** The cell, for the label to fall back on when there is no name. */
  row: number;
  col: number;
}

/** A bite projected onto the element, in percent of the SVG viewport. */
export interface ContentionLabel extends ContentionBite {
  left: number;
  top: number;
}

/** The viewBox as numbers, in the order the attribute carries them. */
export interface ViewBoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The contended cells of every group, deduplicated across groups.
 *
 * Restricted to cells that carry rail: a window is a forecast cell set, and on a
 * 191 × 9 corridor most of the grid is empty, so tinting a cell with no track
 * would put the contention where no train can be. Deduplicated because two
 * groups may contend for the same cell and a doubled tint would read as a
 * stronger claim rather than as two groups.
 */
export function contentionWindowCells(
  groups: readonly ContentionGroup[],
  railCellKeys: ReadonlySet<string>,
  cellSize: number,
): ContentionWindowCell[] {
  const seen = new Set<string>();
  const out: ContentionWindowCell[] = [];
  for (const group of groups) {
    for (const cell of group.window ?? []) {
      const row = Number(cell[0]);
      const col = Number(cell[1]);
      if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
      const key = `${row}_${col}`;
      if (seen.has(key) || !railCellKeys.has(key)) continue;
      seen.add(key);
      out.push({ id: `contention_cell_${key}`, x: col * cellSize, y: row * cellSize });
    }
  }
  return out;
}

/**
 * One bite per group, at `location.cell`.
 *
 * Groups whose `location.kind` is `'none'` are skipped rather than falling back
 * to `position`: the backend already chose `location` as the answer to "where
 * does this bite" and states when it cannot answer. Substituting the
 * representative cell here would put a named mark on a cell the backend
 * declined to name.
 */
export function contentionBites(
  groups: readonly ContentionGroup[],
  elapsedSteps: number,
  cellSize: number,
): ContentionBite[] {
  const out: ContentionBite[] = [];
  groups.forEach((group, index) => {
    const cell = group.location?.cell;
    if (!cell) return;
    const row = Number(cell[0]);
    const col = Number(cell[1]);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return;
    out.push({
      id: `contention_bite_${index}`,
      index,
      x: col * cellSize + cellSize / 2,
      y: row * cellSize + cellSize / 2,
      trains: group.handles?.length ?? 0,
      inSteps: Math.max(0, Math.round(group.step) - Math.round(elapsedSteps)),
      name: group.location?.name ?? null,
      near: group.location?.kind === 'near',
      row,
      col,
    });
  });
  return out;
}

/**
 * Project bites onto the element, in percent, for HTML labels over the SVG.
 *
 * HTML rather than SVG text for the same reason the cell tooltip is HTML: the
 * corridor is shown at roughly four screen pixels per cell, where map-unit text
 * is a couple of pixels tall. Bites outside the current view are dropped — a
 * label clamped to the edge would point at a place that is not there.
 */
export function contentionLabels(
  bites: readonly ContentionBite[],
  viewBox: ViewBoxRect,
): ContentionLabel[] {
  if (!(viewBox.w > 0 && viewBox.h > 0)) return [];
  const out: ContentionLabel[] = [];
  for (const bite of bites) {
    const left = ((bite.x - viewBox.x) / viewBox.w) * 100;
    const top = ((bite.y - viewBox.y) / viewBox.h) * 100;
    if (left < 0 || left > 100 || top < 0 || top > 100) continue;
    out.push({ ...bite, left, top });
  }
  return out;
}

/** The `viewBox` attribute back into numbers, or null when it is not four. */
export function parseViewBox(attr: string): ViewBoxRect | null {
  const parts = attr.split(' ').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, w, h] = parts;
  return { x, y, w, h };
}
