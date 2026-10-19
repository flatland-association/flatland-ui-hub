import { DirectorDivergence } from './api.service';
import { divergenceRows, placeNear } from './director-divergence';
import { SceneGeography } from './models';

describe('director divergence rows', () => {
  const div: DirectorDivergence = {
    reroutes: {
      '4': { branch: { row: 0, col: 50, step: 30 }, points: [] },
      '2': { branch: { row: 0, col: 20, step: 14 }, points: [] },
    },
    holds: [
      { handle: 7, row: 0, col: 90, steps: 2 },
      { handle: 1, row: 0, col: 70, steps: 6 },
    ],
  };

  it('lists waits first, longest first, then reroutes, soonest branch first', () => {
    const rows = divergenceRows(div, 10);
    expect(rows.map((r) => [r.kind, r.handle])).toEqual([
      ['hold', 1], ['hold', 7], ['reroute', 2], ['reroute', 4],
    ]);
    expect(rows[2].inSteps).toBe(4);
    expect(rows[0].waitSteps).toBe(6);
  });

  it('has one row per changed train, and none without a divergence', () => {
    expect(divergenceRows(div, 0).length).toBe(4);
    expect(divergenceRows(null, 0)).toEqual([]);
    expect(divergenceRows({ reroutes: {}, holds: [] }, 0)).toEqual([]);
  });

  it('a branch already passed reads as now, not as a negative time', () => {
    expect(divergenceRows(div, 40).find((r) => r.handle === 4)!.inSteps).toBe(0);
  });
});

describe('placeNear', () => {
  const geo: SceneGeography = {
    stations: [
      { code: 'WN', name: 'Weesen', track: 1, cell: [0, 100] },
      { code: 'ZB', name: 'Ziegelbrücke', track: 1, cell: [0, 70] },
    ],
  } as SceneGeography;

  it('names the nearest station within reach, and nothing beyond it', () => {
    expect(placeNear(geo, 0, 97)).toBe('Weesen');
    expect(placeNear(geo, 1, 72)).toBe('Ziegelbrücke');
    expect(placeNear(geo, 0, 85)).toBeNull();
    expect(placeNear(null, 0, 0)).toBeNull();
  });
});
