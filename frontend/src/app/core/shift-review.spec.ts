import { DecisionLogEntry } from './decision-log';
import { LearningRecord } from './learning-store.service';
import type { AgentDTO } from './models';
import { buildShiftReview, shiftKpis, statedReason } from './shift-review';

let seq = 0;
function strategyEntry(over: Partial<DecisionLogEntry> = {}): DecisionLogEntry {
  seq += 1;
  return {
    seq,
    t: seq * 1000,
    simStep: seq * 10,
    mode: 'director',
    handle: -1,
    accountableOwner: 'human',
    action: 'strategy',
    aiSuggestion: null,
    decisionTimeMs: null,
    valueAxis: 'connection',
    tradedAway: '31 Punkte Pünktlichkeit',
    rationale: 'Strategie: Anschlüsse halten; Schützt Anschluss',
    preferenceHypothesis: 'Bei Zielkonflikten priorisierst du Anschlüsse.',
    hypothesisResponse: 'yes',
    ...over,
  };
}

function record(over: Partial<LearningRecord> = {}): LearningRecord {
  return {
    id: 'lr1',
    createdAt: 1,
    mode: 'director',
    handle: -1,
    action: 0,
    strategyLabel: 'Anschlüsse halten',
    rationale: 'Schützt Anschluss',
    hypothesis: 'Bei Zielkonflikten priorisierst du Anschlüsse.',
    response: 'yes',
    once: false,
    context: {
      connectionCritical: true,
      lowDelay: false,
      lowRipple: false,
      aiSuggestion: null,
      simStep: 10,
      hasScenario: true,
    },
    ...over,
  };
}

const KPIS = { total: 8, arrived: 6, delayed: 2, malfunctions: 1, totalDelay: 44 };

function build(log: DecisionLogEntry[], records: LearningRecord[] = []) {
  return buildShiftReview({
    kpis: KPIS,
    ai: { decisions: 64, replans: 2 },
    decisionLog: log,
    learningRecords: records,
  });
}

beforeEach(() => (seq = 0));

function kpiAgent(over: Partial<AgentDTO> = {}): AgentDTO {
  return {
    handle: 0, position: [0, 0], direction: 1, initial_position: [0, 0], initial_direction: 1,
    target: [0, 1], state: 'MOVING', speed: 1, earliest_departure: 0, latest_arrival: 10,
    eta_to_depart: 0, time_to_deadline: 0, delay: 0, is_visible: true,
    delay_color_intensity: 0, cell_type: 'FORWARD_ONLY', next_decision: null,
    override_action: null, malfunction_remaining: 0, is_malfunctioning: false,
    ...over,
  };
}

describe('shiftKpis', () => {
  it('retains native lateness after all trains reach DONE with zero live delay', () => {
    const agents = [8, 12, 19].map((accrued_lateness, handle) => kpiAgent({
      handle, state: 'DONE', delay: 0, accrued_lateness,
    }));
    expect(shiftKpis(agents)).toEqual({ total: 3, arrived: 3, delayed: 3, malfunctions: 0, totalDelay: 39 });
    expect(agents.map((a) => a.delay)).toEqual([0, 0, 0]);
  });

  it('falls back for legacy or unknown arrivals while respecting native zero and nonnegative totals', () => {
    const agents = [
      kpiAgent({ state: 'DONE', delay: 8 }),
      kpiAgent({ state: 'MOVING', delay: 12, accrued_lateness: null }),
      kpiAgent({ state: 'DONE', delay: 19, accrued_lateness: 0 }),
      kpiAgent({ state: 'MOVING', delay: -4 }),
      kpiAgent({ state: 'WAITING' }),
    ];
    expect(shiftKpis(agents)).toEqual({ total: 5, arrived: 2, delayed: 2, malfunctions: 0, totalDelay: 20 });
  });

  it('preserves the existing optional state-label malfunction recognition of the live review', () => {
    const agents = [
      kpiAgent({ handle: 0, state: 'MALFUNCTION' }),
      kpiAgent({ handle: 1, is_malfunctioning: true }),
      kpiAgent({ handle: 2, malfunction_remaining: 2 }),
    ];
    expect(shiftKpis(agents).malfunctions).toBe(2);
    expect(shiftKpis(agents, { includeMalfunctionState: true }).malfunctions).toBe(3);
  });
});

describe('statedReason', () => {
  it('drops the bookkeeping prefix and keeps what the operator said', () => {
    expect(statedReason('Strategie: Anschlüsse halten; Schützt Anschluss')).toBe(
      'Schützt Anschluss',
    );
  });

  it('returns null when only the prefix was recorded', () => {
    expect(statedReason('Strategie: Anschlüsse halten')).toBeNull();
    expect(statedReason(undefined)).toBeNull();
  });

  it('keeps several reasons together, including free text', () => {
    expect(
      statedReason('Strategie: X; Schützt Anschluss; Nordumleitung war frei'),
    ).toBe('Schützt Anschluss; Nordumleitung war frei');
  });
});

describe('buildShiftReview', () => {
  it('reports the shift running unattended when no goal was ever set', () => {
    // A legitimate outcome, not an empty state — and the case a co-learning
    // study most wants reported.
    const review = build([]);
    expect(review.ranUnattended).toBeTrue();
    expect(review.choices).toEqual([]);
    expect(review.ai).toEqual({ decisions: 64, replans: 2 });
    expect(review.kpis).toBe(KPIS);
  });

  it('recounts each strategy choice with its price and stated reason', () => {
    const review = build([strategyEntry()]);
    expect(review.ranUnattended).toBeFalse();
    expect(review.choices.length).toBe(1);
    const c = review.choices[0];
    expect(c.title).toBe('Anschlüsse halten');
    expect(c.axisLabel).toBe('Anschluss');
    expect(c.tradedAway).toBe('31 Punkte Pünktlichkeit');
    expect(c.reason).toBe('Schützt Anschluss');
    expect(c.response).toBe('yes');
  });

  it('ignores non-strategy decisions when recounting the choices', () => {
    const override: DecisionLogEntry = {
      ...strategyEntry(),
      action: 'override',
      valueAxis: undefined,
      rationale: 'Schützt Anschluss',
    };
    const review = build([override, strategyEntry()]);
    expect(review.choices.length).toBe(1);
  });

  it('picks at most three moments worth discussing', () => {
    const log = Array.from({ length: 6 }, () => strategyEntry());
    expect(build(log).moments.length).toBeLessThanOrEqual(3);
  });

  it('separates confirmed preferences from one-offs', () => {
    const review = build(
      [strategyEntry()],
      [record(), record({ id: 'lr2', response: 'once', once: true })],
    );
    expect(review.confirmed.length).toBe(1);
    expect(review.oneOffs.length).toBe(1);
    // A one-off must never be presented as a learned rule.
    expect(review.confirmed[0].once).toBeFalse();
  });

  it('stays silent about a contradiction when the shift was consistent', () => {
    const review = build([strategyEntry(), strategyEntry()]);
    expect(review.contradiction).toBeNull();
  });

  it('asks about two different priorities instead of resolving them silently', () => {
    const review = build([
      strategyEntry(),
      strategyEntry(),
      strategyEntry({ valueAxis: 'punctuality', rationale: 'Strategie: Verspätung minimieren' }),
    ]);
    const c = review.contradiction!;
    expect(c).not.toBeNull();
    expect(c.axes[0]).toEqual({ axis: 'connection', label: 'Anschluss', count: 2 });
    expect(c.axes[1]).toEqual({ axis: 'punctuality', label: 'Pünktlichkeit', count: 1 });
    // Framed as a question — the operator is the only one who can explain it.
    expect(c.question).toContain('Was war in der Lage anders');
    expect(c.question).toContain('2× Anschluss');
    expect(c.question).toContain('1× Pünktlichkeit');
  });

  it('excludes an explicitly rejected hypothesis from the contradiction', () => {
    // 'no' means "that is not my preference" — counting it would manufacture a
    // tension the operator denied.
    const review = build([
      strategyEntry(),
      strategyEntry(),
      strategyEntry({ valueAxis: 'punctuality', hypothesisResponse: 'no' }),
    ]);
    expect(review.contradiction).toBeNull();
  });

  it('counts a one-off towards the tension, since it was still a real choice', () => {
    const review = build([
      strategyEntry(),
      strategyEntry({ valueAxis: 'stability', hypothesisResponse: 'once' }),
    ]);
    expect(review.contradiction).not.toBeNull();
    expect(review.contradiction!.axes.map((a) => a.axis).sort()).toEqual([
      'connection',
      'stability',
    ]);
  });

  it('survives a choice that named no axis', () => {
    const review = build([strategyEntry({ valueAxis: undefined, rationale: undefined })]);
    expect(review.choices[0].axisLabel).toBe('—');
    expect(review.choices[0].reason).toBeNull();
    expect(review.contradiction).toBeNull();
  });
});
