import { AgentDTO, SceneGeography } from '../../core/models';
import { PlannedCell } from '../../core/timetable/current-delay';
import { deriveConnections } from './connection-watch.component';

function agent(handle: number, from: [number, number], to: [number, number], state = 'MOVING'): AgentDTO {
  return { handle, initial_position: from, target: to, state } as AgentDTO;
}

function run(cells: [number, number, number][]): PlannedCell[] {
  return cells.map(([step, row, col]) => ({ step, row, col }));
}

// Weesen (WN) with platforms on rows 0/2/4 at col 87, as in the Walensee scene.
const geo: SceneGeography = {
  layout: 'corridor',
  stations: [
    { code: 'WN', name: 'Weesen', track: 1, cell: [0, 87] },
    { code: 'WN', name: 'Weesen', track: 2, cell: [2, 87] },
    { code: 'WN', name: 'Weesen', track: 3, cell: [4, 87] },
    { code: 'ZB', name: 'Ziegelbrücke', track: 3, cell: [4, 71] },
  ],
  locations: [],
  single_track: [],
  connections: [{ id: 'conn_wn_w1_w2', station: 'WN', feeder: 2, connector: 3, min_transfer: 2 }],
};

// W1 arrives at WN track 2 at step 56; W2 stands at track 3 and leaves after 64.
// At step 66 W2 passes (2,86), next to W1's platform: that must not count.
const agents = [agent(2, [2, 120], [2, 87]), agent(3, [4, 87], [4, 71])];
const plan = new Map<number, PlannedCell[]>([
  [2, run([[54, 2, 90], [55, 2, 89], [56, 2, 88]])],
  [3, run([[63, 4, 87], [64, 4, 86], [65, 3, 86], [66, 2, 86], [67, 2, 85]])],
]);

describe('deriveConnections with scene-defined connections', () => {
  it('reads the gap at each train’s own platform', () => {
    const [c] = deriveConnections(agents, plan, geo, new Map());
    expect(c).toEqual(jasmine.objectContaining({ station: 'Weesen', feeder: 2, departing: 3, gap: 8, reserve: 8, status: 'ok', defined: true }));
  });

  it('breaks when the feeder is late and the connector leaves on time', () => {
    const [c] = deriveConnections(agents, plan, geo, new Map([[2, 20]]));
    expect(c.reserve).toBe(-12);
    expect(c.status).toBe('broken');
  });

  it('is tight below the defined minimum transfer', () => {
    const [c] = deriveConnections(agents, plan, geo, new Map([[2, 7]]));
    expect(c.status).toBe('tight');
  });

  it('holding the connector restores the reserve', () => {
    const [c] = deriveConnections(agents, plan, geo, new Map([[2, 20], [3, 14]]));
    expect(c.status).toBe('ok');
  });

  it('drops a connection whose connecting train is done', () => {
    const done = [agents[0], agent(3, [4, 87], [4, 71], 'DONE')];
    expect(deriveConnections(done, plan, geo, new Map())).toEqual([]);
  });

  it('derives (and labels) pairs when the scene defines none', () => {
    const out = deriveConnections(agents, plan, { ...geo, connections: [] }, new Map());
    expect(out.every((c) => !c.defined)).toBeTrue();
  });
});
