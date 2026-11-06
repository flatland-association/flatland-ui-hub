import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TourContextService } from '../../core/demo/tour-context.service';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ProposalCompareComponent } from './proposal-compare.component';

/** The reflection is asked in the decision panel, without pausing the run
 *  (docs/plans/reflection-inline.md §4.2). */
describe('ProposalCompareComponent — the reflection', () => {
  let store: SessionStore;

  function create(reasonDialog: boolean) {
    TestBed.configureTestingModule({
      imports: [ProposalCompareComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TourContextService, useValue: { reasonDialog: () => reasonDialog } },
      ],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(reasonDialog);
    const fixture = TestBed.createComponent(ProposalCompareComponent);
    fixture.componentInstance.embedded = true;
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows the open reflection at the top, with its heading, and leaves the run playing', () => {
    const fixture = create(true);
    store.playing.set(true);
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    const section: HTMLElement = fixture.nativeElement.querySelector('.pc-reflection');
    expect(section).toBeTruthy();
    expect(section.querySelector('app-reflection-prompt .rp')).toBeTruthy();
    expect(fixture.nativeElement.firstElementChild?.querySelector('.pc-reflection')).toBe(section);
    expect(store.playing()).toBeTrue();
  });

  it('is gone once answered', () => {
    const fixture = create(true);
    store.recordProposalChoice(0, 'proceed');
    store.submitRationale({ rationale: '', response: 'no' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pc-reflection')).toBeNull();
  });

  it('is not shown in a tour that does not ask for reasons', () => {
    const fixture = create(false);
    store.recordProposalChoice(0, 'proceed');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.pc-reflection')).toBeNull();
  });
});
