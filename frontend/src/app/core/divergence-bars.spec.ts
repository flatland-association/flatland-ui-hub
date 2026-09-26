import { DirectorStrategy } from './api.service';
import {
  contentionLane,
  divergenceLanes,
  laneNotePlacement,
  projectLane,
  projectX,
} from './divergence-bars';
import { ContentionGroup } from './events/event-types';

const CELL = 32;

function strategy(over: Partial<DirectorStrategy> = {}): DirectorStrategy {
  return {
    id: 'punctuality',
    ident: 'A',
    focus: 'punctuality',
    weights: { punctuality: 5, connections: 2, stability: 2 },
    plan: {
      source: 'research',
      weighted: 0.9,
      utilities: { punctuality: 0.96, connections: 1, stability: 0.69 },
      changed: [0, 1],
      considered: {},
    },
    paths: {},
    divergence: {
      reroutes: {
        '1': {
          branch: { row: 2, col: 83, step: 34 },
          points: [
            { step: 34, row: 2, col: 83 },
            { step: 40, row: 1, col: 100 },
            { step: 52, row: 2, col: 122 },
          ],
        },
      },
      holds: [],
    },
    ...over,
  } as unknown as DirectorStrategy;
}

describe('divergenceLanes', () => {
  it('spans the columns the deviation touches', () => {
    const [lane] = divergenceLanes([strategy()], CELL, null);
    expect(lane.x).toBe(83 * CELL);
    expect(lane.width).toBe((122 - 83 + 1) * CELL);
  });

  it('marks the earliest branch, which is where the choice closes', () => {
    const [lane] = divergenceLanes([strategy()], CELL, null);
    expect(lane.branchX).toBe(83 * CELL + CELL / 2);
  });

  it('takes the earliest branch by step, not by column', () => {
    // A train branching later but further west must not be read as the start.
    const s = strategy({
      divergence: {
        reroutes: {
          '1': { branch: { row: 2, col: 90, step: 12 }, points: [{ step: 12, row: 2, col: 90 }, { step: 20, row: 2, col: 95 }] },
          '2': { branch: { row: 2, col: 40, step: 60 }, points: [{ step: 60, row: 2, col: 40 }, { step: 70, row: 2, col: 50 }] },
        },
        holds: [],
      },
    } as unknown as Partial<DirectorStrategy>);
    const [lane] = divergenceLanes([s], CELL, null);
    expect(lane.branchX).toBe(90 * CELL + CELL / 2);
    // The extent still covers both trains.
    expect(lane.x).toBe(40 * CELL);
  });

  it('separates "changes nothing" from "has no plan"', () => {
    const empty = strategy({ divergence: { reroutes: {}, holds: [] } });
    const [unchanged] = divergenceLanes([empty], CELL, null);
    expect(unchanged.unchanged).toBeTrue();
    expect(unchanged.unplanned).toBeFalse();
    expect(unchanged.x).toBeNull();
    expect(unchanged.width).toBe(0);

    const noPlan = strategy({ plan: null, divergence: { reroutes: {}, holds: [] } });
    const [unplanned] = divergenceLanes([noPlan], CELL, null);
    expect(unplanned.unplanned).toBeTrue();
    expect(unplanned.unchanged).toBeFalse();
  });

  it('counts a hold into the extent even though it has no route', () => {
    const held = strategy({
      divergence: { reroutes: {}, holds: [{ handle: 3, row: 2, col: 57, steps: 4 }] },
    } as unknown as Partial<DirectorStrategy>);
    const [lane] = divergenceLanes([held], CELL, null);
    expect(lane.holds).toBe(1);
    expect(lane.x).toBe(57 * CELL);
    expect(lane.width).toBe(CELL);
    expect(lane.branchX).toBeNull();
    expect(lane.unchanged).toBeFalse();
  });

  it('marks the committed option, so a lane can say what is driving', () => {
    const lanes = divergenceLanes(
      [strategy({ id: 'punctuality' }), strategy({ id: 'stability', ident: 'C' })],
      CELL,
      'stability',
    );
    expect(lanes.map((l) => l.isActive)).toEqual([false, true]);
  });

  it('keeps the response order, which is A then B then C', () => {
    const lanes = divergenceLanes(
      [strategy({ ident: 'A' }), strategy({ ident: 'B' }), strategy({ ident: 'C' })],
      CELL,
      null,
    );
    expect(lanes.map((l) => l.ident)).toEqual(['A', 'B', 'C']);
  });
});

describe('contentionLane', () => {
  function group(over: Partial<ContentionGroup> = {}): ContentionGroup {
    return {
      step: 35,
      position: [2, 124],
      kind: 'blocked',
      handles: [0, 1, 2],
      window: [[2, 101], [2, 124]],
      location: { kind: 'station', name: 'WAL 2', cell: [2, 124] },
      ...over,
    };
  }

  it('spans the contended columns and carries the name', () => {
    const lane = contentionLane([group()], CELL);
    expect(lane?.x).toBe(101 * CELL);
    expect(lane?.width).toBe((124 - 101 + 1) * CELL);
    expect(lane?.name).toBe('WAL 2');
    expect(lane?.trains).toBe(3);
  });

  it('uses the most urgent group that has a window', () => {
    const lane = contentionLane([group({ window: [] }), group({ window: [[2, 50]] })], CELL);
    expect(lane?.x).toBe(50 * CELL);
  });

  it('is null when nothing ahead has a window', () => {
    expect(contentionLane([group({ window: [] })], CELL)).toBeNull();
    expect(contentionLane([], CELL)).toBeNull();
  });
});

describe('projectLane', () => {
  const view = { x: 0, y: 0, w: 1000, h: 300 };

  it('maps a span to percent of the viewport', () => {
    expect(projectLane(100, 200, view)).toEqual({ left: 10, width: 20 });
  });

  it('clamps a span that runs off the edge instead of dropping it', () => {
    // A cut bar still tells the truth about the visible part; dropping it would
    // read as "this option changes nothing".
    expect(projectLane(-200, 400, view)).toEqual({ left: 0, width: 20 });
    expect(projectLane(900, 400, view)).toEqual({ left: 90, width: 10 });
  });

  it('returns null only when the span is wholly outside the view', () => {
    expect(projectLane(-500, 100, view)).toBeNull();
    expect(projectLane(1200, 100, view)).toBeNull();
  });

  it('keeps a hairline visible for a one-cell span', () => {
    const box = projectLane(500, 1, view);
    expect(box?.width).toBeGreaterThanOrEqual(0.4);
  });

  it('returns null on a degenerate viewBox', () => {
    expect(projectLane(0, 100, { x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });
});

describe('laneNotePlacement', () => {
  it('starts at the origin when the lane has no bar, clear of the option letter', () => {
    // Placed at the origin without that clearance the note lost its first
    // characters behind the letter chip — "changes nothing" read as "hanges nothing".
    expect(laneNotePlacement(null)).toEqual({ placement: 'start', left: 0 });
  });

  it('follows the bar when there is room to its right', () => {
    expect(laneNotePlacement({ left: 10, width: 20 })).toEqual({ placement: 'after', left: 30 });
  });

  it('goes in front of the bar when the bar reaches the right edge', () => {
    // Which on a corridor is the common case: the conflict sits downstream, so the
    // deviation runs towards the end of the axis and a note pinned right would cover
    // the bar's own end.
    expect(laneNotePlacement({ left: 25, width: 70 })).toEqual({ placement: 'before', left: 25 });
  });

  it('never puts the note on the bar', () => {
    const wide = laneNotePlacement({ left: 0, width: 100 });
    expect(wide.placement).not.toBe('after');
    expect(wide.placement).toBe('before');
  });
});

describe('projectX', () => {
  it('maps a single coordinate to percent', () => {
    expect(projectX(250, { x: 0, y: 0, w: 1000, h: 300 })).toBe(25);
  });

  it('is null outside the view, because a clamped tick points at the wrong place', () => {
    expect(projectX(-10, { x: 0, y: 0, w: 1000, h: 300 })).toBeNull();
    expect(projectX(1010, { x: 0, y: 0, w: 1000, h: 300 })).toBeNull();
  });
});
