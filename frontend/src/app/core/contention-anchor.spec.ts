import {
  contentionBites,
  contentionLabels,
  contentionWindowCells,
  parseViewBox,
} from './contention-anchor';
import { ContentionGroup } from './events/event-types';

const CELL = 32;

function group(over: Partial<ContentionGroup> = {}): ContentionGroup {
  return {
    step: 18,
    position: [2, 124],
    kind: 'blocked',
    handles: [0, 1, 2],
    window: [
      [2, 123],
      [2, 124],
    ],
    location: { kind: 'station', name: 'WAL 2', cell: [2, 124] },
    ...over,
  };
}

/** The rail set the map builds from `rail_tiles`, in the same `r_c` form. */
function rails(...cells: Array<[number, number]>): Set<string> {
  return new Set(cells.map(([r, c]) => `${r}_${c}`));
}

describe('contentionWindowCells', () => {
  it('places a cell at its grid corner', () => {
    const cells = contentionWindowCells([group()], rails([2, 123], [2, 124]), CELL);
    expect(cells.map((c) => [c.x, c.y])).toEqual([
      [123 * CELL, 2 * CELL],
      [124 * CELL, 2 * CELL],
    ]);
  });

  it('drops window cells that carry no rail', () => {
    // A window is a forecast cell set; on a 191 x 9 corridor most of the grid is
    // empty, and a tint off the track would put the contention where no train
    // can be.
    const cells = contentionWindowCells([group()], rails([2, 124]), CELL);
    expect(cells.length).toBe(1);
    expect(cells[0].x).toBe(124 * CELL);
  });

  it('tints a shared cell once, so two groups do not read as a stronger claim', () => {
    const a = group();
    const b = group({ window: [[2, 124]], location: { kind: 'cell', name: null, cell: [2, 124] } });
    const cells = contentionWindowCells([a, b], rails([2, 123], [2, 124]), CELL);
    expect(cells.length).toBe(2);
  });

  it('is empty for a group that reports no window', () => {
    expect(contentionWindowCells([group({ window: [] })], rails([2, 124]), CELL)).toEqual([]);
  });
});

describe('contentionBites', () => {
  it('marks the centre of the cell the backend named', () => {
    const [bite] = contentionBites([group()], 4, CELL);
    expect(bite.x).toBe(124 * CELL + CELL / 2);
    expect(bite.y).toBe(2 * CELL + CELL / 2);
    expect(bite.name).toBe('WAL 2');
    expect(bite.trains).toBe(3);
  });

  it('counts down to the forecast step and stops at zero', () => {
    expect(contentionBites([group({ step: 18 })], 4, CELL)[0].inSteps).toBe(14);
    expect(contentionBites([group({ step: 18 })], 18, CELL)[0].inSteps).toBe(0);
    expect(contentionBites([group({ step: 18 })], 25, CELL)[0].inSteps).toBe(0);
  });

  it('keeps the cell when there is no station name, rather than inventing one', () => {
    const [bite] = contentionBites(
      [group({ location: { kind: 'cell', name: null, cell: [7, 19] } })],
      0,
      CELL,
    );
    expect(bite.name).toBeNull();
    expect([bite.row, bite.col]).toEqual([7, 19]);
  });

  it('skips a group the backend declined to locate', () => {
    // location.kind 'none' is an explicit "not derivable"; falling back to
    // `position` would put a named mark on a cell the backend would not name.
    expect(
      contentionBites([group({ location: { kind: 'none', name: null, cell: null } })], 0, CELL),
    ).toEqual([]);
    expect(contentionBites([group({ location: undefined })], 0, CELL)).toEqual([]);
  });

  it('carries the response order through, which is urgency order', () => {
    const bites = contentionBites(
      [group({ step: 9 }), group({ step: 40, location: { kind: 'cell', name: null, cell: [3, 8] } })],
      0,
      CELL,
    );
    expect(bites.map((b) => b.index)).toEqual([0, 1]);
  });
});

describe('contentionLabels', () => {
  const bite = () => contentionBites([group()], 0, CELL);

  it('projects the bite onto the element in percent', () => {
    // A viewBox of 0 0 400 200 with the bite at (3984, 80) is off to the right;
    // use a box that contains it so the arithmetic is checkable.
    const labels = contentionLabels(bite(), { x: 3968, y: 0, w: 64, h: 320 });
    expect(labels.length).toBe(1);
    expect(labels[0].left).toBeCloseTo(25, 5);
    expect(labels[0].top).toBeCloseTo(25, 5);
  });

  it('drops a bite outside the current view instead of clamping it to the edge', () => {
    expect(contentionLabels(bite(), { x: 0, y: 0, w: 320, h: 320 })).toEqual([]);
  });

  it('drops everything on a degenerate viewBox', () => {
    expect(contentionLabels(bite(), { x: 0, y: 0, w: 0, h: 0 })).toEqual([]);
  });
});

describe('parseViewBox', () => {
  it('reads the four numbers the attribute carries', () => {
    expect(parseViewBox('10 20 30 40')).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it('returns null on anything that is not four numbers', () => {
    expect(parseViewBox('10 20 30')).toBeNull();
    expect(parseViewBox('10 20 30 nope')).toBeNull();
    expect(parseViewBox('')).toBeNull();
  });
});
