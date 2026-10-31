import { groupRuns, runFileStem, utcStamp } from './saved-runs';
import type { SessionRecord } from './session-record';

function rec(sessionId: string, startedAt: number, header: Partial<SessionRecord['header']> = {}): SessionRecord {
  return {
    header: { sessionId, startedAt, endedAt: startedAt + 600_000, mode: 'co-learning', conditionId: null, conditionLabel: null, ...header },
  } as unknown as SessionRecord;
}

const T0 = Date.UTC(2026, 9, 29, 8, 3, 12);

describe('saved runs', () => {
  it('groups the legs of a run, newest run first, a free session alone', () => {
    const runs = groupRuns([
      rec('b', T0 + 900_000, { experimentRunId: 'run-x', conditionId: 'plan-b-p03', conditionLabel: 'Plan B', legIndex: 1 }),
      rec('a', T0, { experimentRunId: 'run-x', conditionId: 'plan-b-p03', conditionLabel: 'Plan B', legIndex: 0 }),
      rec('t', T0 + 3_600_000, { experimentRunId: 'run-t', tourId: 'colearning-intro' }),
      rec('f', T0 + 7_200_000),
    ]);
    expect(runs.map((r) => [r.kind, r.key, r.legs.map((l) => l.header.sessionId)])).toEqual([
      ['free', 'f', ['f']],
      ['tour', 'run-t', ['t']],
      ['condition', 'run-x', ['a', 'b']],
    ]);
    expect(runs[2].endedAt).toBe(T0 + 1_500_000);
    expect(runs[2].label).toBe('Plan B');
  });

  it('names files like the server folders', () => {
    expect(utcStamp(T0)).toBe('2026-10-29_08-03-12Z');
    const [condition] = groupRuns([rec('a', T0, { experimentRunId: 'run-mh2k9q-x7f3a1', conditionId: 'plan-b-p03' })]);
    expect(runFileStem(condition)).toBe('2026-10-29_08-03-12Z_plan-b-p03_run-mh2k9q-x7f3a1');
    const [tour] = groupRuns([rec('t', T0, { experimentRunId: 'run-t', tourId: 'colearning-intro' })]);
    expect(runFileStem(tour)).toBe('2026-10-29_08-03-12Z_tour-colearning-intro_run-t');
    const [free] = groupRuns([rec('c9d0e1f2', T0)]);
    expect(runFileStem(free)).toBe('2026-10-29_08-03-12Z_free_c9d0e1f2');
  });
});
