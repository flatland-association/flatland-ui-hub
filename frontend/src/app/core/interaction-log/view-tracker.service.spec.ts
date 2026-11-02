import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ExperimentRunService } from '../demo/experiment-run.service';
import { TourGuideService } from '../demo/tour-guide.service';
import { SessionStore } from '../session.store';
import { InteractionLogService } from './interaction-log.service';
import { AppViewSource, ViewTracker } from './view-tracker.service';

function source() {
  return {
    sessionActive: signal(false),
    tourId: signal<string | null>(null),
    layoutId: signal<string | null>('default'),
    tourOpeningOpen: signal(false),
    demoComplete: signal(false),
    shiftScreenOpen: signal(false),
    debrief: signal(false),
    surveyActive: signal(false),
    helpActive: signal(false),
    settingsMode: signal(false),
    settingsTab: signal('basic'),
    scenarioPolicyMode: signal(false),
    pendingResume: signal(false),
    page: signal<string | null>(null),
  } satisfies AppViewSource;
}

describe('ViewTracker', () => {
  let header: ReturnType<typeof signal<{ sessionId: string } | null>>;
  let noteView: jasmine.Spy;
  let app: ReturnType<typeof source>;
  let tracker: ViewTracker;

  beforeEach(() => {
    header = signal<{ sessionId: string } | null>(null);
    noteView = jasmine.createSpy('noteView');
    TestBed.configureTestingModule({
      providers: [
        { provide: InteractionLogService, useValue: { header, noteView } },
        {
          provide: SessionStore,
          useValue: {
            reflectionRequested: signal(false),
            pendingRationale: signal(null),
            pendingStrategyReflection: signal(null),
            demoActive: signal(false),
            demoIntroPending: signal(false),
            demoStepIndex: signal(0),
            interactionMode: signal('co-learning'),
            showMarey: signal(false),
            showMap: signal(true),
          },
        },
        { provide: ExperimentRunService, useValue: { active: signal(false), phase: signal('idle'), currentLeg: signal(null) } },
        { provide: TourGuideService, useValue: { active: signal(false), current: signal(null) } },
      ],
    });
    tracker = TestBed.inject(ViewTracker);
    app = source();
    tracker.attach(app);
    TestBed.tick();
  });

  const views = () => noteView.calls.allArgs().map(([view]) => view);

  it('logs the start screen, then the session, each once', () => {
    TestBed.tick();
    app.sessionActive.set(true);
    TestBed.tick();
    TestBed.tick();
    expect(views()).toEqual(['start', 'session']);
    expect(noteView.calls.mostRecent().args).toEqual(['session', { centerTab: 'map', layoutId: 'default' }, 'start']);
  });

  it('an overlay takes precedence and the view below is entered again when it closes', () => {
    app.sessionActive.set(true);
    TestBed.tick();
    app.settingsMode.set(true);
    TestBed.tick();
    app.settingsTab.set('advanced');
    TestBed.tick();
    app.settingsMode.set(false);
    TestBed.tick();
    expect(views()).toEqual(['start', 'session', 'settings', 'settings', 'session']);
    expect(noteView.calls.argsFor(3)[1]).toEqual({ tab: 'advanced' });
  });

  it('a new record opens with the screen on display', () => {
    app.sessionActive.set(true);
    TestBed.tick();
    noteView.calls.reset();
    header.set({ sessionId: 's2' });
    TestBed.tick();
    expect(noteView.calls.allArgs()).toEqual([['session', { centerTab: 'map', layoutId: 'default' }, null]]);
  });

  it('a page outside the main app is its own view', () => {
    app.page.set('page:layout-designer');
    TestBed.tick();
    expect(tracker.currentView()).toEqual({ view: 'page:layout-designer' });
  });
});
