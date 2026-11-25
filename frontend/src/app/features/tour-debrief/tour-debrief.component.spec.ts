import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { StudyCondition, WAL_FOLLOWER, WAL_SINGLE_TRACK } from '../../core/demo/study-conditions';
import { SessionStore } from '../../core/session.store';
import { TourContextService } from '../../core/demo/tour-context.service';
import { briefingById } from '../../core/demo/tour-briefings';
import { TourDebriefComponent } from './tour-debrief.component';

const TWO_LEGS: StudyCondition = {
  id: 'spec-2x',
  layoutId: 'preset-plan-b',
  mode: 'co-learning',
  label: 'Spec',
  surveyParts: ['mode'],
  legs: [WAL_SINGLE_TRACK, WAL_FOLLOWER],
};

/** The Schichtbilanz in an experiment and in a tour (the study leads'
 *  feedback, docs/plans/plan-b-control-group.md D-15, D-18). */
describe('TourDebriefComponent', () => {
  let fixture: ComponentFixture<TourDebriefComponent>;
  let run: ExperimentRunService;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [TourDebriefComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    run = TestBed.inject(ExperimentRunService);
    store = TestBed.inject(SessionStore);
  });

  const render = () => {
    fixture = TestBed.createComponent(TourDebriefComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const text = (el: HTMLElement) => el.textContent!.replace(/\s+/g, ' ');
  const nextLabel = (el: HTMLElement) => (el.querySelector('.db-actions sbb-button')?.textContent ?? '').trim();
  /** A guided condition after its last leg, the shift ended; Plan B's
   *  briefing cuts the debrief to the Schichtbilanz (without its German, which
   *  the spec doesn't load). */
  const afterLastLeg = (c: StudyCondition) => {
    TestBed.inject(TourContextService).set({ ...briefingById('plan-b')!, language: undefined });
    run.start(c, false);
    store.startDemo(c.legs!.map(() => c.mode), false);
    while (!store.demoIsLast()) store.advanceDemo();
    store.endShift();
  };

  it('keeps the way back, the notes and the KPI chips in a tour', () => {
    store.endShift();
    const el = render();
    expect(el.querySelector('.db-link')).withContext('back to the running shift').not.toBeNull();
    expect(el.querySelector('.db-concept')).not.toBeNull();
    expect(el.querySelector('.db-kpis')).not.toBeNull();
    expect(nextLabel(el)).not.toBe('On to the questionnaire');
  });

  it('cuts an experiment with several scenarios to the table and leads on to the questionnaire', () => {
    afterLastLeg(TWO_LEGS);
    const el = render();
    expect(el.querySelector('.db-legs')).withContext('the table over all scenarios').not.toBeNull();
    expect(el.querySelector('.db-link')).withContext('no way back to the shift').toBeNull();
    expect(text(el)).not.toContain('Below, the last scenario in detail.');
    expect(el.querySelector('.db-kpis')).withContext('the last scenario is a row of the table').toBeNull();
    expect(el.querySelector('.db-concept')).toBeNull();
    expect(nextLabel(el)).toBe('On to the questionnaire');
  });

  it('keeps the KPI chips of an experiment with one scenario, which has no table', () => {
    afterLastLeg({ ...TWO_LEGS, legs: [WAL_SINGLE_TRACK] });
    const el = render();
    expect(el.querySelector('.db-legs')).toBeNull();
    expect(el.querySelector('.db-kpis')).not.toBeNull();
    expect(el.querySelector('.db-link')).toBeNull();
    expect(nextLabel(el)).toBe('On to the questionnaire');
  });

  it('lists every scenario\'s decisions with their events and reflections in an experiment', () => {
    afterLastLeg(TWO_LEGS);
    const tour = TestBed.inject(TourContextService);
    const leg = (i: number, decisions: any[]) => ({
      leg: i, sessionId: `s${i}`, played: null, rules: [], ruleApplied: null, legId: TWO_LEGS.legs![i].id, decisions,
    });
    tour.recordShift(leg(0, [{ handle: 0, action: 'hold', simStep: 31, decisionTimeMs: 1, reason: null, reflection: { tradeoff: 'later' },
      events: [{ code: 'train.malfunction', title: 'Malfunction', message: 'Train 1 is malfunctioning (8 steps remaining).', params: { train: 1, steps: 8 } }] }]));
    tour.recordShift(leg(1, []));
    const el = render();
    const rows = [...el.querySelectorAll('app-reflection-overview tbody tr')].map((r) => text(r as HTMLElement).trim());
    expect(rows.length).toBe(2);
    expect(rows[0]).toContain('Step 31');
    expect(rows[0]).toContain('8');
    expect(rows[0]).toContain('later');
    expect(rows[1]).toContain('No interventions');
    expect(el.textContent).not.toContain('Your interventions');
  });

  it('keeps the list of the session\'s interventions in a tour', () => {
    store.endShift();
    const el = render();
    expect(el.querySelector('app-reflection-overview')).toBeNull();
  });

  it('reads a scenario\'s last record, not an aborted attempt before it', () => {
    afterLastLeg(TWO_LEGS);
    const tour = TestBed.inject(TourContextService);
    const leg0 = (sessionId: string, simStep: number) => ({
      leg: 0, sessionId, played: null, rules: [], ruleApplied: null, legId: TWO_LEGS.legs![0].id,
      decisions: [{ handle: 0, action: 'hold', simStep, decisionTimeMs: 1 }],
    });
    tour.recordShift({ ...leg0('aborted', 5), finishReason: 'aborted' });
    tour.recordShift(leg0('resumed', 44));
    const el = render();
    const first = text(el.querySelector('app-reflection-overview tbody tr') as HTMLElement);
    expect(first).toContain('Step 44');
    expect(first).not.toContain('Step 5 ');
  });

  it('names each scenario\'s trains as that scenario did, not as the session open now', () => {
    const legA = { id: 'leg-a', scenarioId: 'leg-a', disturbanceIds: [], seed: 1 };
    const legB = { id: 'leg-b', scenarioId: 'leg-b', disturbanceIds: [], seed: 1 };
    const tour = TestBed.inject(TourContextService);
    tour.scenarioPresets.set([
      { id: 'leg-a', name: 'A', width: 30, height: 30, agents: 2, train_names: ['A-0', 'A-1'] },
      { id: 'leg-b', name: 'B', width: 30, height: 30, agents: 2, train_names: ['B-0', 'B-1'] },
    ]);
    afterLastLeg({ ...TWO_LEGS, legs: [legA, legB] });
    store.session.set({ id: 's1', width: 30, height: 30, num_agents: 2, scenario_preset_id: 'leg-b' } as any);
    tour.recordShift({ leg: 0, sessionId: 's0', played: null, rules: [], ruleApplied: null, legId: 'leg-a',
      decisions: [{ handle: 1, action: 'hold', simStep: 9, decisionTimeMs: 1,
        events: [{ code: 'train.malfunction', title: 'Malfunction', message: 'Train 0 is malfunctioning (3 steps remaining).', params: { train: 0, steps: 3 } }] }] });
    const row = text(render().querySelector('app-reflection-overview tbody tr') as HTMLElement);
    expect(row).toContain('A-1');
    expect(row).toContain('A-0');
    expect(row).not.toContain('B-');
  });

  it('counts no system holds under an experiment\'s overview, whose decision log is only the last scenario\'s', () => {
    afterLastLeg(TWO_LEGS);
    store.decisionLog.set([
      { seq: 1, t: 0, simStep: 3, mode: 'co-learning', handle: 0, accountableOwner: 'system', action: 'hold', aiSuggestion: null, decisionTimeMs: null },
    ]);
    const el = render();
    expect(fixture.componentInstance.systemHolds()).toBe(1);
    expect(el.querySelector('app-reflection-overview')).not.toBeNull();
    expect(text(el)).not.toContain('The system held');
  });
});
