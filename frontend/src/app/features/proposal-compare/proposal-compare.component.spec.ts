import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTourContextStub } from '../../testing/tour-context-stub';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ProposalCompareComponent } from './proposal-compare.component';
import { PANEL_FRAME, PanelFrame } from '../../core/layout/panel-frame';
import { ReplayService } from '../../core/replay/replay.service';
import { ProposalChoiceService } from '../../core/proposals/proposal-choice.service';
import { ImpactItem } from '../../core/events/event-types';

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

/** The panel closes once a course is taken and opens when new options come
 *  up (docs/plans/reflection-inline.md §4.8, D25). */
describe('ProposalCompareComponent — its frame', () => {
  let frame: jasmine.SpyObj<PanelFrame>;
  let store: SessionStore;

  function create(replaying = false) {
    frame = jasmine.createSpyObj<PanelFrame>('PanelFrame', ['setExpanded']);
    TestBed.configureTestingModule({
      imports: [ProposalCompareComponent],
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTourContextStub(false),
        { provide: PANEL_FRAME, useValue: frame },
        ...(replaying ? [{ provide: ReplayService, useValue: { active: () => true } }] : []),
      ],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    const fixture = TestBed.createComponent(ProposalCompareComponent);
    fixture.componentInstance.embedded = true;
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('closes once the participant\'s own option is taken', () => {
    const fixture = create();
    store.selectedHandle.set(0);
    fixture.detectChanges();
    TestBed.inject(ProposalChoiceService).choose(0, 'hold');
    fixture.detectChanges();
    frame.setExpanded.calls.reset();
    fixture.componentInstance.commit();
    expect(frame.setExpanded).toHaveBeenCalledOnceWith(false);
  });

  it('opens when another train is picked', () => {
    const fixture = create();
    store.selectedHandle.set(0);
    fixture.detectChanges();
    frame.setExpanded.calls.reset();
    store.selectedHandle.set(1);
    fixture.detectChanges();
    expect(frame.setExpanded).toHaveBeenCalledOnceWith(true);
  });

  it('opens when a train is newly affected, not when one leaves', () => {
    const fixture = create();
    store.impact.set([{ handle: 2 } as ImpactItem]);
    fixture.detectChanges();
    expect(frame.setExpanded).toHaveBeenCalledOnceWith(true);
    frame.setExpanded.calls.reset();
    store.impact.set([]);
    fixture.detectChanges();
    expect(frame.setExpanded).not.toHaveBeenCalled();
  });

  it('leaves its frame alone in a replay', () => {
    const fixture = create(true);
    store.selectedHandle.set(0);
    store.impact.set([{ handle: 2 } as ImpactItem]);
    fixture.detectChanges();
    expect(frame.setExpanded).not.toHaveBeenCalled();
  });
});
