import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from './testing/transloco-testing';
import { provideHttpClient } from '@angular/common/http';
import { AppComponent } from './app.component';
import { PLAY_SPEED_DEFAULT_LEVEL } from './core/play-speed';
import { SessionStore } from './core/session.store';
import { SessionInfo } from './core/models';
import { TourContextService } from './core/demo/tour-context.service';
import { briefingById } from './core/demo/tour-briefings';

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
});
