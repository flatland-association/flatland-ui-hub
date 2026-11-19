import { exits, extendRoute, RouteNode, viaCells } from './route-drawing';

/** Rows 0-2 of the Plan B tutorial: a passing loop on row 1 between the switches (2,10) and (2,14). */
const ROW1 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16386, 1025, 1025, 1025, 4608, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const ROW2 = [0, 4, 1025, 1025, 1025, 1025, 1025, 1025, 1025, 1025, 3089, 1025, 1025, 1025, 1097, 1025, 1025, 1025, 1025, 1025, 1025, 1025, 1025, 256, 0];
const GRID = [new Array(25).fill(0), ROW1, ROW2];
const BA: RouteNode = [2, 21, 3]; // waits at B, heading west

describe('route drawing', () => {
  it('knows the switch at the east end of the loop', () => {
    expect(exits(GRID, 2, 14, 3).sort()).toEqual([0, 3]);
    expect(exits(GRID, 2, 15, 3)).toEqual([3]);
  });

  it('follows the track and fills skipped cells', () => {
    const nodes = extendRoute(GRID, [BA], 2, 17);
    expect(nodes.map(([r, c]) => [r, c])).toEqual([[2, 21], [2, 20], [2, 19], [2, 18], [2, 17]]);
  });

  it('ignores a cell the train cannot reach and shortens when dragged back', () => {
    const nodes = extendRoute(GRID, [BA], 2, 19);
    expect(extendRoute(GRID, nodes, 4, 4)).toBe(nodes);
    expect(extendRoute(GRID, nodes, 2, 20).length).toBe(2);
  });

  it('sends the branch taken at the switch and the last cell as via cells', () => {
    let nodes: RouteNode[] = [BA];
    for (const [r, c] of [[2, 17], [2, 14], [1, 14], [1, 12], [1, 10], [2, 10], [2, 8]]) {
      nodes = extendRoute(GRID, nodes, r, c);
    }
    expect(nodes.some(([r, c]) => r === 1 && c === 12)).toBeTrue();
    expect(viaCells(GRID, nodes)).toEqual([[1, 14], [2, 8]]);
  });
});
