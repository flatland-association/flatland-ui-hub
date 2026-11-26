import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ExperimentRunService } from '../../core/demo/experiment-run.service';
import { ScenarioCard, TourContextService } from '../../core/demo/tour-context.service';
import { InteractionMode } from '../../core/events/event-types';
import { LanguageService } from '../../core/i18n/language.service';
import { SessionStore } from '../../core/session.store';
import { ModeIntroComponent } from './mode-intro.component';
import { UiConfigService } from '../../core/config/ui-config.service';

describe('ModeIntroComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ModeIntroComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
  });

  function render(card: ScenarioCard | null, step: string | null = null): HTMLElement {
    const fixture = TestBed.createComponent(ModeIntroComponent);
    fixture.componentRef.setInput('replayScenarioCard', card);
    fixture.componentRef.setInput('replayStep', step);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the mode sections without a scenario card', () => {
    const el = render(null);
    expect(el.querySelectorAll('.intro-section').length).toBe(6);
    expect(el.querySelector('.intro-scenario')).toBeNull();
  });

  it('shows an experiment scenario as title, paragraphs and image, without the mode sections', () => {
    const el = render({ title: 'Störung am Einspurabschnitt', paragraphs: ['Erster.', 'Zweiter.'], imageUrl: '/img.png', videoUrl: null });
    expect(el.querySelector('.intro-title')?.textContent).toContain('Störung am Einspurabschnitt');
    expect([...el.querySelectorAll('.intro-scenario__text p')].map((p) => p.textContent)).toEqual(['Erster.', 'Zweiter.']);
    expect(el.querySelector<HTMLImageElement>('.intro-scenario__image')?.getAttribute('src')).toBe('/img.png');
    expect(el.querySelectorAll('.intro-section').length).toBe(0);
    expect(el.querySelector('.intro-wp')).toBeNull();
    // The start button stays.
    expect(el.querySelector('.intro-actions sbb-button')).not.toBeNull();
  });

  // docs/plans/hide-scenario-bar.md §4.3: the scenario's title is its name.
  it('leaves the title out where the condition hides the scenarios\' names', () => {
    TestBed.inject(UiConfigService).apply({ hidden: ['control.legNames'] });
    const el = render({ title: 'Türstörung', paragraphs: ['P'], imageUrl: '/img.png', videoUrl: null }, 'Szenario 4/5');
    expect(el.querySelector('.intro-title')).toBeNull();
    expect(el.textContent).not.toContain('Türstörung');
    // The image keeps a text for screen readers: the step, not the name.
    expect(el.querySelector('.intro-scenario__image')?.getAttribute('alt')).toBe('Szenario 4/5');
    expect(el.querySelector('.intro-scenario__text p')?.textContent).toBe('P');
  });

  it('leaves the image out when the scenario has none', () => {
    const el = render({ title: 'T', paragraphs: ['P'], imageUrl: null, videoUrl: null });
    expect(el.querySelector('.intro-scenario__image')).toBeNull();
    expect(el.querySelector('.intro-scenario__video')).toBeNull();
  });

  it('shows the video below the text, with the player\'s controls', () => {
    const el = render({ title: 'T', paragraphs: ['P'], imageUrl: null, videoUrl: '/intro.mp4' });
    const video = el.querySelector<HTMLVideoElement>('.intro-scenario__video')!;
    expect(video.getAttribute('src')).toBe('/intro.mp4');
    expect(video.controls).toBeTrue();
    // After the text block, not beside it in the text/image grid.
    expect(video.parentElement?.classList.contains('intro-scenario')).toBeFalse();
    expect(el.querySelector('.intro-scenario')!.compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

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
        { provide: TourContextService, useValue: { modeIntroFor: () => null, scenarioCard: () => null, autoStart } },
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
