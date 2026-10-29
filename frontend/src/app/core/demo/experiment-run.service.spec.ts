import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { SessionStore } from '../session.store';
import { InteractionLogService } from '../interaction-log/interaction-log.service';
import { ExperimentRunRecord } from '../interaction-log/experiment-run-record';
import { EXPERIMENT_RUN_STORAGE_KEY, ExperimentRunService } from './experiment-run.service';
import { StudyCondition, WAL_FOLLOWER, WAL_SINGLE_TRACK } from './study-conditions';
import { TourContextService } from './tour-context.service';

const TWO_LEGS: StudyCondition = {
  id: 'spec-2x',
  layoutId: 'preset-colearning-interview',
  mode: 'co-learning',
  label: 'Spec experiment',
  briefingIds: { en: 'colearning-experiment' },
  legSurveyParts: ['nasa-tlx'],
  surveyParts: ['mode'],
  legs: [WAL_SINGLE_TRACK, WAL_FOLLOWER],
};

const ONE_LEG: StudyCondition = { ...TWO_LEGS, id: 'spec-1x', legSurveyParts: undefined, legs: [WAL_SINGLE_TRACK] };

const SUBMITTED = { surveyId: 'post-session', answers: { q1: 3 }, scores: {}, submittedAt: '2026-10-28T10:00:00.000Z' };

/** The run with its legs as demo entries, as AppComponent starts it. */
function begin(run: ExperimentRunService, store: SessionStore, c: StudyCondition, withBriefing = false): void {
  run.start(c, withBriefing);
  store.startDemo(c.legs!.map(() => c.mode), false);
}

describe('ExperimentRunService', () => {
  let run: ExperimentRunService;
  let store: SessionStore;
  let tour: TourContextService;
  let log: InteractionLogService;

  beforeEach(() => {
    localStorage.removeItem(EXPERIMENT_RUN_STORAGE_KEY);
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    run = TestBed.inject(ExperimentRunService);
    store = TestBed.inject(SessionStore);
    tour = TestBed.inject(TourContextService);
    log = TestBed.inject(InteractionLogService);
    spyOn(log, 'downloadRunRecord');
  });

  afterEach(() => localStorage.removeItem(EXPERIMENT_RUN_STORAGE_KEY));

  it('starts with the briefing when the briefing has an opening page, else with the first leg', () => {
    begin(run, store, TWO_LEGS, true);
    expect(run.phase()).toBe('briefing');
    run.briefingDone();
    expect(run.phase()).toBe('running');

    begin(run, store, TWO_LEGS, false);
    expect(run.phase()).toBe('running');
  });

  it('counts legs with the store: index, the current leg, and how many are left', () => {
    begin(run, store, TWO_LEGS);
    expect(run.legIndex()).toBe(0);
    expect(run.currentLeg()).toBe(WAL_SINGLE_TRACK);
    expect(run.legsLeft()).toBe(1);
    expect(run.isLast()).toBeFalse();
    expect(run.multiLeg()).toBeTrue();
    store.advanceDemo();
    expect(run.currentLeg()).toBe(WAL_FOLLOWER);
    expect(run.legsLeft()).toBe(0);
    expect(run.isLast()).toBeTrue();
  });

  it('labels a leg by its name and position', () => {
    begin(run, store, TWO_LEGS);
    expect(run.legLabel(1)).toBe('Walensee follower (2/2)');
    expect(run.currentLegLabel()).toBe(run.legLabel(0));
  });

  it('asks the leg questionnaire after each leg, the final one after the review', () => {
    begin(run, store, TWO_LEGS);
    expect(run.surveyParts()).toEqual(['mode']);
    run.setPhase('legSurvey');
    expect(run.surveyParts()).toEqual(['nasa-tlx']);
    expect(run.questionnaireDone()).toBeFalse();
    run.completeQuestionnaire(SUBMITTED);
    expect(run.questionnaireDone()).toBeTrue();
    run.setPhase('finalSurvey');
    expect(run.questionnaireDone()).toBeFalse();
    run.completeQuestionnaire(SUBMITTED);
    expect(run.questionnaireDone()).toBeTrue();
  });

  it('shows the guide strip with several legs only while a leg runs, with one leg throughout', () => {
    begin(run, store, TWO_LEGS, true);
    expect(run.guideVisible()).toBeFalse();
    run.briefingDone();
    expect(run.guideVisible()).toBeTrue();
    for (const phase of ['legSurvey', 'review', 'finalSurvey', 'done'] as const) {
      run.setPhase(phase);
      expect(run.guideVisible()).withContext(phase).toBeFalse();
    }

    begin(run, store, ONE_LEG);
    run.setPhase('review');
    expect(run.guideVisible()).toBeTrue();
  });

  it('records a finished leg once, with its id, KPIs and reason', () => {
    begin(run, store, TWO_LEGS);
    run.finishLeg('clicked');
    run.finishLeg('clicked');
    const history = tour.shiftHistory();
    expect(history.length).toBe(1);
    expect(history[0].legId).toBe(WAL_SINGLE_TRACK.id);
    expect(history[0].leg).toBe(0);
    expect(history[0].finishReason).toBe('clicked');
    expect(history[0].kpis).toEqual({ total: 0, arrived: 0, delayed: 0, malfunctions: 0, totalDelay: 0 });
  });

  it('names where the finish button leads', () => {
    begin(run, store, ONE_LEG);
    expect(run.finishLabel()).toBe('Finish scenario → shift summary');
    run.setPhase('review');
    expect(run.finishLabel()).toBe('On to the questionnaire');

    begin(run, store, TWO_LEGS);
    expect(run.finishLabel()).toBe('Finish scenario → questionnaire');
  });

  it('keeps the run in localStorage until it is finished', () => {
    begin(run, store, TWO_LEGS);
    store.advanceDemo();
    run.legStarted();
    const state = run.readPersisted()!;
    expect(state.conditionId).toBe('spec-2x');
    expect(state.legIndex).toBe(1);
    expect(state.experimentRunId).toBe(run.experimentRunId()!);
  });

  it('resumes at the leg it broke off in and logs the break', () => {
    begin(run, store, TWO_LEGS);
    run.setPhase('legSurvey');
    const state = run.readPersisted()!;
    run.reset();
    run.resume(TWO_LEGS, state);
    expect(run.experimentRunId()).toBe(state.experimentRunId);
    expect(run.phase()).toBe('legSurvey');
    expect(run.readPersisted()!.resumedAt.length).toBe(1);
  });

  it('saves one record at the end, then shows the thank-you page', () => {
    begin(run, store, ONE_LEG);
    run.finishLeg('clicked');
    run.setPhase('finalSurvey');
    run.completeQuestionnaire(SUBMITTED);
    run.finish('completed');
    expect(run.phase()).toBe('done');
    expect(run.readPersisted()).toBeNull();
    const [fileName, record] = (log.downloadRunRecord as jasmine.Spy).calls.mostRecent().args as [string, ExperimentRunRecord];
    expect(fileName).toMatch(/^flatland-spec-1x-run-/);
    expect(record.status).toBe('completed');
    expect(record.conditionId).toBe('spec-1x');
    expect(record.legs.map((l) => l.legId)).toEqual([WAL_SINGLE_TRACK.id]);
    expect(record.questionnaires.map((q) => q.afterLegId)).toEqual([null]);
  });

  it('an abort saves what there is, the current leg marked aborted', () => {
    begin(run, store, TWO_LEGS);
    run.abort();
    expect(run.active()).toBeFalse();
    const record = (log.downloadRunRecord as jasmine.Spy).calls.mostRecent().args[1] as ExperimentRunRecord;
    expect(record.status).toBe('aborted');
    expect(record.legs.length).toBe(0); // no session: nothing was played yet
  });
});
