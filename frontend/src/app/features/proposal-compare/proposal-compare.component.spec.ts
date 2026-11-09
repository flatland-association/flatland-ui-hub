import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTourContextStub } from '../../testing/tour-context-stub';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ProposalCompareComponent } from './proposal-compare.component';
import { PanelFrameService } from '../../core/layout/panel-frame';
import { ReplayService } from '../../core/replay/replay.service';
import { ProposalChoiceService } from '../../core/proposals/proposal-choice.service';

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

/** The panel closes once a course is taken (docs/plans/reflection-inline.md
 *  §4.8, D25); opening again is `ProposalChoiceService`'s. */
describe('ProposalCompareComponent — closing its frame', () => {
  let setExpanded: jasmine.Spy;
  let store: SessionStore;

  function create(replaying = false) {
    TestBed.configureTestingModule({
      imports: [ProposalCompareComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTourContextStub(false),
        ...(replaying ? [{ provide: ReplayService, useValue: { active: () => true } }] : []),
      ],
    });
    setExpanded = spyOn(TestBed.inject(PanelFrameService), 'setExpanded');
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    const fixture = TestBed.createComponent(ProposalCompareComponent);
    fixture.componentInstance.embedded = true;
    store.selectedHandle.set(0);
    fixture.detectChanges();
    TestBed.inject(ProposalChoiceService).choose(0, 'hold');
    fixture.detectChanges();
    setExpanded.calls.reset();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('closes once the participant\'s own option is taken', () => {
    create().componentInstance.commit();
    expect(setExpanded).toHaveBeenCalledOnceWith('proposal-compare', false);
  });

  it('leaves its frame alone in a replay', () => {
    create(true).componentInstance.commit();
    expect(setExpanded).not.toHaveBeenCalled();
  });
});
