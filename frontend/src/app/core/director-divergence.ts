import { DirectorDivergence } from './api.service';
import { SceneGeography } from './models';

/**
 * "Was ändert sich" — one Director option's divergence from the running plan,
 * as rows an operator can read (docs/plans/widget-b6-director-divergence.md).
 *
 * Pure: the widget passes the payload, the step and the geography. Nothing here
 * estimates what a change costs — the planner reports utilities per plan, not
 * per train, so a row says *what* changes and *when*, never a guessed delay.
 */
export interface DivergenceRow {
  handle: number;
  kind: 'hold' | 'reroute';
  /** Where: the waiting cell, or the cell the route starts to differ at. */
  row: number;
  col: number;
  /** hold: how many steps the train waits. */
  waitSteps: number | null;
  /** reroute: steps from now until the train branches off; 0 once it has. */
  inSteps: number | null;
}

/**
 * Waiting trains first, longest wait first — a hold is felt by passengers at
 * once; then rerouted trains, soonest branch first — the last chance to see a
 * route change is before its branch point.
 */
export function divergenceRows(div: DirectorDivergence | null | undefined, now: number): DivergenceRow[] {
  if (!div) return [];
  const holds: DivergenceRow[] = (div.holds ?? []).map((h) => ({
    handle: Number(h.handle),
    kind: 'hold',
    row: h.row,
    col: h.col,
    waitSteps: Math.max(0, Math.round(h.steps)),
    inSteps: null,
  }));
  const reroutes: DivergenceRow[] = Object.entries(div.reroutes ?? {}).map(([key, entry]) => ({
    handle: Number(key),
    kind: 'reroute',
    row: entry.branch.row,
    col: entry.branch.col,
    waitSteps: null,
    inSteps: Math.max(0, Math.round(entry.branch.step - now)),
  }));
  holds.sort((a, b) => (b.waitSteps! - a.waitSteps!) || a.handle - b.handle);
  reroutes.sort((a, b) => (a.inSteps! - b.inSteps!) || a.handle - b.handle);
  return [...holds, ...reroutes];
}

/** How far a named station may lie from a cell and still name it. */
export const NEAR_PLACE_CELLS = 8;

/**
 * The name of the station at or nearest to a cell, within
 * `NEAR_PLACE_CELLS` (Manhattan), else null — the row then shows no place
 * rather than a far-off one. The same rule the backend uses to name a
 * conflict ("near Olten").
 */
export function placeNear(geo: SceneGeography | null | undefined, row: number, col: number): string | null {
  let best: { d: number; name: string } | null = null;
  for (const st of geo?.stations ?? []) {
    const d = Math.abs(st.cell[0] - row) + Math.abs(st.cell[1] - col);
    if (d > NEAR_PLACE_CELLS) continue;
    if (!best || d < best.d || (d === best.d && st.name < best.name)) best = { d, name: st.name };
  }
  return best?.name ?? null;
}
