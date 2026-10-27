import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { AgentDTO, LabAiChoice, PolicyInfo, SessionState } from '../../core/models';
import { SessionStore } from '../../core/session.store';
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
  let store: SessionStore;
  let fixture: ReturnType<typeof TestBed.createComponent<AgentInspectorComponent>>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AgentInspectorComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    fixture = TestBed.createComponent(AgentInspectorComponent);
    component = fixture.componentInstance;
    store = TestBed.inject(SessionStore);
  });

  it('fetches all learned-policy choices in one request per simulation step', () => {
    const http = TestBed.inject(HttpTestingController);
    store.session.set({ id: 'session-1', width: 10, height: 10, num_agents: 2 });
    store.state.set({
      elapsed_steps: 0,
      agents: [{ handle: 0 }, { handle: 1 }] as AgentDTO[],
    } as SessionState);
    store.adoptPolicy('lab:online-ppo');

    const learnedPolicy: PolicyInfo = {
      id: 'lab:online-ppo',
      label: 'Online PPO',
      description: '',
      is_default: false,
      show_in_ui: true,
      supports_scenarios: false,
      family: 'learned',
      deterministic: false,
      role: 'operational',
      observation: '',
      at_conflict: '',
      provenance: '',
      licence: '',
      grounding: '',
    };
    http.expectOne((request) => request.url.endsWith('/policies')).flush([learnedPolicy]);
    fixture.detectChanges();

    const help = fixture.nativeElement.querySelector('.ao-matrix-help') as HTMLDetailsElement;
    expect(help).toBeTruthy();
    expect(help.open).toBeFalse();
    expect(help.nextElementSibling?.querySelector('.ao-title')?.textContent)
      .toContain('Agent decisions');
    const decisionRow = fixture.nativeElement.querySelector('[data-testid="agent-inspector-decision-row-0"]') as HTMLDetailsElement;
    expect(decisionRow).toBeTruthy();
    expect(decisionRow.open).toBeFalse();
    const expertDetails = decisionRow.querySelector('.ao-expert-details') as HTMLDetailsElement;
    expect(expertDetails.open).toBeFalse();
    const summaryText = decisionRow.querySelector('summary')?.textContent ?? '';
    expect(summaryText).not.toMatch(/PPO|Advantage|Entropy|Log-likelihood|Q value|V value/i);

    const first = http.expectOne((request) => request.url.endsWith('/lab/ai-choices'));
    expect(first.request.params.get('evaluationPolicy')).toBe('lab:online-ppo');
    first.flush({
      0: choice({ actionValues: { '2': 0.34, '4': -0.09 } }),
      1: choice(),
    });
    fixture.detectChanges();

    const summary = decisionRow.querySelector('summary') as HTMLElement;
    const summaryTextAfterLoad = summary.textContent ?? '';
    expect(summary.querySelectorAll('[role="progressbar"]').length).toBe(0);
    expect(summaryTextAfterLoad).toContain('Expected effect');
    expect(summaryTextAfterLoad).toContain('Estimate reliability');
    expect(summaryTextAfterLoad).toContain('about 10 observations');
    expect(summaryTextAfterLoad).not.toMatch(/preference clarity|\b\d+%/i);
    expect(summaryTextAfterLoad).toContain('best long-term course');

    decisionRow.open = true;
    fixture.detectChanges();
    const actionTable = decisionRow.querySelector('.ao-action-table') as HTMLTableElement;
    expect(actionTable.querySelectorAll('tbody tr').length).toBe(4);
    expect(Array.from(actionTable.querySelectorAll('thead th')).map((cell) => cell.textContent?.trim()))
      .toEqual(['Action', 'Expected value', 'Policy preference']);
    expect(actionTable.querySelector('.ao-action-table__value')?.textContent).toContain('0.34');
    expect(decisionRow.querySelector('[data-testid="agent-inspector-operator-view-0"]')).toBeTruthy();
    expect(decisionRow.textContent).toContain('50 percentage points');

    store.state.update((state) => (state ? { ...state, elapsed_steps: 1 } : state));
    fixture.detectChanges();
    const next = http.expectOne((request) => request.url.endsWith('/lab/ai-choices'));
    next.flush({ 0: choice(), 1: choice() });
    http.expectOne((request) => request.url.endsWith('/hmi/geography')).flush({});
    http.verify();
  });

  it('groups online PPO rows like the Agents roster and starts in its default states', () => {
    const agent = (handle: number, state: string, eta_to_depart: number | null = null) => ({
      handle,
      state,
      eta_to_depart,
      is_malfunctioning: state.includes('MALFUNCTION'),
      malfunction_remaining: 0,
    }) as AgentDTO;
    store.state.set({
      agents: [agent(0, 'MOVING'), agent(1, 'WAITING', 4), agent(2, 'DONE'), agent(3, 'MALFUNCTION_OFF_MAP')],
    } as SessionState);

    expect(component.matrixAgentGroups().map((group) => group.key)).toEqual(['MOVING', 'WAITING', 'DONE']);
    expect(component.matrixAgentGroups().map((group) => group.agents.map((item) => item.handle))).toEqual([
      [0, 3],
      [1],
      [2],
    ]);
    expect(component.collapsedMatrixGroups()).toEqual({ MOVING: false, WAITING: false, DONE: false });
  });

  it('toggles a matrix group independently', () => {
    component.toggleMatrixGroup('MOVING');
    expect(component.collapsedMatrixGroups()).toEqual({ MOVING: true, WAITING: false, DONE: false });
  });

  it('shows per-action preference percentages and plain-language spread', () => {
    const selected = choice({
      optionProbabilities: { '2': 3, '4': 1 },
    });

    expect(component.matrixActionPreferenceText(selected, 2)).toBe('75%');
    expect(component.matrixExperienceObservationCountText(selected)).toBe('about 10 observations');
    expect(component.matrixDecisionConfidenceText(selected)).toBe('Clear favorite');
    expect(component.matrixSpreadText(selected)).toBe('Mixed preference');
    expect(component.entropyTooltip(selected)).toContain('Low spread means a clear preference.');
    expect(component.matrixDecisionConfidenceText(choice({ optionProbabilities: { '2': 1 } })))
      .toBe('Clear favorite');
  });

  it('summarizes strong, unclear, and critical model assessments per train', () => {
    const strong = choice({
      optionProbabilities: { '2': 0.8, '4': 0.2 },
      advantages: { '2': 0.3, '4': -0.1 },
      actionSeenCounts: { '2': 10, '4': 2 },
      actionSeenCountUncertainty: { '2': 10, '4': 70 },
    });
    expect(component.matrixSummaryText(strong)).toContain('strongly favors');

    const unclear = choice({
      optionProbabilities: { '2': 0.52, '4': 0.48 },
      advantages: { '2': 0.1, '4': 0.0 },
      actionSeenCounts: { '2': 1, '4': 1 },
      actionSeenCountUncertainty: { '2': 80, '4': 80 },
    });
    expect(component.matrixDecisionConfidenceText(unclear)).toBe('Several seem similarly suitable');
    expect(component.matrixSpreadText(unclear)).toBe('No clear favorite');
    expect(component.matrixSummaryText(unclear)).toContain('no clear preference');

    const critical = choice({
      optionProbabilities: { '2': 0.6, '4': 0.4 },
      advantages: { '2': -0.2, '4': -0.1 },
      actionSeenCounts: { '2': 1, '4': 1 },
      actionSeenCountUncertainty: { '2': 60, '4': 60 },
    });
    expect(component.matrixSummaryText(critical)).toContain('effects');
    expect(component.matrixExperienceText(critical)).toBe('Little');
    expect(component.experienceReliabilityText(critical)).toBe('Low');
  });

  it('sorts actions by preference and separates preference from decision confidence', () => {
    const selected = choice({
      optionProbabilities: { '4': 0.29, '2': 0.26, '1': 0.21 },
    });
    expect(component.matrixSortedActions(selected)).toEqual([4, 2, 1, 3]);
    expect(component.matrixActionPreferenceText(selected, 4)).toBe('38%');
    expect(component.matrixConfidencePercent(selected)).toBe(4);
    expect(component.matrixRecommendationMarginPercent(selected)).toBe(4);
    expect(component.matrixRecommendationMarginText(selected)).toBe('4 percentage points');
    expect(component.matrixRecommendationMarginDescription(selected)).toBe('Very close choices');
    expect(component.matrixConfidenceBand(selected)).toBe('low');
    expect(component.matrixHasClearFavorite(selected)).toBeFalse();

    const decisive = choice({ optionProbabilities: { '2': 0.95, '1': 0.03, '3': 0.02 } });
    expect(component.matrixConfidencePercent(decisive)).toBe(92);
    expect(component.matrixRecommendationMarginPercent(decisive)).toBe(92);
    expect(component.matrixConfidenceText(decisive)).toBe('Very high');
  });

  it('computes the uncalibrated estimate-reliability band from all five factors', () => {
    const selected = choice({
      optionProbabilities: { '2': 0.8, '4': 0.2 },
      advantages: { '2': 0.1, '4': 0.03 },
      actionSeenCounts: { '2': 10, '4': 2 },
      actionSeenCountUncertainty: { '2': 20, '4': 40 },
    });
    expect(component.matrixForecastQualityPercent(selected)).toBe(54);
    expect(component.matrixForecastQualityBand(selected)).toBe('low');
    expect(component.matrixExperienceIndexPercent(selected)).toBe(50);
    expect(component.matrixForecastQualityPercent(choice({ actionSeenCounts: {} }))).toBeNull();
  });

  it('classifies each action effect independently and exposes expert PPO values', () => {
    const effects = choice({
      optionProbabilities: { '2': 0.4, '4': 0.3, '1': 0.2, '3': 0.1 },
      advantages: { '2': 0.2, '4': 0.05, '1': -0.05, '3': -0.1 },
    });
    expect(component.matrixEffectText(effects, 2)).toBe('Very positive');
    expect(component.matrixEffectText(effects, 4)).toBe('Positive');
    expect(component.matrixEffectText(effects, 1)).toBe('Neutral');
    expect(component.matrixEffectText(effects, 3)).toBe('Critical');
    expect(component.matrixEffectText(choice({
      optionProbabilities: { '3': 1 },
      advantages: { '3': -0.21 },
    }), 3)).toBe('Negative');

    const expert = choice({
      optionProbabilities: { '2': 0.52, '4': 0.48 },
      actionValues: { '2': 1.24, '4': 1.11 },
      stateValue: 1.28,
      advantages: { '2': -0.04, '4': -0.17 },
      actionSeenCounts: { '2': 2.66, '4': 1 },
      actionSeenCountUncertainty: { '2': 52, '4': 70 },
    });
    expect(component.matrixExpertMetricText(expert, 2, 'policyProbability')).toBe('52%');
    expect(component.matrixExpertMetricText(expert, 2, 'advantage')).toBe('-0.04');
    expect(component.matrixExpertMetricText(expert, 2, 'qValue')).toBe('1.24');
    expect(component.matrixExpertMetricText(expert, 2, 'vValue')).toBe('1.28');
    expect(component.matrixExpertMetricText(expert, 2, 'qMinusV')).toBe('-0.04');
    expect(component.matrixExpertMetricText(expert, 2, 'logLikelihood')).toBe(Math.log(0.52).toFixed(2));
    expect(component.matrixExpertMetricText(expert, 2, 'entropy')).toContain('nats');
    expect(component.matrixExpertMetricText(expert, 2, 'actionExperience')).toBe('21%');
    expect(component.matrixExpertMetricText(expert, 2, 'countUncertainty')).toBe('52%');
    expect(component.matrixExpertMetricTooltip(expert, 2, 'actionExperience')).toContain('raw count: 2.7');
    expect(component.matrixExpertDefinition('q')).toContain('0.99');
  });

  it('shows bounded familiarity and labels sparse-data uncertainty with explanatory tooltips', () => {
    const selected = choice();

    expect(component.matrixExperiencePercentText(selected)).toBe('50%');
    expect(component.isHighCountUncertainty(selected)).toBeTrue();
    expect(component.matrixCountUncertaintyText(selected)).toContain('60%');
    expect(component.experienceTooltip(selected)).toContain('not a quality score.');
    expect(component.countUncertaintyTooltip(selected)).toContain('not a success probability.');
    expect(component.matrixOverviewRationale(choice({ advantages: { '2': -0.1 } })))
      .toContain('expected system effect is negative');
  });
});