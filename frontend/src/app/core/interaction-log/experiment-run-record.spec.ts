import { buildExperimentRunRecord, experimentRunRecordFileName } from './experiment-run-record';
import type { ShiftRecord } from '../demo/tour-context.service';

function leg(n: number, sessionId: string | null): ShiftRecord {
  return { leg: n, sessionId, played: null, decisions: [], rules: [], ruleApplied: null, legId: `leg-${n}` };
}

describe('experiment run record', () => {
  it('orders the legs by position and attaches each session record', () => {
    const record = buildExperimentRunRecord(
      {
        experimentRunId: 'run-1',
        conditionId: 'plan-b-p01',
        conditionLabel: 'Plan B · participant 01',
        startedAt: 1,
        endedAt: 2,
        status: 'completed',
        resumedAt: [],
        appVersion: null,
        backendVersion: null,
        legs: [leg(1, 's2'), leg(0, 's1'), leg(2, null)],
        questionnaires: [],
      },
      (sid) => ({ header: { sessionId: sid } }) as never,
    );
    expect(record.schema).toBe('flatland-experiment-run-record');
    expect(record.legs.map((l) => l.legId)).toEqual(['leg-0', 'leg-1', 'leg-2']);
    expect(record.legs.map((l) => l.record?.header.sessionId ?? null)).toEqual(['s1', 's2', null]);
  });

  it('names the file after the condition and the run', () => {
    expect(experimentRunRecordFileName({ conditionId: 'plan-b-p01', experimentRunId: 'run-abc' })).toBe(
      'flatland-plan-b-p01-run-abc.json',
    );
  });
});
