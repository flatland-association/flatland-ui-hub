import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTourContextStub } from '../../testing/tour-context-stub';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ProposalCompareComponent } from './proposal-compare.component';

/** The reflection is asked in the decision log, not in this panel
 *  (docs/plans/reflection-inline.md §4.2, D20). */
describe('ProposalCompareComponent — the reflection', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('is not shown here, also in a tour that asks for reasons', () => {
    TestBed.configureTestingModule({
      imports: [ProposalCompareComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTourContextStub(true),
      ],
    });
    const store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(true);
    const fixture = TestBed.createComponent(ProposalCompareComponent);
    fixture.componentInstance.embedded = true;
    fixture.detectChanges();
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    expect(store.pendingRationale()).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-reflection-prompt')).toBeNull();
  });
});
