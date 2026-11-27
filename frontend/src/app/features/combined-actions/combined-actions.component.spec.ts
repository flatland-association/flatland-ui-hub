import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DispatcherActivityService } from '../../core/dispatcher-activity.service';
import { ContentionStrategiesService } from '../../core/combined-actions/contention-strategies.service';
import { ImpactPredictionService } from '../../core/combined-actions/impact-prediction.service';
import { LanguageService } from '../../core/i18n/language.service';
import { AgentDTO, ContentionStrategiesResponse } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { TrainIdentityService } from '../../core/train-identity.service';
import { ActionCardComponent } from './components/action-card/action-card.component';
import { CombinedActionsComponent } from './combined-actions.component';

describe('CombinedActions native acknowledgement logging', () => {
  let parent: CombinedActionsComponent;
  let card: ActionCardComponent;
  let accept: () => void;
  let reject: (error: Error) => void;
  let store: ReturnType<typeof fakeStore>;
  let strategies: { response: ReturnType<typeof signal<ContentionStrategiesResponse | null>>; apply: jasmine.Spy };
  let names: ReturnType<typeof signal<Record<string, number>>>;

  function fakeStore() {
    return {
      session: signal<{ id: string } | null>({ id: 'one' }), dispatcher: signal(null),
      dispatcherControlPending: signal(null), sessionCreating: signal(false), sessionOpening: signal(false),
      interactionMode: signal('recommendation'), agents: signal<AgentDTO[]>([]), contentions: signal([]),
      recordCoordinatedAction: jasmine.createSpy('recordCoordinatedAction'),
      setCombinedActionPreview: jasmine.createSpy(), clearAgentHoverAgents: jasmine.createSpy(),
    };
  }

  beforeEach(() => {
    store = fakeStore();
    names = signal({ Train4: 4, Train11: 11 });
    const response: ContentionStrategiesResponse = {
      contention_id: 'group', step: 25, horizonSteps: 100, handles: [4, 11], recommended: 'pp',
      strategies: [{ id: 'pp', kind: 'pp', priority: [4, 11], passOrder: [4, 11], lateSavedSteps: 8,
        metrics: { lateness: 4, lateTrains: 1, notArrivedDue: 0, deadlocks: 0, arrived: 2, score: 4 } }],
    };
    strategies = { response: signal(response), apply: jasmine.createSpy('apply').and.callFake(() =>
      new Promise<void>((resolve, fail) => { accept = resolve; reject = fail; })) };
    TestBed.configureTestingModule({ providers: [
      { provide: SessionStore, useValue: store },
      { provide: ContentionStrategiesService, useValue: strategies },
      { provide: DispatcherActivityService, useValue: { store, activity: signal({ stage: 'observing' }) } },
      { provide: LanguageService, useValue: { t: (key: string) => key } },
      { provide: TrainIdentityService, useValue: { nameFor: (handle: number) => `Train${handle}`, handleByName: names } },
      { provide: ImpactPredictionService, useValue: { predictNow: () => null } },
    ] });
    parent = TestBed.runInInjectionContext(() => new CombinedActionsComponent());
    spyOn(parent, 'packageSource').and.returnValue('strategies');
    card = TestBed.runInInjectionContext(() => new ActionCardComponent());
    card.pkg = parent.packages()[0];
    card.applyAction = parent.applyAction;
    card.applyRequested.subscribe(event => parent.onApplied(event));
    card.ngOnInit();
  });

  afterEach(() => { card.ngOnDestroy(); parent.ngOnDestroy(); });

  it('records the accepted immutable choice once even when refreshing removes its card', async () => {
    const request = card.apply();
    expect(store.recordCoordinatedAction).not.toHaveBeenCalled();
    strategies.response.set(null);
    card.ngOnDestroy();
    names.set({ Train4: 99, Train11: 100 });
    accept();
    await request;
    expect(store.recordCoordinatedAction).toHaveBeenCalledTimes(1);
    expect(store.recordCoordinatedAction.calls.mostRecent().args[0]).toEqual(jasmine.objectContaining({
      handles: [4, 11], aiOrder: ['Train4', 'Train11'], appliedOrder: ['Train4', 'Train11'], committed: false,
    }));
    expect(card.applied()).toBeNull();
  });

  it('records one accepted request with a live card and ignores a duplicate pending click', async () => {
    const request = card.apply();
    await card.apply();
    expect(strategies.apply).toHaveBeenCalledTimes(1);
    accept();
    await request;
    expect(card.applied()).toBe('AI proposal');
    expect(store.recordCoordinatedAction).toHaveBeenCalledTimes(1);
  });

  it('records the old accepted choice without painting Applied on a replacement card', async () => {
    const request = card.apply();
    card.pkg = { ...card.pkg, id: 'B', label: 'Another conflict', aiOrder: ['Train11'] };
    accept();
    await request;
    expect(store.recordCoordinatedAction).toHaveBeenCalledTimes(1);
    expect(store.recordCoordinatedAction.calls.mostRecent().args[0].appliedOrder).toEqual(['Train4', 'Train11']);
    expect(card.applied()).toBeNull();
  });

  it('does not record a rejected native mutation', async () => {
    const request = card.apply();
    reject(new Error('409: dispatcher owns role'));
    await request;
    expect(store.recordCoordinatedAction).not.toHaveBeenCalled();
    expect(card.applied()).toBeNull();
    expect(parent.applyError()).toBe('ca.strategy.applyFailed');
  });

  for (const boundary of ['replacement', 'creating', 'ended'] as const) {
    it(`does not append an old acknowledgement to the log when the session is ${boundary}`, async () => {
      const request = card.apply();
      if (boundary === 'creating') store.sessionCreating.set(true);
      else store.session.set(boundary === 'ended' ? null : { id: 'two' });
      accept();
      await request;
      expect(store.recordCoordinatedAction).not.toHaveBeenCalled();
      expect(card.applied()).toBeNull();
    });
  }

  it('keeps immediate selection-only logging for the existing heuristic path', () => {
    card.applyAction = null;
    void card.apply();
    expect(strategies.apply).not.toHaveBeenCalled();
    expect(store.recordCoordinatedAction).toHaveBeenCalledTimes(1);
    expect(store.recordCoordinatedAction.calls.mostRecent().args[0].committed).toBeFalse();
  });
});
