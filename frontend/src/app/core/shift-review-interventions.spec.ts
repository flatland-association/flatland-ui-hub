import { DecisionLogEntry, disturbanceEventsAt } from './decision-log';
import { AppNotification } from './events/event-types';
import { interventionsFrom, reflectionLines, shiftDecisionsFrom } from './shift-review';

function entry(partial: Partial<DecisionLogEntry>): DecisionLogEntry {
  return {
    seq: 1,
    t: 0,
    simStep: 0,
    mode: 'co-learning',
    handle: 0,
    accountableOwner: 'human',
    action: 'hold',
    ...partial,
  } as DecisionLogEntry;
}

describe('interventionsFrom', () => {
  it('lists human per-train decisions in order, with the stated reason', () => {
    const result = interventionsFrom([
      entry({ seq: 2, simStep: 40, handle: 1, action: 'proceed' }),
      entry({ seq: 1, simStep: 28, handle: 1, action: 'hold', rationale: 'Vermeide Deadlock', hypothesisResponse: 'once' }),
    ]);

    expect(result.map((i) => i.seq)).toEqual([1, 2]);
    expect(result[0]).toEqual(
      jasmine.objectContaining({ step: 28, handle: 1, action: 'hold', reason: 'Vermeide Deadlock', response: 'once' }),
    );
    expect(result[1].reason).toBeNull();
  });

  it('leaves out system holds, strategy choices and coordinated packages', () => {
    const result = interventionsFrom([
      entry({ seq: 1, accountableOwner: 'system' }),
      entry({ seq: 2, action: 'strategy', handle: -1 }),
      entry({ seq: 3, action: 'accept', handle: -1 }),
      entry({ seq: 4, accountableOwner: 'ai' }),
    ]);

    expect(result).toEqual([]);
  });

  it('strips the strategy bookkeeping prefix from a reason', () => {
    const [only] = interventionsFrom([entry({ rationale: 'Strategie: Anschlüsse halten; Schützt Anschluss' })]);

    expect(only.reason).toBe('Schützt Anschluss');
  });
});

// docs/plans/plan-b-control-group.md D-21: the disturbance messages open at a decision.
describe('disturbanceEventsAt', () => {
  const note = (code: string, train: number): AppNotification => ({
    id: `${code}-${train}`, kind: 'error', title: 'Malfunction', message: `Train ${train} …`, timestamp: 5,
    relatedElement: { kind: 'train', id: String(train) }, code, params: { train, steps: 8 },
  });

  it('keeps the disturbances of any train, the decided one first, and drops other messages', () => {
    const events = disturbanceEventsAt(
      [note('train.malfunction', 2), note('train.decisionPending', 1), note('disturbance.event', 1), note('train.malfunction', 1)],
      1,
    );
    expect(events.map((e) => [e.code, e.relatedElement?.id])).toEqual([
      ['disturbance.event', '1'],
      ['train.malfunction', '1'],
      ['train.malfunction', '2'],
    ]);
    expect(Object.keys(events[0]).sort()).toEqual(['code', 'message', 'params', 'relatedElement', 'title']);
  });

  it('is empty when no disturbance is open', () => {
    expect(disturbanceEventsAt([note('train.overridePending', 1)], 1)).toEqual([]);
  });
});

describe('interventionsFrom events and reflectionLines', () => {
  it('carries the events of a decision, none where it has none', () => {
    const events = [{ code: 'train.malfunction', title: 'Malfunction', message: 'Train 2 …', params: { train: 2 } }];
    const [a, b] = interventionsFrom([entry({ seq: 1, events }), entry({ seq: 2 })]);
    expect(a.events).toEqual(events);
    expect(b.events).toEqual([]);
  });

  it('words the reflection answers as lines', () => {
    const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? JSON.stringify(params) : ''}`;
    expect(reflectionLines(null, t)).toEqual([]);
    expect(reflectionLines({ gut: 'fit', missing: 'duration,other', tradeoff: 'G4 later' }, t)).toEqual([
      'tourUi.debrief.reflection.gut{"v":"reflectionPrompt.gut.fit"}',
      'tourUi.debrief.reflection.missing{"v":"reflectionPrompt.missing.duration, reflectionPrompt.missing.other"}',
      'tourUi.debrief.reflection.tradeoff{"v":"G4 later"}',
    ]);
  });
});

// docs/plans/plan-b-control-group.md S-13: one helper for the leg record and the debrief.
describe('shiftDecisionsFrom', () => {
  it('keeps the human decisions with their time, reason, reflection and events', () => {
    const events = [{ code: 'train.malfunction', title: 'Malfunction', message: 'Train 2 …', params: { train: 2 } }];
    const log = [
      entry({ seq: 1, simStep: 4, handle: 1, decisionTimeMs: 700, rationale: 'Schützt Anschluss', reflection: { gut: 'fit' }, events }),
      entry({ seq: 2, simStep: 6, handle: 2, accountableOwner: 'system', decisionTimeMs: null }),
      entry({ seq: 3, simStep: 9, handle: 0, action: 'proceed', decisionTimeMs: 1200 }),
    ];
    expect(shiftDecisionsFrom(log)).toEqual([
      { handle: 1, action: 'hold', simStep: 4, decisionTimeMs: 700, reason: 'Schützt Anschluss', reflection: { gut: 'fit' }, events },
      { handle: 0, action: 'proceed', simStep: 9, decisionTimeMs: 1200, reason: null, reflection: null, events: [] },
    ]);
  });
});
