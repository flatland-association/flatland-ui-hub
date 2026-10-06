import { TourRule, checkRule, ruleApplies, ruleSentence } from './tour-rule';

const rule: TourRule = { minBlockSteps: 10, reroute: 'yes', measure: 'reroute' };
const t = (key: string, params?: Record<string, string>) =>
  key + (params ? JSON.stringify(params) : '');

describe('ruleApplies', () => {
  it('holds when the block is long enough and a reroute exists', () => {
    expect(ruleApplies(rule, { clears_in_steps: 20, can_reroute: true })).toBeTrue();
    expect(ruleApplies(rule, { clears_in_steps: 9, can_reroute: true })).toBeFalse();
    expect(ruleApplies(rule, { clears_in_steps: 20, can_reroute: false })).toBeFalse();
  });

  it('never applies a reroute where there is none, even without a reroute condition', () => {
    const any: TourRule = { minBlockSteps: null, reroute: 'any', measure: 'reroute' };
    expect(ruleApplies(any, { clears_in_steps: 20, can_reroute: false })).toBeFalse();
    expect(ruleApplies({ ...any, measure: 'proceed' }, { clears_in_steps: 2, can_reroute: false })).toBeTrue();
  });
});

describe('ruleSentence', () => {
  it('joins the conditions and names the measure', () => {
    expect(ruleSentence(rule, t)).toBe(
      'tourUi.rule.sentence{"cond":"tourUi.rule.cond.block{\\"n\\":\\"10\\"}tourUi.rule.andtourUi.rule.cond.reroute","measure":"tourUi.rule.then.reroute"}',
    );
  });

  it('says "always" without conditions', () => {
    expect(ruleSentence({ minBlockSteps: null, reroute: 'any', measure: 'proceed' }, t)).toBe(
      'tourUi.rule.sentenceAlways{"measure":"tourUi.rule.then.proceed"}',
    );
  });
});

describe('checkRule', () => {
  it('calls the cheapest option best', () => {
    expect(checkRule('reroute', { proceed: 40, hold_until: 40, reroute: 20 })).toEqual({ verdict: 'best', bestOption: 'reroute', gap: 0 });
  });

  it('reports the gap to the best option', () => {
    expect(checkRule('hold_until', { proceed: 26, hold_until: 30 })).toEqual({ verdict: 'worse', bestOption: 'proceed', gap: 4 });
  });

  it('brings nothing where another option does as well', () => {
    expect(checkRule('reroute', { proceed: 20, hold_until: 35, reroute: 20 })).toEqual({ verdict: 'tie', bestOption: 'proceed', gap: 0 });
  });

  it('cannot help where every option costs the same', () => {
    expect(checkRule('reroute', { proceed: 20, reroute: 20 }).verdict).toBe('equal');
  });

  it('notes a measure that is not available', () => {
    expect(checkRule('reroute', { proceed: 20, hold_until: 35 }).verdict).toBe('unavailable');
  });
});
