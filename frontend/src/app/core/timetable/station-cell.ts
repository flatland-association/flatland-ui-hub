/**
 * On a station track's cell or right next to it. A planned run ends one cell
 * before its target (the train leaves the grid there), so matching the exact
 * cell misses every train that ends at the station. Parallel station tracks
 * lie two rows apart, so a neighbour never belongs to another track.
 */
export function atStation(r: number, c: number, row: number, col: number): boolean {
  return Math.abs(r - row) + Math.abs(c - col) <= 1;
}
