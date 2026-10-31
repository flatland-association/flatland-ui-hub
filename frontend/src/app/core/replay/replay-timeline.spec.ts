import type { AgentDTO } from '../models';
import type { CallEntry } from '../interaction-log/call-log.interceptor';
import type { SessionRecord } from '../interaction-log/session-record';
import type { StateFrame } from '../interaction-log/state-log.service';
import { callKey, isReplayable, legAt, responseAt, sessionSpan, stateFromFrames } from './replay-timeline';

const agent = (handle: number, position: [number, number]) => ({ handle, position }) as unknown as AgentDTO;
const map = { width: 3, height: 2, rail_grid: [[0]], rail_tiles: [], decision_cells: [] };

const frames: StateFrame[] = [
  { seq: 1, t: 100, simStep: 0, maxSteps: 180, episodeDone: false, agents: [agent(0, [0, 0]), agent(1, [1, 1])], map },
  { seq: 2, t: 200, simStep: 1, agents: [agent(1, [1, 2])] },
  { seq: 3, t: 300, simStep: 2, episodeDone: true, agents: [agent(0, [0, 1])] },
];

const call = (seq: number, t: number, url: string, response?: unknown, same?: number): CallEntry => ({
  seq, t, simStep: 0, mode: 'co-learning', method: 'GET', url, status: 200, ms: 5,
  ...(same ? { response_same_as: same } : { response }),
});

describe('replay timeline', () => {
  it('rebuilds the trains from delta frames', () => {
    const at200 = stateFromFrames(frames.slice(0, 2))!;
    expect(at200.agents.map((a) => a.position)).toEqual([[0, 0], [1, 2]]);
    expect([at200.elapsed_steps, at200.max_episode_steps, at200.episode_done]).toEqual([1, 180, false]);
    const end = stateFromFrames(frames)!;
    expect(end.agents.map((a) => a.position)).toEqual([[0, 1], [1, 2]]);
    expect(end.episode_done).toBeTrue();
    expect(stateFromFrames([])).toBeNull();
  });

  it('starts over at a frame with a map (scenario change)', () => {
    const next: StateFrame = { seq: 4, t: 400, simStep: 0, maxSteps: 90, episodeDone: false, agents: [agent(5, [2, 2])], map };
    expect(stateFromFrames([...frames, next])!.agents.map((a) => a.handle)).toEqual([5]);
  });

  it('answers a request with the latest recorded response at or before the moment', () => {
    const calls = [
      call(1, 100, 'http://localhost:8000/session/s1/state', { step: 0 }),
      call(2, 200, '/session/s1/state', undefined, 1),
      call(3, 300, '/session/s1/state', { step: 2 }),
      call(4, 300, '/session/s1/proposals?handle=1', { p: 1 }),
    ];
    expect(callKey('get', 'http://localhost:8000/a?b=1')).toBe('GET /a?b=1');
    expect(responseAt(calls, 'GET', '/session/s1/state', 250)!.body).toEqual({ step: 0 });
    expect(responseAt(calls, 'GET', '/session/s1/state', 999)!.body).toEqual({ step: 2 });
    expect(responseAt(calls, 'GET', '/session/s1/state', 50)!.body).toEqual({ step: 0 });
    expect(responseAt(calls, 'GET', '/session/s1/proposals?handle=2', 999)).toBeNull();
  });

  it('knows which leg is on screen and how long a session ran', () => {
    const rec = (startedAt: number, endedAt: number | null, states: StateFrame[] = []) =>
      ({ header: { startedAt, endedAt }, context: [{ t: (endedAt ?? startedAt) + 50 }], states }) as unknown as SessionRecord;
    const legs = [rec(100, 400, frames), rec(500, null)];
    expect(legAt(legs, 50)).toBe(0);
    expect(legAt(legs, 450)).toBe(0);
    expect(legAt(legs, 500)).toBe(1);
    expect(sessionSpan(legs[0])).toEqual({ start: 100, end: 450 });
    expect(isReplayable(legs[0])).toBeTrue();
    expect(isReplayable(legs[1])).toBeFalse();
  });
});
