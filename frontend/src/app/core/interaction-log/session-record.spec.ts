import type { DecisionLogEntry } from '../decision-log';
import { decisionKey, mergeDecisions, orderedDecisions, recordFileName } from './session-record';

function entry(t: number, seq: number, extra: Partial<DecisionLogEntry> = {}): DecisionLogEntry {
  return { t, seq, simStep: 0, mode: 'recommendation', handle: 0, ...extra } as DecisionLogEntry;
}

describe('session-record helpers', () => {
  it('keys a decision by time and sequence', () => {
    expect(decisionKey(entry(10, 3))).toBe('10:3');
  });

  it('keeps entries the store has already cleared and lets later patches replace by key', () => {
    let archive = mergeDecisions(new Map(), [entry(1, 1), entry(2, 2)]);
    // The store cleared its log; seq restarts at 1 but t differs.
    archive = mergeDecisions(archive, [entry(5, 1)]);
    expect(archive.size).toBe(3);

    archive = mergeDecisions(archive, [entry(5, 1, { handle: 7 })]);
    expect(archive.size).toBe(3);
    expect(archive.get('5:1')?.handle).toBe(7);
  });

  it('orders by time and drops the oldest beyond the cap, reporting how many', () => {
    const archive = mergeDecisions(new Map(), [entry(3, 3), entry(1, 1), entry(2, 2)]);
    const all = orderedDecisions(archive);
    expect(all.decisions.map((d) => d.t)).toEqual([1, 2, 3]);
    expect(all.dropped).toBe(0);

    const capped = orderedDecisions(archive, 2);
    expect(capped.decisions.map((d) => d.t)).toEqual([2, 3]);
    expect(capped.dropped).toBe(1);
  });

  it('names the file after participant, condition, run and session, sanitised', () => {
    expect(recordFileName({ participantId: 'P 07/x', conditionId: 'mode-a', tourId: null, runIndex: 2, sessionId: 'abc' }))
      .toBe('flatland-P-07-x-mode-a-2-abc.json');
    expect(recordFileName({ participantId: null, conditionId: null, tourId: 'intro', runIndex: 1, sessionId: 's' }))
      .toBe('flatland-anon-tour-intro-1-s.json');
    expect(recordFileName({ participantId: '', conditionId: null, tourId: null, runIndex: 1, sessionId: 's' }))
      .toBe('flatland-anon-free-1-s.json');
  });
});
