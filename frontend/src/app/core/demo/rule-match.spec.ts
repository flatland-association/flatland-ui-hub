import { LearningRecord, RationaleContext } from '../learning-store.service';
import { matchingRule } from './rule-match';

const ctx = (clearsInSteps: number, canReroute: boolean): RationaleContext => ({
  connectionCritical: false,
  lowDelay: false,
  lowRipple: true,
  aiSuggestion: null,
  simStep: 30,
  hasScenario: true,
  impact: { etaSteps: 19, clearsInSteps, canReroute, blockedBy: 1 },
});

const record = (partial: Partial<LearningRecord>): LearningRecord => ({
  id: 'lr',
  createdAt: 1000,
  mode: 'co-learning',
  handle: 2,
  action: 5,
  strategyLabel: 'Umleiten',
  rationale: '',
  hypothesis: 'h',
  response: 'yes',
  once: false,
  context: ctx(17, true),
  ...partial,
});

describe('matchingRule', () => {
  it('fits a long block with a reroute, on another train', () => {
    const rule = record({});
    expect(matchingRule([rule], { clears_in_steps: 20, can_reroute: true }, 0)).toBe(rule);
  });

  it('does not fit when the condition differs', () => {
    const rule = record({});
    expect(matchingRule([rule], { clears_in_steps: 4, can_reroute: true }, 0)).toBeNull();
    expect(matchingRule([rule], { clears_in_steps: 20, can_reroute: false }, 0)).toBeNull();
  });

  it('ignores one-offs, rules from before this tour run and cards without impact context', () => {
    const once = record({ response: 'once', once: true });
    const old = record({ createdAt: 10 });
    const proxies = record({ context: { ...ctx(17, true), impact: undefined } });
    expect(matchingRule([once, old, proxies], { clears_in_steps: 20, can_reroute: true }, 500)).toBeNull();
  });

  it('leaves out rules confirmed in the current shift', () => {
    const now = record({ createdAt: 3000 });
    expect(matchingRule([now], { clears_in_steps: 20, can_reroute: true }, 0, 2500)).toBeNull();
  });

  it('takes the most recent fitting rule', () => {
    const first = record({ id: 'a', createdAt: 1000, action: 4 });
    const second = record({ id: 'b', createdAt: 2000 });
    expect(matchingRule([first, second], { clears_in_steps: 20, can_reroute: true }, 0)?.id).toBe('b');
  });
});
