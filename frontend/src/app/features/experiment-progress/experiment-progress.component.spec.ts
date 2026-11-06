import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { StudyCondition, WAL_FOLLOWER, WAL_SINGLE_TRACK } from '../../core/demo/study-conditions';
import { SessionStore } from '../../core/session.store';
import { ReplayService } from '../../core/replay/replay.service';
import type { SessionRecord } from '../../core/interaction-log/session-record';
import { ExperimentProgressComponent } from './experiment-progress.component';

const TWO_LEGS: StudyCondition = {
  id: 'spec-2x',
  layoutId: 'preset-plan-b',
  mode: 'co-learning',
  label: 'Spec',
  surveyParts: ['mode'],
  legs: [WAL_SINGLE_TRACK, WAL_FOLLOWER],
};

/** The stepper with and without the Schichtbilanz (#174, docs/plans/remove-shift-summary.md §4.2). */
describe('ExperimentProgressComponent', () => {
  let fixture: ComponentFixture<ExperimentProgressComponent>;
  let run: ExperimentRunService;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ExperimentProgressComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    run = TestBed.inject(ExperimentRunService);
    store = TestBed.inject(SessionStore);
    fixture = TestBed.createComponent(ExperimentProgressComponent);
  });

  const steps = () => {
    fixture.detectChanges();
    return [...fixture.nativeElement.querySelectorAll('.xp__step')].map((e: Element) => e.textContent!.trim());
  };
  const left = () => (fixture.nativeElement.querySelector('.xp__left')?.textContent ?? '').trim();
  const begin = (c: StudyCondition) => {
    run.start(c, false);
    store.startDemo(c.legs!.map(() => c.mode), false);
  };

  it('has a Schichtbilanz step and names it in the count when the condition has one', () => {
    begin(TWO_LEGS);
    expect(steps()).toContain('Shift summary');
    expect(left()).toContain('shift summary');
  });

  it('has neither without it, and the last leg leads to the questionnaire', () => {
    begin({ ...TWO_LEGS, shiftSummary: false });
    const s = steps();
    expect(s).not.toContain('Shift summary');
    expect(s.slice(-2)).toEqual(['Questionnaire', 'End']);
    expect(left()).not.toContain('shift summary');
  });

  it('in a replay, follows the recording: an old record has the step, a new one has not', () => {
    const replay = TestBed.inject(ReplayService);
    const record = (shiftSummary?: boolean) =>
      ({
        schema: 'flatland-session-record',
        version: 3,
        header: {
          sessionId: 's1', startedAt: 1000, endedAt: 1500, mode: 'co-learning', layoutId: null, scenarioId: 'wal',
          disturbanceIds: [], grid: { width: 3, height: 2, numAgents: 1 }, conditionId: 'plan-b-p01', legId: 'wal-single-track',
          ...(shiftSummary === undefined ? {} : { shiftSummary }),
        },
        decisions: [], context: [], surveys: [], learning: [],
        states: [{ seq: 1, t: 1100, simStep: 0, maxSteps: 10, episodeDone: false, agents: [], map: { width: 3, height: 2, rail_grid: [[0]], rail_tiles: [], decision_cells: [] } }],
      }) as unknown as SessionRecord;
    expect(replay.load([record()])).toBeTrue();
    expect(steps()).toContain('Shift summary');
    replay.load([record(false)]);
    expect(steps()).not.toContain('Shift summary');
  });
});
