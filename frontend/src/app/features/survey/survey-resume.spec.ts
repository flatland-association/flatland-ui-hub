import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { StudyCondition } from '../../core/demo/study-conditions';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { PLAN_B_FINAL_PART } from '../../core/survey/survey-configs';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { SurveyComponent } from './survey.component';

/** A guided run's questionnaire survives a resume, which opens it on a fresh
 *  session (finding 18 of docs/plans/experiment-scenario-import.md). */
describe('SurveyComponent — a guided run resumed in its questionnaire', () => {
  const CONDITION: StudyCondition = {
    id: 'spec-run',
    layoutId: 'preset-plan-b',
    mode: 'co-learning',
    label: 'Spec',
    surveyParts: ['plan-b-final'],
    legs: [{ id: 'l', scenarioId: 's', disturbanceIds: [], seed: 1 }],
  };
  let store: SessionStore;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [SurveyComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    TestBed.inject(ExperimentRunService).start(CONDITION, false);
  });
  afterEach(() => localStorage.clear());

  const open = () => {
    const fixture = TestBed.createComponent(SurveyComponent);
    fixture.componentRef.setInput('parts', [PLAN_B_FINAL_PART]);
    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();
    return fixture.componentInstance;
  };

  it('keeps answers typed before the session exists, and gives them to the session', () => {
    open().setAnswer('pb_1', 3);
    store.session.set({ id: 'sess-a' } as SessionInfo);
    const reopened = open();
    expect(reopened.answers()['pb_1']).toBe(3);
    expect(JSON.parse(localStorage.getItem('flatland_survey_sess-a_' + reopened.config().id)!)['pb_1']).toBe(3);
  });

  it('opens a half-filled questionnaire again on the fresh session of a resume', () => {
    store.session.set({ id: 'sess-a' } as SessionInfo);
    open().setAnswer('pb_1', 5);
    store.session.set({ id: 'sess-b' } as SessionInfo); // the resume's fresh session
    expect(open().answers()['pb_1']).toBe(5);
  });
});
