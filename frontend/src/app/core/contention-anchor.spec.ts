import {
  contentionBites,
  contentionBrackets,
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

describe('contentionBrackets', () => {
  it('spans the contended columns, which is what the option strip measures too', () => {
    const [bracket] = contentionBrackets([group()], rails([2, 123], [2, 124]), 0, CELL);
    expect(bracket.x).toBe(123 * CELL);
    expect(bracket.width).toBe(2 * CELL);
  });

  it('sits clear above the topmost contended row instead of on the track', () => {
    const [bracket] = contentionBrackets([group()], rails([2, 123], [2, 124]), 0, CELL);
    expect(bracket.y).toBeLessThan(2 * CELL);
    expect(bracket.tick).toBeGreaterThan(0);
  });

  it('ignores window cells with no rail, so it never spans unreachable ground', () => {
    const wide = group({ window: [[2, 40], [2, 124]] });
    const [bracket] = contentionBrackets([wide], rails([2, 124]), 0, CELL);
    expect(bracket.x).toBe(124 * CELL);
    expect(bracket.width).toBe(CELL);
  });

  it('carries the place name and says when it is only a nearby one', () => {
    const [named] = contentionBrackets([group()], rails([2, 124]), 0, CELL);
    expect(named.name).toBe('WAL 2');
    expect(named.near).toBeFalse();

    const [nearby] = contentionBrackets(
      [group({ location: { kind: 'near', name: 'Olten', cell: [2, 124] } })],
      rails([2, 124]), 0, CELL,
    );
    expect(nearby.near).toBeTrue();
  });

  it('counts down to the forecast step and stops at zero', () => {
    const rail = rails([2, 123], [2, 124]);
    expect(contentionBrackets([group({ step: 18 })], rail, 4, CELL)[0].inSteps).toBe(14);
    expect(contentionBrackets([group({ step: 18 })], rail, 25, CELL)[0].inSteps).toBe(0);
  });

  it('is empty when no contended cell carries rail', () => {
    expect(contentionBrackets([group()], rails([8, 3]), 0, CELL)).toEqual([]);
    expect(contentionBrackets([group({ window: [] })], rails([2, 124]), 0, CELL)).toEqual([]);
  });

  it('still produces a bracket when the backend could not name the place', () => {
    // The bracket comes from the window, the name from `location` — a group the
    // backend declined to locate still has a contended stretch to frame.
    const [bracket] = contentionBrackets(
      [group({ location: { kind: 'none', name: null, cell: null } })],
      rails([2, 123], [2, 124]), 0, CELL,
    );
    expect(bracket.name).toBeNull();
    expect(bracket.row).toBeNull();
    expect(bracket.width).toBe(2 * CELL);
  });
});

describe('contentionLabels', () => {
  const bracket = () => contentionBrackets([group()], rails([2, 123], [2, 124]), 0, CELL);

  it('anchors on the bracket centre, not on one of its ends', () => {
    // Bracket spans columns 123..124, centre at 124 * 32 = 3968 map units.
    const labels = contentionLabels(bracket(), { x: 3936, y: 0, w: 128, h: 320 });
    expect(labels.length).toBe(1);
    expect(labels[0].left).toBeCloseTo(25, 5);
  });

  it('puts the label below the bracket when there is no room above', () => {
    // The old anchor pushed the label past the panel edge and cut its first line
    // whenever the conflict sat near the top of the view.
    const high = contentionLabels(bracket(), { x: 3936, y: 40, w: 128, h: 320 });
    expect(high[0].placement).toBe('below');
    const low = contentionLabels(bracket(), { x: 3936, y: -200, w: 128, h: 320 });
    expect(low[0].placement).toBe('above');
  });

  it('drops a bracket outside the current view instead of clamping it to the edge', () => {
    expect(contentionLabels(bracket(), { x: 0, y: 0, w: 320, h: 320 })).toEqual([]);
  });

  it('drops everything on a degenerate viewBox', () => {
    expect(contentionLabels(bracket(), { x: 0, y: 0, w: 0, h: 0 })).toEqual([]);
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
