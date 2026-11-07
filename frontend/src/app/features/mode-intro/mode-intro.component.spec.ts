import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { TourContextService } from '../../core/demo/tour-context.service';
import { InteractionMode } from '../../core/events/event-types';
import { LanguageService } from '../../core/i18n/language.service';
import { SessionStore } from '../../core/session.store';
import { ModeIntroComponent } from './mode-intro.component';

describe('ModeIntroComponent startup readiness', () => {
  const makeStore = () => ({
    session: signal<{ id: string } | null>({ id: 'previous-session' }),
    sessionCreating: signal(false),
    sessionOpening: signal(false),
    loading: signal(false),
    backendBusy: signal(false),
    dispatcherControlPending: signal<'play' | 'pause' | 'ownership' | 'stop' | 'decision' | null>(null),
    playing: signal(false),
    interactionMode: signal<InteractionMode>('recommendation'),
    demoSequence: signal<InteractionMode[]>(['recommendation']),
    demoStepIndex: signal(0),
    activePolicy: signal('deadlock_avoidance'),
    defaultPolicy: signal('shortest_path'),
    playSpeed: signal(3),
    dismissDemoIntro: jasmine.createSpy('dismissDemoIntro'),
    play: jasmine.createSpy('play'),
    stopDemo: jasmine.createSpy('stopDemo'),
  });
  let store: ReturnType<typeof makeStore>;
  let autoStart: ReturnType<typeof signal<boolean>>;
  let fixture: ComponentFixture<ModeIntroComponent>;
  const startButton = () => fixture.nativeElement.querySelector('[data-testid="mode-intro-start"]') as HTMLElement;
  const expectBlocked = () => {
    fixture.detectChanges();
    expect(startButton().hasAttribute('disabled')).toBeTrue();
    // The method must protect against a direct or already queued click too.
    fixture.componentInstance.startScenario();
    expect(store.dismissDemoIntro).not.toHaveBeenCalled();
    expect(store.play).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    store = makeStore();
    autoStart = signal(true);
    TestBed.configureTestingModule({
      imports: [ModeIntroComponent],
      providers: [
        { provide: SessionStore, useValue: store },
        { provide: TourContextService, useValue: { modeIntroFor: () => null, autoStart } },
        { provide: ExperimentRunService, useValue: { active: () => false } },
        { provide: LanguageService, useValue: { t: (_key: string, _params: unknown, fallback: string) => fallback } },
      ],
    });
    fixture = TestBed.createComponent(ModeIntroComponent);
    fixture.detectChanges();
  });

  it('does not play the previous session while its replacement is being created', () => {
    store.sessionCreating.set(true);
    // An old WebSocket update must not make the creation phase ready to start.
    store.loading.set(false);
    expectBlocked();
  });

  for (const phase of ['sessionOpening', 'loading', 'backendBusy'] as const) {
    it(`keeps the intro and Start disabled while ${phase} is pending`, () => {
      store[phase].set(true);
      expectBlocked();
    });
  }

  it('keeps the intro and Start disabled while a control request is pending', () => {
    store.dispatcherControlPending.set('ownership');
    expectBlocked();
  });

  it('does not start without a current session', () => {
    store.session.set(null);
    expectBlocked();
  });

  it('starts the ready replacement with the existing tour policy and tempo', () => {
    store.session.set({ id: 'replacement-session' });
    fixture.detectChanges();
    expect(startButton().hasAttribute('disabled')).toBeFalse();
    fixture.componentInstance.startScenario();
    expect(store.dismissDemoIntro).toHaveBeenCalledTimes(1);
    expect(store.play).toHaveBeenCalledOnceWith('deadlock_avoidance', 3);
  });

  it('dismisses a ready intro without autoplay when the tour does not opt in', () => {
    autoStart.set(false);
    fixture.componentInstance.startScenario();
    expect(store.dismissDemoIntro).toHaveBeenCalledTimes(1);
    expect(store.play).not.toHaveBeenCalled();
  });

  it('does not send another Play when the ready session is already playing', () => {
    store.playing.set(true);
    fixture.componentInstance.startScenario();
    expect(store.dismissDemoIntro).toHaveBeenCalledTimes(1);
    expect(store.play).not.toHaveBeenCalled();
  });
});
