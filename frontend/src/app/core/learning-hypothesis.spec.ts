import { RationaleContext, buildPreferenceHypothesis, strategyLabelForAction } from './learning-store.service';

const base: RationaleContext = {
  connectionCritical: false,
  lowDelay: false,
  lowRipple: true,
  aiSuggestion: null,
  simStep: 30,
  hasScenario: true,
};

describe('strategyLabelForAction', () => {
  it('names a Plan / KI / Mensch choice by what was logged, not by the placeholder action', () => {
    // recordProposalChoice passes action 2, which used to read as "Reroute".
    expect(strategyLabelForAction(2, undefined, 'proceed')).toBe('Proceed');
    expect(strategyLabelForAction(2, undefined, 'accept')).toBe('the AI proposal');
  });

  it('keeps the action-based labels for overrides', () => {
    expect(strategyLabelForAction(4)).toBe('Hold');
    expect(strategyLabelForAction(5)).toBe('Reroute');
  });
});

describe('buildPreferenceHypothesis with impact context', () => {
  it('states the condition the operator saw', () => {
    const ctx = { ...base, impact: { etaSteps: 19, clearsInSteps: 20, canReroute: true, blockedBy: 1 } };
    expect(buildPreferenceHypothesis(ctx, 'Reroute')).toBe(
      'When the section is blocked for another 20 steps and a reroute exists, you choose Reroute.',
    );
  });

  it('distinguishes a short block without a reroute', () => {
    const ctx = { ...base, impact: { etaSteps: 3, clearsInSteps: 4, canReroute: false, blockedBy: 0 } };
    expect(buildPreferenceHypothesis(ctx, 'Proceed')).toBe(
      'When the section clears within 4 steps and there is no reroute, you choose Proceed.',
    );
  });

  it('leaves the scenario template alone without impact context', () => {
    expect(buildPreferenceHypothesis(base, 'Hold')).toContain('you prefer Hold');
  });
});
