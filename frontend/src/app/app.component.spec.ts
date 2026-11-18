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
import { ReplayService } from './core/replay/replay.service';
import type { SessionRecord } from './core/interaction-log/session-record';
import { UiConfigService } from './core/config/ui-config.service';

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

  it('constructs the translated UC2 layout before rendering and keeps the header toolbar only where the preset asks', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const store = TestBed.inject(SessionStore);
    const layout = component.runtimeLayoutOptions().find(option => option.id === 'preset-uc2-rl');
    expect(layout?.name).toBe('UC2 RL');
    expect(layout?.purpose).toContain('UC2/tutorial');
    expect(component.presetHeaderToolbar()).toBeFalse();
    component.setRuntimeLayout('preset-uc2-rl');
    expect(component.presetHeaderToolbar()).toBeTrue();
    expect(component.panelAvailable('director-directive')).toBeFalse();
    component.setRuntimeLayout(component.systemRuntimeLayoutId);
    // The driver alone decides nothing: the controls come from the preset.
    store.setActivePolicy('uc2_rl');
    expect(component.presetHeaderToolbar()).toBeFalse();
  });

  it('keeps the optional footer survey out of demos without a survey and preserves other runs', () => {
    const component = TestBed.createComponent(AppComponent).componentInstance;
    const store = TestBed.inject(SessionStore);
    store.startDemo(['director'], false);
    expect(component.footerSurveyAllowed()).toBeFalse();
    store.startDemo(['director'], true);
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

  // docs/plans/hide-scenario-bar.md §4.4: Plan B hides the strip, the toolbar stays at the top.
  it('leaves the guide strip out where the condition hides it, and keeps the toolbar at the top', () => {
    const cmp = TestBed.createComponent(AppComponent).componentInstance;
    const store = TestBed.inject(SessionStore);
    store.startDemo(['co-learning'], false);
    TestBed.inject(TourContextService).set(briefingById('colearning-experiment'));
    store.session.set({ id: 'sess-1' } as SessionInfo);
    expect(cmp.guideShown()).toBeTrue();

    TestBed.inject(UiConfigService).apply({ hidden: ['control.guide'] });
    expect(cmp.tourGuide.active()).withContext('the guide still ticks').toBeTrue();
    expect(cmp.guideShown()).toBeFalse();
    expect(cmp.toolbarUnderGuide()).toBeFalse();
  });

  // docs/plans/hide-scenario-bar.md §4.5 (F-2, PAT-2): an older Plan B record replays with
  // the guide strip and the names, as the participant saw them.
  it('replays a run with the UI restrictions it was recorded with', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const replay = TestBed.inject(ReplayService);
    const uiConfig = TestBed.inject(UiConfigService);
    const record = (uiRestrictions?: object) =>
      ({
        schema: 'flatland-session-record',
        version: 3,
        header: {
          sessionId: 's1', startedAt: 1000, endedAt: 1500, mode: 'co-learning', layoutId: 'preset-plan-b', scenarioId: 'wal',
          disturbanceIds: [], grid: { width: 3, height: 2, numAgents: 1 }, conditionId: 'plan-b-p01', legId: 'tutorial',
          ...(uiRestrictions ? { uiRestrictions } : {}),
        },
        decisions: [], context: [], surveys: [], learning: [],
        states: [{ seq: 1, t: 1100, simStep: 0, maxSteps: 10, episodeDone: false, agents: [], map: { width: 3, height: 2, rail_grid: [[0]], rail_tiles: [], decision_cells: [] } }],
      }) as unknown as SessionRecord;

    // Recorded before Plan B hid the guide and the names.
    expect(replay.load([record({ hidden: ['control.mapNavigation'], collapsedByDefault: [], policyAllowlist: ['deadlock_avoidance'], values: {} })])).toBeTrue();
    fixture.detectChanges();
    // The legacy id stands for pan arrows and zoom (plan-b-small-changes.md, item 2).
    expect(uiConfig.isHidden('control.mapPan')).toBeTrue();
    expect(uiConfig.isHidden('control.mapZoom')).toBeTrue();
    expect(uiConfig.isHidden('control.guide')).toBeFalse();
    expect(uiConfig.isHidden('control.legNames')).toBeFalse();

    // A record without them gets the layout's block of today, as before.
    replay.load([record()]);
    fixture.detectChanges();
    expect(uiConfig.isHidden('control.guide')).toBeTrue();
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

    // docs/plans/confirm-finish-scenario.md §4.3 (#180).
    describe('the finish dialog', () => {
      let dialog: { open: jasmine.Spy; close: jasmine.Spy };
      let pause: jasmine.Spy;
      let play: jasmine.Spy;
      const close = (result?: string) => app.onFinishConfirmClose(Object.assign(new Event('close'), { result }));

      beforeEach(() => {
        dialog = { open: jasmine.createSpy('open'), close: jasmine.createSpy('close') };
        app.finishConfirmDialog = () => ({ nativeElement: dialog });
        store.session.set({ id: 's1', width: 1, height: 1, num_agents: 0 } as any);
        pause = spyOn(store, 'pause').and.callFake(() => store.playing.set(false));
        play = spyOn(store, 'play');
        store.playing.set(true);
      });

      it('asks instead of finishing, and pauses meanwhile', () => {
        app.finishDemoMode();
        expect(dialog.open).toHaveBeenCalled();
        expect(pause).toHaveBeenCalled();
        expect(app.tourContext.shiftHistory().length).toBe(0);
      });

      it('"Zurück" goes on playing, counted; "Ja" finishes the leg as a click', () => {
        app.finishDemoMode();
        close();
        expect(play).toHaveBeenCalledTimes(1);
        expect(app.tourContext.shiftHistory().length).toBe(0);
        app.finishDemoMode();
        close('confirm');
        expect(play).withContext('a finished leg does not play on').toHaveBeenCalledTimes(1);
        expect(app.store.demoStepIndex()).toBe(1);
        const leg = app.tourContext.shiftHistory()[0];
        expect(leg.finishReason).toBe('clicked');
        expect(leg.finishConfirm).toEqual({ confirmed: true, backs: 1 });
      });

      it('closes without an answer when the leg ends under it', () => {
        app.finishDemoMode();
        // A step under way while the pause is pending ends the episode: the run moves on.
        app.experimentRun.setPhase('legSurvey');
        fixture.detectChanges();
        expect(dialog.close).toHaveBeenCalled();
        expect(app.finishConfirmOpen()).toBeFalse();
        // Lyne's close event, or a late "Ja", answers nothing.
        close('confirm');
        expect(app.tourContext.shiftHistory().length).toBe(0);
        expect(play).not.toHaveBeenCalled();
      });

      it('closes when a new session starts under it', () => {
        app.finishDemoMode();
        store.session.set({ id: 's2', width: 1, height: 1, num_agents: 0 } as any);
        fixture.detectChanges();
        expect(dialog.close).toHaveBeenCalled();
        close();
        app.experimentRun.finishLeg('clicked');
        expect(app.tourContext.shiftHistory()[0].finishConfirm?.backs).withContext('no back counted').toBe(0);
      });

      it('keeps the selected train when Escape closes it', async () => {
        store.selectedHandle.set(3);
        app.finishDemoMode();
        const esc = new KeyboardEvent('keydown', { key: 'Escape' });
        app.onEscapeDeselectAgent(esc);
        expect(store.selectedHandle()).toBe(3);
        // Without an animation Lyne's close comes first: the same keydown keeps it too.
        close();
        app.onEscapeDeselectAgent(esc);
        expect(store.selectedHandle()).toBe(3);
        await new Promise((r) => setTimeout(r));
        app.onEscapeDeselectAgent(esc);
        expect(store.selectedHandle()).withContext('a later Escape deselects as before').toBeNull();
      });

      it('does not resume what was paused before', () => {
        store.playing.set(false);
        app.finishDemoMode();
        close();
        expect(play).not.toHaveBeenCalled();
      });

      it('finishes at once where the condition turns it off', () => {
        app.experimentRun.start({ ...CONDITION, finishConfirm: false }, false);
        app.finishDemoMode();
        expect(dialog.open).not.toHaveBeenCalled();
        expect(app.store.demoStepIndex()).toBe(1);
        expect(app.tourContext.shiftHistory()[0].finishConfirm).toBeUndefined();
      });

      it('does not ask for "Weiter zum Fragebogen", which ends nothing', () => {
        app.experimentRun.setPhase('legSurvey');
        spyOn(app, 'openExperimentSurvey');
        app.finishDemoMode();
        expect(dialog.open).not.toHaveBeenCalled();
      });

      it('does not ask on the Schichtabschluss screen: the debrief\'s shift is over', () => {
        app.experimentRun.clearPersisted();
        app.experimentRun.condition.set(null);
        app.shiftScreenOpen = () => true;
        store.demoSurveyEnabled.set(true);
        const survey = spyOn(app, 'openSurvey');
        app.finishDemoMode();
        expect(dialog.open).not.toHaveBeenCalled();
        expect(survey).toHaveBeenCalled();
      });

      it('asks in a tour too, and "Ja" goes on as before', () => {
        app.experimentRun.clearPersisted();
        app.experimentRun.condition.set(null);
        expect(app.experimentRun.active()).toBeFalse();
        store.demoSurveyEnabled.set(true);
        const survey = spyOn(app, 'openSurvey');
        app.finishDemoMode();
        expect(dialog.open).toHaveBeenCalled();
        expect(survey).not.toHaveBeenCalled();
        close('confirm');
        expect(survey).toHaveBeenCalled();
        expect(play).withContext('the tour played on before the dialog').toHaveBeenCalled();
      });
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
