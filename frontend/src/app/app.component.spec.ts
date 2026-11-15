import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from './testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app.component';
import { PLAY_SPEED_DEFAULT_LEVEL } from './core/play-speed';
import { SessionStore } from './core/session.store';
import { SessionInfo, SessionState } from './core/models';
import { TourContextService } from './core/demo/tour-context.service';
import { briefingById, TourBriefing } from './core/demo/tour-briefings';
import { StudyCondition } from './core/demo/study-conditions';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        ...provideTranslocoTesting(), provideHttpClient()],
    }).compileComponents();
  });

  it('should create the dispatcher app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('constructs the translated UC2 layout before rendering and bypasses Director planning only for direct actors', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const store = TestBed.inject(SessionStore);
    const layout = component.runtimeLayoutOptions().find(option => option.id === 'preset-uc2-rl');
    expect(layout?.name).toBe('UC2 RL');
    expect(layout?.purpose).toContain('UC2/tutorial');
    expect(component.directDriverControls()).toBeFalse();
    component.selectedRuntimeLayoutId.set('preset-uc2-rl');
    expect(component.directDriverControls()).toBeTrue();
    component.selectedRuntimeLayoutId.set(component.systemRuntimeLayoutId);
    store.setActivePolicy('uc2_rl');
    expect(component.directDriverControls()).toBeTrue();
    store.setActivePolicy('deadlock_avoidance');
    expect(component.directDriverControls()).toBeFalse();
  });

  it('keeps the optional footer survey out of no-survey actor demos and preserves other runs', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const store = TestBed.inject(SessionStore);
    store.startDemo(['director'], false);
    component.selectedRuntimeLayoutId.set('preset-uc2-rl');
    expect(component.footerSurveyAllowed()).toBeFalse();
    component.selectedRuntimeLayoutId.set(component.systemRuntimeLayoutId);
    store.setActivePolicy('pf_ch_rl');
    expect(component.footerSurveyAllowed()).toBeFalse();
    store.startDemo(['director'], true);
    expect(component.footerSurveyAllowed()).toBeTrue();
    store.startDemo(['director'], false);
    store.setActivePolicy('deadlock_avoidance');
    expect(component.footerSurveyAllowed()).toBeTrue();
    store.stopDemo();
    expect(component.footerSurveyAllowed()).toBeTrue();
  });

  it('should render the Flatland Dispatcher shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Flatland Dispatcher');
  });

  // docs/plans/toolbar-under-guide.md D8.
  it('starts every guided leg at its own tempo, else at the default', () => {
    const cmp = TestBed.createComponent(AppComponent).componentInstance as unknown as {
      legSessionOpts(opts: object, leg: object): { playSpeedLevel?: number };
    };
    const leg = { id: 'l', nameKey: 'k', scenarioId: 's', disturbanceIds: [], seed: 1 };
    expect(cmp.legSessionOpts({}, leg).playSpeedLevel).toBe(PLAY_SPEED_DEFAULT_LEVEL);
    expect(cmp.legSessionOpts({}, { ...leg, playSpeedLevel: 4 }).playSpeedLevel).toBe(4);
  });

  // Where the toolbar renders (docs/plans/toolbar-under-guide.md D5, F5).
  it('puts the toolbar under the guide only with a guide and a session', () => {
    const cmp = TestBed.createComponent(AppComponent).componentInstance;
    const store = TestBed.inject(SessionStore);
    expect(cmp.toolbarUnderGuide()).toBeFalse();

    store.startDemo(['co-learning'], false);
    TestBed.inject(TourContextService).set(briefingById('colearning-experiment'));
    expect(cmp.guideShown()).toBeTrue();
    expect(cmp.toolbarUnderGuide()).withContext('no session yet').toBeFalse();

    store.session.set({ id: 'sess-1' } as SessionInfo);
    expect(cmp.toolbarUnderGuide()).toBeTrue();
  });

  // docs/plans/reflection-inline.md §4.4 (D6, D13): the toolbar's finish waits for every reflection.
  describe('finishing with open reflections', () => {
    const start = () => {
      const cmp = TestBed.createComponent(AppComponent).componentInstance;
      const store = TestBed.inject(SessionStore);
      store.startDemo(['co-learning'], true); // with the survey after the leg
      TestBed.inject(TourContextService).set(briefingById('colearning-experiment'));
      store.session.set({ id: 'sess-1' } as SessionInfo);
      store.interactionMode.set('co-learning');
      store.queueReflections.set(true);
      const survey = spyOn(cmp, 'openSurvey');
      store.recordProposalChoice(0, 'proceed');
      return { cmp, store, survey };
    };

    it('is refused while one is open, with the count for the message', () => {
      const { cmp, store, survey } = start();
      cmp.finishDemoMode();
      expect(survey).not.toHaveBeenCalled();
      expect(store.reflectionsMissing()).toBe(1);
    });

    it('goes on once every reflection is answered', () => {
      const { cmp, store, survey } = start();
      store.submitRationale({ rationale: '', response: 'no' });
      cmp.finishDemoMode();
      expect(survey).toHaveBeenCalled();
    });
  });

  // docs/plans/reflection-inline.md §4.7 (S7, D14). The effect only feeds
  // `reflectionPauses()` into `syncReflectionPause`; rendering the whole app
  // here would run every other effect too, so the spec calls both directly.
  describe('pause for a reflection', () => {
    type Cmp = { reflectionPauses(): boolean; syncReflectionPause(shown: boolean): void };
    let cmp: Cmp;
    let store: SessionStore;
    let pause: jasmine.Spy;
    let play: jasmine.Spy;

    const start = (briefing: Partial<TourBriefing>) => {
      cmp = TestBed.createComponent(AppComponent).componentInstance as unknown as Cmp;
      store = TestBed.inject(SessionStore);
      store.startDemo(['co-learning'], false);
      TestBed.inject(TourContextService).set({ ...briefingById('colearning-experiment')!, ...briefing });
      store.session.set({ id: 'sess-1' } as SessionInfo);
      store.interactionMode.set('co-learning');
      store.queueReflections.set(true); // `_queueReflections`, which does not run here either
      store.playing.set(true);
      pause = spyOn(store, 'pause').and.callFake(() => store.playing.set(false));
      play = spyOn(store, 'play');
    };
    // What the effect does on every change.
    const sync = () => cmp.syncReflectionPause(cmp.reflectionPauses());
    const decide = (handle: number) => {
      store.recordProposalChoice(handle, 'proceed');
      sync();
    };

    it('pauses while a reflection is shown and plays on once none is', () => {
      start({ pauseOnReflection: true });
      decide(0);
      decide(1);
      expect(pause).toHaveBeenCalledTimes(1);
      store.submitRationale({ rationale: 'x', response: 'yes' });
      sync();
      expect(play).withContext('the second one is shown now').not.toHaveBeenCalled();
      store.dismissRationale();
      sync();
      expect(play).toHaveBeenCalledTimes(1);
    });

    it('does not play on when the run was not playing, or the shift is over', () => {
      start({ pauseOnReflection: true });
      store.playing.set(false);
      decide(0);
      store.dismissRationale();
      sync();
      expect(pause).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();

      store.playing.set(true);
      decide(1);
      store.shiftEnded.set(true);
      store.dismissRationale();
      sync();
      expect(pause).toHaveBeenCalledTimes(1);
      expect(play).not.toHaveBeenCalled();
    });

    it('does not pause without the flag, without reasonDialog, or in Director', () => {
      start({});
      store.recordProposalChoice(0, 'proceed');
      expect(cmp.reflectionPauses()).withContext('no flag').toBeFalse();

      TestBed.inject(TourContextService).set({ ...briefingById('colearning-experiment')!, reasonDialog: false, pauseOnReflection: true });
      expect(cmp.reflectionPauses()).withContext('no reasonDialog').toBeFalse();

      TestBed.inject(TourContextService).set({ ...briefingById('colearning-experiment')!, pauseOnReflection: true });
      expect(cmp.reflectionPauses()).withContext('the flag, shown').toBeTrue();
      store.interactionMode.set('director');
      expect(cmp.reflectionPauses()).withContext('Director').toBeFalse();
    });
  });

  // docs/plans/reflection-inline.md D16: a panel in the layout, expanded or collapsed.
  describe('place for a "why?" in the layout', () => {
    type Cmp = { reflectionPlaceInLayout(): boolean; setRuntimeLayout(id: string): void; refreshRuntimeLayouts(): void };
    const make = () => {
      const cmp = TestBed.createComponent(AppComponent).componentInstance as unknown as Cmp;
      cmp.refreshRuntimeLayouts();
      return cmp;
    };

    it('the system layout has the mode\'s own panel', () => {
      const cmp = make();
      const store = TestBed.inject(SessionStore);
      store.interactionMode.set('recommendation');
      expect(cmp.reflectionPlaceInLayout()).toBeTrue();
      store.interactionMode.set('co-learning');
      expect(cmp.reflectionPlaceInLayout()).toBeTrue();
    });

    it('a preset has one only where it names one', () => {
      const cmp = make();
      TestBed.inject(SessionStore).interactionMode.set('recommendation');
      cmp.setRuntimeLayout('preset-recommendation-study2');
      expect(cmp.reflectionPlaceInLayout()).withContext('recommendations panel').toBeTrue();
      cmp.setRuntimeLayout('preset-recommendation-study3');
      expect(cmp.reflectionPlaceInLayout()).withContext('no panel for it').toBeFalse();
      cmp.setRuntimeLayout('preset-olten-zug-weg');
      expect(cmp.reflectionPlaceInLayout()).withContext('ZWL tour').toBeFalse();
    });

    it('the decision log counts only in a tour that asks for reasons', () => {
      const cmp = make();
      const store = TestBed.inject(SessionStore);
      store.interactionMode.set('co-learning');
      cmp.setRuntimeLayout('preset-plan-b');
      expect(cmp.reflectionPlaceInLayout()).withContext('no tour').toBeFalse();
      store.startDemo(['co-learning'], false);
      TestBed.inject(TourContextService).set(briefingById('colearning-experiment'));
      expect(cmp.reflectionPlaceInLayout()).withContext('reason tour').toBeTrue();
    });
  });

  describe('a guided condition on experiment scenarios', () => {
    const leg = (id: string) => ({ id, scenarioId: id, disturbanceIds: [], seed: 1 });
    const CONDITION: StudyCondition = {
      id: 'spec-plan-b',
      layoutId: 'preset-plan-b',
      mode: 'co-learning',
      label: 'Spec Plan B',
      briefingIds: { en: 'colearning-experiment' },
      policy: 'deadlock_avoidance',
      shiftSummary: false,
      surveyParts: ['mode'],
      legs: [leg('scenario-a'), leg('scenario-b')],
    };

    let fixture: ReturnType<typeof TestBed.createComponent<AppComponent>>;
    let app: any;
    let store: SessionStore;
    let created: any[];

    beforeEach(() => {
      fixture = TestBed.createComponent(AppComponent);
      app = fixture.componentInstance;
      store = TestBed.inject(SessionStore);
      created = [];
      spyOn(app, 'createSession').and.callFake((opts: unknown) => created.push(opts));
      spyOn(app, 'resolveWelcomeSessionOpts').and.returnValue({ scenarioPresetId: 'x', policyControlIds: ['plan'] });
      app.activeExperiment.set(CONDITION);
      app.experimentRun.start(CONDITION, false);
      store.startDemo(CONDITION.legs!.map(() => CONDITION.mode), false);
    });

    it('pins the condition policy at a leg start and enables it on the session', () => {
      store.setActivePolicy('shortest_path' as any);
      app.startConditionLeg();
      expect(store.activePolicy()).toBe('deadlock_avoidance');
      expect(created[0].policyControlIds).toEqual(['deadlock_avoidance', 'plan']);
    });

    it('goes from the last leg straight to the final questionnaire', () => {
      store.advanceDemo();
      app.advanceExperiment('clicked');
      expect(app.experimentRun.phase()).toBe('finalSurvey');
      expect(app.surveyActive()).toBeTrue();
    });

    it('advances a leg when its episode ends, once per session', () => {
      store.session.set({ id: 's1', width: 1, height: 1, num_agents: 0 } as any);
      store.dismissDemoIntro();
      store.state.set({ episode_done: true } as SessionState);
      fixture.detectChanges();
      expect(app.store.demoStepIndex()).toBe(1);
      expect(app.tourContext.shiftHistory()[0].finishReason).toBe('episodeEnd');
      expect(created.length).toBe(1);
      // The next leg's session opens with the old, finished state still shown: no second advance.
      store.state.set({ episode_done: true, elapsed_steps: 1 } as SessionState);
      fixture.detectChanges();
      expect(app.store.demoStepIndex()).toBe(1);
    });

    it('waits for a pending rationale before a leg ends with its episode', () => {
      store.session.set({ id: 's1', width: 1, height: 1, num_agents: 0 } as any);
      store.dismissDemoIntro();
      store.interactionMode.set('co-learning');
      store.recordProposalChoice(0, 'proceed');
      expect(store.pendingRationale()).withContext('the decision asks why').not.toBeNull();
      store.state.set({ episode_done: true } as SessionState);
      fixture.detectChanges();
      expect(app.store.demoStepIndex()).withContext('rationale still asked for').toBe(0);
      store.dismissRationale(); // no tour asks again: the reflection goes
      fixture.detectChanges();
      expect(app.store.demoStepIndex()).toBe(1);
      expect(app.tourContext.shiftHistory()[0].finishReason).toBe('episodeEnd');
    });

        it('in a tour that asks for reasons, ends the leg only once every open reflection is answered', () => {
      store.session.set({ id: 's1', width: 1, height: 1, num_agents: 0 } as any);
      store.dismissDemoIntro();
      app.tourContext.set(briefingById('colearning-experiment'));
      store.interactionMode.set('co-learning');
      store.queueReflections.set(true);
      store.recordProposalChoice(0, 'proceed');
      store.dismissRationale(); // closed unanswered: still open
      store.state.set({ episode_done: true } as SessionState);
      fixture.detectChanges();
      expect(app.store.demoStepIndex()).withContext('a reflection is still open').toBe(0);
      expect(store.reflectionsMissing()).withContext('the finish message shows').toBe(1);
      store.reopenRationale();
      store.submitRationale({ rationale: '', response: 'no' });
      fixture.detectChanges();
      expect(app.store.demoStepIndex()).toBe(1);
    });

        it('does not start when the backend does not offer a leg scenario, and says which', () => {
      const preset = (id: string) => ({ id, name: id, width: 1, height: 1, agents: 0 });
      app.scenarioPresets.set([preset('scenario-a')]);
      app.startGuidedCondition(CONDITION);
      expect(created.length).toBe(0);
      expect(app.missingExperimentScenario()).toBe('scenario-b');

      app.scenarioPresets.set([preset('scenario-a'), preset('scenario-b')]);
      app.startGuidedCondition(CONDITION);
      expect(created.length).toBe(1);
      expect(app.missingExperimentScenario()).toBeNull();
    });
  });
});
