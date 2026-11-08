import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ApiService } from '../api.service';
import { DEFAULT_DISPATCHER, DispatcherDecision, DispatcherState } from '../dispatcher';
import { ContentionStrategiesResponse } from '../models';
import { SessionStore } from '../session.store';
import { ContentionStrategiesService } from './contention-strategies.service';

const offer = (id: string, handles: number[]): ContentionStrategiesResponse => ({
  contention_id: id, step: 25, horizonSteps: 100, handles, recommended: 'pp',
  strategies: [{ id: 'pp', kind: 'pp', priority: handles, passOrder: handles,
    metrics: { lateness: 4, lateTrains: 1, notArrivedDue: 0, deadlocks: 0, arrived: 2, score: 4 }, lateSavedSteps: 8 }],
});

function actor(proposal: DispatcherDecision): DispatcherState {
  return { mode: 'recommendation', operator_type: 'human_dispatcher_team', owner: 'agent', profile: 'baseline',
    config: DEFAULT_DISPATCHER, status: 'planned', logical_time: 25, generation: 0, run_status: 'running',
    abort_reason: null, pending: proposal, observation: null, metrics: {}, events: [] };
}

describe('ContentionStrategiesService command-bound offers', () => {
  let service: ContentionStrategiesService;
  let store: ReturnType<typeof fakeStore>;
  let api: { getContentionStrategies: jasmine.Spy; applyContentionStrategy: jasmine.Spy };
  let response: Subject<ContentionStrategiesResponse>;
  let applied: Subject<{ applied: string; policy: string }>;
  const selected = offer('second-conflict', [4, 11]);
  const proposal: DispatcherDecision = { command_id: 'g0-d1', generation: 0, observed_at: 25, due: 25,
    command: { kind: 'strategy', strategy: 'pp', contention_id: 'second-conflict' },
    reason: { rule: 'preferred_strategy', fallback: null }, offer: selected };

  function fakeStore() {
    return {
      session: signal<{ id: string } | null>({ id: 'one' }), dispatcher: signal<DispatcherState | null>(null),
      contentions: signal([{ handles: [0, 1], window: [[2, 3]] }]), backendBusy: signal(false),
      sessionCreating: signal(false), interactionMode: signal('recommendation'),
      setActivePolicy: jasmine.createSpy('setActivePolicy'), refreshState: jasmine.createSpy('refreshState'),
      refreshForecasts: jasmine.createSpy('refreshForecasts'),
    };
  }

  beforeEach(() => {
    store = fakeStore();
    response = new Subject();
    applied = new Subject();
    api = { getContentionStrategies: jasmine.createSpy().and.returnValue(response),
      applyContentionStrategy: jasmine.createSpy().and.returnValue(applied) };
    TestBed.configureTestingModule({ providers: [{ provide: SessionStore, useValue: store }, { provide: ApiService, useValue: api }] });
    service = TestBed.inject(ContentionStrategiesService);
    service.use();
  });

  it('renders the actual second-group proposal without requesting the first group again', () => {
    store.dispatcher.set(actor(proposal));
    TestBed.tick();
    expect(service.response()).toEqual(selected);
    expect(service.response()?.handles).toEqual([4, 11]);
    expect(api.getContentionStrategies).not.toHaveBeenCalled();
  });

  it('does not let a previous human preview overwrite the dispatcher offer', () => {
    TestBed.tick();
    expect(api.getContentionStrategies).toHaveBeenCalledTimes(1);
    store.dispatcher.set(actor(proposal));
    TestBed.tick();
    response.next(offer('old-first-conflict', [0, 1]));
    TestBed.tick();
    expect(service.response()).toEqual(selected);
  });

  it('retains the confirmed offer when a long shift evicts the result from live history', () => {
    store.dispatcher.set({ ...actor(proposal), pending: null, events: [],
      last_result: { seq: 5, kind: 'result', source: 'digital_shift_partner', logical_time: 25, simulation_time: 25,
        decision: proposal, result: { status: 'executed', reason: 'accepted' } } });
    TestBed.tick();
    expect(service.response()).toEqual(selected);
    expect(api.getContentionStrategies).not.toHaveBeenCalled();
  });

  it('sends the displayed contention reference and ignores an old-session apply acknowledgement', async () => {
    TestBed.tick();
    response.next(selected);
    const request = service.apply('pp', [4, 11]);
    expect(api.applyContentionStrategy).toHaveBeenCalledWith('one', 'pp', [4, 11], 'recommendation', 'second-conflict');
    store.session.set({ id: 'replacement' });
    applied.next({ applied: 'pp', policy: 'plan' });
    await request;
    expect(store.setActivePolicy).not.toHaveBeenCalled();
    expect(store.refreshState).not.toHaveBeenCalled();
    expect(store.refreshForecasts).not.toHaveBeenCalled();
  });
});
