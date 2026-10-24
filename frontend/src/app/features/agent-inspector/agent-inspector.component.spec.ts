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

    const first = http.expectOne((request) => request.url.endsWith('/lab/ai-choices'));
    expect(first.request.params.get('evaluationPolicy')).toBe('lab:online-ppo');
    first.flush({ 0: choice(), 1: choice() });

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
    expect(component.collapsedMatrixGroups()).toEqual({ MOVING: false, WAITING: true, DONE: false });
  });

  it('toggles a matrix group independently', () => {
    component.toggleMatrixGroup('MOVING');
    expect(component.collapsedMatrixGroups()).toEqual({ MOVING: true, WAITING: true, DONE: false });
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
    expect(component.entropyTooltip(selected)).toContain('Higher values spread probability');
  });

  it('shows bounded familiarity and labels sparse-data uncertainty with explanatory tooltips', () => {
    const selected = choice();

    expect(component.matrixExperiencePercentText(selected)).toBe('50%');
    expect(component.isHighCountUncertainty(selected)).toBeTrue();
    expect(component.matrixCountUncertaintyText(selected)).toContain('60%');
    expect(component.experienceTooltip(selected)).toContain('Familiarity is not action quality.');
    expect(component.countUncertaintyTooltip(selected)).toContain('60% uncertainty.');
  });
});