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

/** The Schichtbilanz in an experiment and in a tour (#209's feedback,
 *  docs/plans/plan-b-control-group.md D-15, D-18). */
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
});
