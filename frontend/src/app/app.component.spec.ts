import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from './testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app.component';
import { PLAY_SPEED_DEFAULT_LEVEL } from './core/play-speed';
import { SessionStore } from './core/session.store';
import { SessionInfo } from './core/models';
import { TourContextService } from './core/demo/tour-context.service';
import { briefingById, TourBriefing } from './core/demo/tour-briefings';

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
      expect(cmp.reflectionPlaceInLayout()).withContext('Zug-Weg tour').toBeFalse();
    });

    it('«Handlungsvergleich» counts only in a tour that asks for reasons', () => {
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
});
