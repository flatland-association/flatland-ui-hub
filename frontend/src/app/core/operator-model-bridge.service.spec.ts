import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { SessionInfo } from './models';
import { OperatorModelBridge } from './operator-model-bridge.service';
import { OperatorModelService, OperatorProfile } from './operator-model.service';
import { SessionStore } from './session.store';

/**
 * A decision is reported once its reflection is settled. Now that the run
 * does not pause for a reflection, several can be open, and one answered later
 * must be reported with its answer (docs/plans/reflection-inline.md §4.1, D3).
 */
describe('OperatorModelBridge — open reflections', () => {
  let store: SessionStore;
  let signals: jasmine.Spy;
  let learnings: jasmine.Spy;

  function setUp(queue: boolean) {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    const model = TestBed.inject(OperatorModelService);
    signals = spyOn(model, 'recordSignal').and.returnValue(of({} as OperatorProfile));
    learnings = spyOn(model, 'recordLearning').and.returnValue(of({} as OperatorProfile));
    spyOn(model, 'loadProfile').and.returnValue(of({} as OperatorProfile));
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(queue);
    TestBed.inject(OperatorModelBridge).enable();
  }
  const reportedHandles = () => signals.calls.allArgs().map(([s]) => s.handle);

  afterEach(() => TestBed.resetTestingModule());

  it('holds back a decision that waits behind the shown one, and reports it with its rule once answered', () => {
    setUp(true);
    store.recordProposalChoice(0, 'proceed'); // A, shown
    store.recordProposalChoice(1, 'proceed'); // B, waits
    TestBed.tick();
    expect(reportedHandles()).toEqual([]);

    store.submitRationale({ rationale: 'x', response: 'once', valueAxis: 'punctuality' }); // A
    TestBed.tick();
    expect(reportedHandles()).toEqual([0]);

    store.submitRationale({ rationale: 'x', response: 'yes', valueAxis: 'connection' }); // B
    TestBed.tick();
    expect(reportedHandles()).toEqual([0, 1]);
    expect(learnings).toHaveBeenCalledTimes(1);
  });

  it('holds back a reflection closed in a reason tour: it can still be answered', () => {
    setUp(true);
    store.recordProposalChoice(0, 'proceed');
    store.dismissRationale();
    TestBed.tick();
    expect(reportedHandles()).toEqual([]);
  });

  it('reports a closed prompt at once outside a reason tour, as a passive accept', () => {
    setUp(false);
    store.recordProposalChoice(0, 'proceed');
    store.dismissRationale();
    TestBed.tick();
    expect(reportedHandles()).toEqual([0]);
  });
});
