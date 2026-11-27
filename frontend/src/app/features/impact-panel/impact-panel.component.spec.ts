import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { SessionStore } from '../../core/session.store';
import { signal } from '@angular/core';
import { TourContextService } from '../../core/demo/tour-context.service';
import { ImpactPanelComponent } from './impact-panel.component';

describe('ImpactPanelComponent', () => {
  let cmp: any;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ImpactPanelComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    cmp = TestBed.createComponent(ImpactPanelComponent).componentInstance;
    store = TestBed.inject(SessionStore);
    jasmine.clock().install();
  });

  afterEach(() => {
    cmp.ngOnDestroy();
    jasmine.clock().uninstall();
  });

  // docs/plans/confirm-finish-scenario.md §4.3 (#180).
  it('holds the decision countdown while the finish dialog is open', () => {
    const autoDecide = spyOn(cmp, '_autoDecide');
    store.decisionCountdownSeconds.set(3);
    cmp._startCountdown();
    jasmine.clock().tick(1000);
    expect(cmp.countdownRemaining()).toBe(2);

    store.finishConfirmOpen.set(true);
    jasmine.clock().tick(10_000);
    expect(cmp.countdownRemaining()).withContext('no time passes behind the dialog').toBe(2);
    expect(autoDecide).not.toHaveBeenCalled();

    store.finishConfirmOpen.set(false);
    jasmine.clock().tick(2000);
    expect(autoDecide).toHaveBeenCalled();
  });
});

/** #201 D-7, docs/plans/plan-b-round2-recommendation.md, item 4: a briefing can
 *  make Recommendation hold the affected trains, as Co-Learning does. */
describe('ImpactPanelComponent — decision moment', () => {
  const create = (decisionMoment: 'hold' | null) => {
    TestBed.configureTestingModule({
      imports: [ImpactPanelComponent],
      providers: [
        ...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting(),
        {
          provide: TourContextService,
          useValue: {
            decisionMoment: () => decisionMoment,
            assessmentOnly: () => true,
            briefing: () => null,
            liveSandbox: () => false,
            ruleShown: signal(null),
            runStartedAt: () => null,
            shiftStartedAt: () => null,
          },
        },
      ],
    });
    const store = TestBed.inject(SessionStore);
    const cmp = TestBed.createComponent(ImpactPanelComponent).componentInstance;
    return { store, cmp };
  };

  afterEach(() => TestBed.resetTestingModule());

  it('counts down in Recommendation by default', () => {
    const { store, cmp } = create(null);
    store.interactionMode.set('recommendation');
    expect(cmp.modeBehavior().decisionMoment).toBe('countdown');
    cmp.ngOnDestroy();
  });

  it('holds in Recommendation when the briefing asks for it, and leaves the other modes alone', () => {
    const { store, cmp } = create('hold');
    store.interactionMode.set('recommendation');
    expect(cmp.modeBehavior().decisionMoment).toBe('hold');
    store.interactionMode.set('director');
    expect(cmp.modeBehavior().decisionMoment).toBe('none');
    cmp.ngOnDestroy();
  });
});
