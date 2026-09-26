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

/**
 * Where a contention bites, at the centre of `location.cell`.
 *
 * Kept for the Zug-Weg chip and anything else that wants the named place as a
 * single point; the map draws `ContentionBracket` instead, because a ring around a
 * place read as a target.
 */
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

/**
 * The contended stretch as a bracket over the track.
 *
 * Replaces the ring the bite used to draw. A ring encircles an *object*, which is
 * what the disruption ring does around a train and why it is right there; around a
 * place the same shape reads as a target to aim at, and collides with the meaning
 * the ring already has on this map. A bracket annotates instead of encircling, and
 * it says "this stretch" rather than "this point".
 *
 * Its span is min/max column of the window — the same two numbers the conflict bar
 * in the option strip is built from, so the map and the strip show one measurement
 * in two places rather than two measurements that can disagree.
 */
export interface ContentionBracket {
  id: string;
  index: number;
  /** Left edge and width in map units, spanning the contended columns. */
  x: number;
  width: number;
  /** Baseline of the bracket: just above the topmost contended row. */
  y: number;
  /** How far the end ticks drop towards the track, in map units. */
  tick: number;
  trains: number;
  inSteps: number;
  name: string | null;
  near: boolean;
  /** Fallback when there is no name, from the group's own location cell. */
  row: number | null;
  col: number | null;
}

/** A bracket projected onto the element, in percent of the SVG viewport. */
export interface ContentionLabel extends ContentionBracket {
  /** Centre of the bracket, in percent. */
  left: number;
  /** The bracket's own line, in percent. */
  top: number;
  /**
   * Which side of the bracket the label sits on.
   *
   * Above by default. Below when there is no room above — a label pushed past the
   * panel edge loses its first line, which is what the old anchor did whenever the
   * conflict sat near the top of the view.
   */
  placement: 'above' | 'below';
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
 * One bracket per group, spanning the contended columns.
 *
 * Restricted to window cells on rail for the same reason the tint is: a window is a
 * forecast cell set, and on a corridor most of the grid is empty, so a bracket over
 * cells with no track would span places no train can reach.
 */
export function contentionBrackets(
  groups: readonly ContentionGroup[],
  railCellKeys: ReadonlySet<string>,
  elapsedSteps: number,
  cellSize: number,
): ContentionBracket[] {
  const out: ContentionBracket[] = [];
  groups.forEach((group, index) => {
    let minCol = Infinity;
    let maxCol = -Infinity;
    let minRow = Infinity;
    for (const cell of group.window ?? []) {
      const row = Number(cell[0]);
      const col = Number(cell[1]);
      if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
      if (!railCellKeys.has(`${row}_${col}`)) continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
    }
    if (!Number.isFinite(minCol)) return;
    const cell = group.location?.cell ?? null;
    out.push({
      id: `contention_bracket_${index}`,
      index,
      x: minCol * cellSize,
      width: (maxCol - minCol + 1) * cellSize,
      // Clear of the topmost contended row, so the bracket frames the track
      // instead of lying on it.
      y: minRow * cellSize - cellSize * 0.75,
      tick: cellSize * 0.5,
      trains: group.handles?.length ?? 0,
      inSteps: Math.max(0, Math.round(group.step) - Math.round(elapsedSteps)),
      name: group.location?.name ?? null,
      near: group.location?.kind === 'near',
      row: cell ? Number(cell[0]) : null,
      col: cell ? Number(cell[1]) : null,
    });
  });
  return out;
}

/**
 * Project brackets onto the element, in percent, for HTML labels over the SVG.
 *
 * HTML rather than SVG text for the same reason the cell tooltip is HTML: the
 * corridor is shown at roughly four screen pixels per cell, where map-unit text
 * is a couple of pixels tall. A bracket whose centre is outside the view is
 * dropped — a label clamped to the edge would point at a place that is not there.
 */
export function contentionLabels(
  brackets: readonly ContentionBracket[],
  viewBox: ViewBoxRect,
  /** Percent of the height a label needs above the bracket before it flips. */
  headroomPct = 12,
): ContentionLabel[] {
  if (!(viewBox.w > 0 && viewBox.h > 0)) return [];
  const out: ContentionLabel[] = [];
  for (const bracket of brackets) {
    const left = ((bracket.x + bracket.width / 2 - viewBox.x) / viewBox.w) * 100;
    const top = ((bracket.y - viewBox.y) / viewBox.h) * 100;
    if (left < 0 || left > 100 || top < 0 || top > 100) continue;
    out.push({ ...bracket, left, top, placement: top < headroomPct ? 'below' : 'above' });
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
