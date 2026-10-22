import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { LabAiChoice } from '../../core/models';
import { AgentInspectorComponent } from './agent-inspector.component';

function choice(overrides: Partial<LabAiChoice> = {}): LabAiChoice {
  return {
    available: true,
    action: 2,
    policyAction: 2,
    optionProbabilities: { '2': 0.75, '4': 0.25 },
    actionSeenCounts: { '2': 10, '4': 0 },
    actionSeenCountsExact: true,
    actionSeenCountsBySource: {
      executed: { '2': 8, '4': 0 },
      simulated: { '2': 2, '4': 0 },
    },
    actionSeenCountSpread: { '2': 2, '4': 0 },
    actionSeenCountUncertainty: { '2': 60, '4': 100 },
    ...overrides,
  };
}

describe('AgentInspectorComponent PPO metrics', () => {
  let component: AgentInspectorComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentInspectorComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    component = TestBed.createComponent(AgentInspectorComponent).componentInstance;
  });

  it('shows selected-option log-likelihood and entropy from normalized option probabilities', () => {
    const selected = choice({
      optionProbabilities: { '2': 3, '4': 1 },
    });

    expect(component.matrixLogLikelihoodText(selected)).toBe(Math.log(0.75).toFixed(2));
    expect(component.matrixLikelihoodInterpretation(selected)).toBe('lab.inspector.likelihoodAboveUniform');
    expect(component.matrixEntropyText(selected)).toBe(
      (-(0.75 * Math.log(0.75) + 0.25 * Math.log(0.25))).toFixed(2),
    );
    expect(component.logLikelihoodTooltip(selected)).toContain('log-likelihood');
    expect(component.entropyTooltip(selected)).toContain('Entropy:');
  });

  it('shows bounded familiarity and labels sparse-data uncertainty with explanatory tooltips', () => {
    const selected = choice();

    expect(component.matrixExperiencePercentText(selected)).toBe('50%');
    expect(component.isHighCountUncertainty(selected)).toBeTrue();
    expect(component.matrixCountUncertaintyText(selected)).toContain('60%');
    expect(component.experienceTooltip(selected)).toContain('exact quantized-state counts');
    expect(component.countUncertaintyTooltip(selected)).toContain('uncertainty 60%');
  });
});