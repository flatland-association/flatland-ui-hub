import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from './testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app.component';
import { SessionStore } from './core/session.store';
import { StudyCondition } from './core/demo/study-conditions';
import type { SessionState } from './core/models';

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

  describe('a guided condition on experiment scenarios', () => {
    const leg = (id: string) => ({ id, scenarioId: id, disturbanceIds: [], seed: 1 });
    const CONDITION: StudyCondition = {
      id: 'spec-plan-b',
      layoutId: 'preset-plan-b',
      mode: 'co-learning',
      label: 'Spec Plan B',
      briefingIds: { en: 'colearning-experiment' },
      policy: 'deadlock_avoidance',
      review: false,
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
  });
});
