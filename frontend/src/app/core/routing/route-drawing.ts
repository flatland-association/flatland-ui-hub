/**
 * Drawing a train's route on the Streckenspiegel ("Fahrweg einstellen").
 *
 * Pure helpers over the env's rail grid (`SessionStore.railGrid`, Flatland's
 * 16-bit transition value per cell): a drag adds cells only where the train can
 * go from the last one, and the route is sent as via cells, the first cell after
 * each switch the operator chose a branch at. The backend fills the cells
 * through them to the target (`route_through`). Plan:
 * docs/plans/set-route-on-map.md (§4.3, §4.4).
 */

/** `[row, col, heading]`, heading 0 = N, 1 = E, 2 = S, 3 = W, as in Flatland. */
export type RouteNode = [number, number, number];

/** The train being routed, the cells drawn so far, and the via cells once the drag ended. */
export interface RouteDrawing {
  handle: number;
  nodes: RouteNode[];
  via: [number, number][] | null;
}

const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];

/** Headings a train can leave `[row, col]` in when it enters it heading `heading`. */
export function exits(grid: number[][], row: number, col: number, heading: number): number[] {
  const cell = grid[row]?.[col] ?? 0;
  const nibble = (cell >> ((3 - heading) * 4)) & 0xf;
  return [0, 1, 2, 3].filter((d) => (nibble >> (3 - d)) & 1);
}

function step(node: RouteNode, d: number): RouteNode {
  return [node[0] + DR[d], node[1] + DC[d], d];
}

/**
 * The shortest way along the track from `from` to `[row, col]`, without `from`,
 * at most `maxCells` long; null when the cell cannot be reached that way. Lets
 * a fast drag skip cells.
 */
export function pathTo(grid: number[][], from: RouteNode, row: number, col: number, maxCells = 8): RouteNode[] | null {
  const key = (n: RouteNode) => n.join(',');
  let frontier: RouteNode[][] = [[from]];
  const seen = new Set([key(from)]);
  for (let depth = 0; depth < maxCells; depth++) {
    const next: RouteNode[][] = [];
    for (const path of frontier) {
      const last = path[path.length - 1];
      for (const d of exits(grid, last[0], last[1], last[2])) {
        const node = step(last, d);
        if (seen.has(key(node))) continue;
        seen.add(key(node));
        const longer = [...path, node];
        if (node[0] === row && node[1] === col) return longer.slice(1);
        next.push(longer);
      }
    }
    frontier = next;
  }
  return null;
}

/** The drawn route extended to the cell under the pointer; unchanged when it is not reachable. */
export function extendRoute(grid: number[][], nodes: RouteNode[], row: number, col: number): RouteNode[] {
  const last = nodes[nodes.length - 1];
  if (!last || (last[0] === row && last[1] === col)) return nodes;
  const back = nodes.findIndex((n) => n[0] === row && n[1] === col);
  if (back >= 0) return nodes.slice(0, back + 1); // dragged back: shorten
  const more = pathTo(grid, last, row, col);
  return more ? [...nodes, ...more] : nodes;
}

/**
 * The via cells: the first cell after each switch where the route had a choice,
 * and the last drawn cell. Enough for the backend to take the same branches.
 */
export function viaCells(grid: number[][], nodes: RouteNode[]): [number, number][] {
  const via: [number, number][] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const [r, c, h] = nodes[i];
    if (exits(grid, r, c, h).length > 1) via.push([nodes[i + 1][0], nodes[i + 1][1]]);
  }
  const last = nodes[nodes.length - 1];
  if (nodes.length > 1 && !via.some(([r, c]) => r === last[0] && c === last[1])) via.push([last[0], last[1]]);
  return via;
}
