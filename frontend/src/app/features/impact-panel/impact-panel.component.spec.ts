import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { SessionStore } from '../../core/session.store';
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
