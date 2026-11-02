import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiConfigService } from '../../core/config/ui-config.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { SessionStore } from '../../core/session.store';
import { DirectorDirectiveComponent } from './director-directive.component';

describe('DirectorDirectiveComponent', () => {
  let fixture: ComponentFixture<DirectorDirectiveComponent>;
  let cmp: DirectorDirectiveComponent;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DirectorDirectiveComponent],
      providers: [
        ...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(DirectorDirectiveComponent);
    cmp = fixture.componentInstance;
    store = TestBed.inject(SessionStore);
    store.interactionMode.set('director');
  });

  afterEach(() => {
    store.shiftEnded.set(false);
    store.state.set(null);
    store.session.set(null);
  });

  function running(steps: number): void {
    store.state.set({
      elapsed_steps: steps,
      agents: [
        { handle: 0, state: 'MOVING', delay: 4 },
        { handle: 1, state: 'DONE', delay: 0 },
      ],
    } as never);
  }

  it('carries the situation numbers in one row', () => {
    running(12);
    fixture.detectChanges();
    const text = (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ');
    expect(text).toContain('1 active');
    expect(text).toContain('1 delayed');
    expect(text).toContain('1/2 arrived');
  });

  it('offers no end-shift button before the run started', () => {
    running(0);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dir-end')).toBeNull();
  });

  it('opens the review when the operator ends the shift', () => {
    // Without this control the review waited for step 400, i.e. it was never
    // reached — and with it the place where preferences are saved.
    running(30);
    fixture.detectChanges();

    const btn: HTMLButtonElement = fixture.nativeElement.querySelector('.dir-end');
    expect(btn.textContent).toContain('End shift');
    btn.click();

    expect(store.shiftEnded()).toBeTrue();
    expect(store.shiftReviewOpen()).toBeTrue();
    expect(store.episodeDone()).toBeFalse();
  });

  // A study condition can take the control away entirely
  // (docs/plans/configurable-ui-plan.md §1.1 item 4). The same id also gates
  // the tour strip's copy of the button, which is the one a Co-Learning run
  // actually shows.
  it('offers no end-shift button once control.endShift is hidden', () => {
    running(30);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dir-end')).not.toBeNull();

    TestBed.inject(UiConfigService).apply({ hidden: ['control.endShift'] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dir-end')).toBeNull();
  });

  it('brings it back when the restriction is dropped', () => {
    const uiConfig = TestBed.inject(UiConfigService);
    uiConfig.apply({ hidden: ['control.endShift'] });
    running(30);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dir-end')).toBeNull();

    uiConfig.apply({});
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.dir-end')).not.toBeNull();
  });
});
