import { signal } from '@angular/core';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { DEFAULT_DISPATCHER, DispatcherState } from './dispatcher';
import { DirectorComparisonService } from './director-comparison.service';
import { DirectorComparison } from './models';
import { SessionStore } from './session.store';

const waiting = (): DirectorComparison => ({ phase: 'waiting', session_id: 's', command_id: 'switch', generation: 1, step: 1 });
const ready = (): DirectorComparison => ({ ...waiting(), phase: 'ready', token: 'frozen',
  current: { weights: { punctuality: 2, connections: 2, stability: 5 }, paths: { '0': [{ row: 0, col: 0, step: 2 }] }, utilities: null },
  alternative: { id: 'focus_delay', ident: 'A', focus: 'punctuality', weights: { punctuality: 5, connections: 2, stability: 2 },
    plan: { source: 'research', weighted: 0.8, utilities: { punctuality: 0.9, connections: 1, stability: 0.8 }, changed: [0] },
    paths: { '0': [{ row: 0, col: 0, step: 2 }, { row: 1, col: 0, step: 3 }] },
    divergence: { reroutes: { '0': { branch: { row: 1, col: 0, step: 3 }, points: [{ row: 0, col: 0, step: 2 }, { row: 1, col: 0, step: 3 }] } }, holds: [] } },
  validation: { accepted: true, reason: 'verified', arrived: 2, total: 2 },
});
const actor = (comparison: DirectorComparison): DispatcherState => ({
  mode: 'director', operator_type: 'synthetic_dispatcher', owner: 'agent', profile: 'goal-switch',
  config: { ...DEFAULT_DISPATCHER, comparison: true }, status: 'planned', logical_time: 2, generation: 1,
  run_status: 'running', abort_reason: null, pending: null, observation: null, metrics: {}, events: [], comparison,
});

describe('DirectorComparisonService explicit launch workflow', () => {
  let service: DirectorComparisonService;
  let store: { dispatcher: ReturnType<typeof signal<DispatcherState>>; session: ReturnType<typeof signal<{ id: string }>>;
    elapsedSteps: ReturnType<typeof signal<number>>; directorComparisonLauncher: ReturnType<typeof signal<string | null>>;
    directorComparisonInterruption: ReturnType<typeof signal<number>>; wsConnected: ReturnType<typeof signal<boolean>>;
    activePolicy: ReturnType<typeof signal<string>>; playSpeed: ReturnType<typeof signal<number>>;
    acceptDirectorComparison: jasmine.Spy; play: jasmine.Spy };
  let prepare: Subject<DispatcherState>;
  let commit: Subject<DispatcherState>;
  let api: { prepareDirectorComparison: jasmine.Spy; commitDirectorComparison: jasmine.Spy };
  let present: jasmine.Spy;

  beforeEach(() => {
    prepare = new Subject(); commit = new Subject();
    store = { dispatcher: signal(actor(waiting())), session: signal({ id: 's' }), elapsedSteps: signal(1),
      directorComparisonLauncher: signal<string | null>(null), directorComparisonInterruption: signal(0), wsConnected: signal(true),
      activePolicy: signal('goal_directed'), playSpeed: signal(1),
      acceptDirectorComparison: jasmine.createSpy('accept').and.callFake((value: DispatcherState) => store.dispatcher.set(value)),
      play: jasmine.createSpy('play') };
    api = { prepareDirectorComparison: jasmine.createSpy('prepare').and.returnValue(prepare), commitDirectorComparison: jasmine.createSpy('commit').and.returnValue(commit) };
    TestBed.configureTestingModule({ providers: [{ provide: SessionStore, useValue: store }, { provide: ApiService, useValue: api }] });
    service = TestBed.inject(DirectorComparisonService);
    present = jasmine.createSpy('present');
    service.register({ present });
  });
  const launch = () => { store.directorComparisonLauncher.set('s'); TestBed.tick(); };
  const finishPreparation = () => { prepare.next(actor(ready())); prepare.complete(); flushMicrotasks(); TestBed.tick(); };

  it('reserves the native surface while the actor is ready without executing a comparison yet', fakeAsync(() => {
    store.dispatcher.update(value => ({ ...value, run_status: 'ready' }));
    store.directorComparisonLauncher.set('s'); TestBed.tick();
    expect(service.enabled()).toBeTrue();
    expect(service.canCommit()).toBeFalse();
    expect(api.prepareDirectorComparison).not.toHaveBeenCalled();
    expect(api.commitDirectorComparison).not.toHaveBeenCalled();
  }));

  it('does not reclaim the native surface after human takeover and delegation', fakeAsync(() => {
    store.dispatcher.update(value => ({ ...value, mixed: true }));
    store.directorComparisonLauncher.set('s'); TestBed.tick();
    expect(service.enabled()).toBeFalse();
    expect(service.snapshot()).toBeNull();
    store.dispatcher.set({ ...actor(ready()), mixed: true }); TestBed.tick(); tick(5000);
    expect(service.enabled()).toBeFalse();
    expect(service.snapshot()).toBeNull();
    expect(api.prepareDirectorComparison).not.toHaveBeenCalled();
    expect(api.commitDirectorComparison).not.toHaveBeenCalled();
    expect(store.play).not.toHaveBeenCalled();
  }));

  it('keeps viewers read-only even when a prepared checkpoint or candidate is visible', fakeAsync(() => {
    TestBed.tick(); tick(5000);
    expect(api.prepareDirectorComparison).not.toHaveBeenCalled();
    store.dispatcher.set(actor(ready())); TestBed.tick(); tick(5000);
    expect(service.stage()).toBe('alternative');
    void service.commit(); flushMicrotasks();
    expect(api.commitDirectorComparison).not.toHaveBeenCalled();
    expect(store.play).not.toHaveBeenCalled();
  }));

  it('shows both frozen stages before committing the exact token and resuming once', fakeAsync(() => {
    launch();
    expect(api.prepareDirectorComparison).toHaveBeenCalledOnceWith('s', 'switch', 1);
    expect(service.stage()).toBe('preparing');
    finishPreparation();
    expect(service.stage()).toBe('baseline');
    expect(service.forecast().every(metric => metric.before === null)).toBeTrue();
    tick(1499); expect(api.commitDirectorComparison).not.toHaveBeenCalled();
    tick(1); TestBed.tick(); expect(service.stage()).toBe('alternative');
    expect(service.counts()).toEqual({ reroutes: 1, holds: 0 });
    expect(present).toHaveBeenCalledWith(jasmine.objectContaining({ token: 'frozen' }), 'alternative');
    tick(2999); expect(api.commitDirectorComparison).not.toHaveBeenCalled();
    tick(1); expect(api.commitDirectorComparison).toHaveBeenCalledOnceWith('s', 'switch', 1, 'frozen');
    expect(store.play).not.toHaveBeenCalled();
    commit.next(actor({ ...ready(), phase: 'committed' })); commit.complete(); flushMicrotasks(); TestBed.tick();
    expect(service.stage()).toBe('committed');
    expect(store.play).toHaveBeenCalledOnceWith('goal_directed', 1, 'automatic', 'frozen');
    store.dispatcher.set(actor({ ...ready(), phase: 'committed' })); TestBed.tick(); tick(5000);
    expect(api.prepareDirectorComparison).toHaveBeenCalledTimes(1);
    expect(api.commitDirectorComparison).toHaveBeenCalledTimes(1);
  }));

  it('ignores a late prepared candidate after human interruption', fakeAsync(() => {
    launch(); store.directorComparisonLauncher.set(null); store.directorComparisonInterruption.update(value => value + 1); TestBed.tick();
    finishPreparation(); tick(5000);
    expect(service.stage()).toBe('cancelled');
    expect(store.acceptDirectorComparison).not.toHaveBeenCalled();
    expect(api.commitDirectorComparison).not.toHaveBeenCalled();
    expect(store.play).not.toHaveBeenCalled();
  }));

  it('cancels on stale step or ownership instead of committing a stale preview', fakeAsync(() => {
    launch(); finishPreparation();
    store.elapsedSteps.set(2); TestBed.tick(); tick(5000);
    expect(service.stage()).toBe('cancelled');
    expect(api.commitDirectorComparison).not.toHaveBeenCalled();
    expect(store.play).not.toHaveBeenCalled();
  }));

  it('cannot resume after takeover while a commit response is in flight', fakeAsync(() => {
    launch(); finishPreparation(); tick(4500);
    store.directorComparisonInterruption.update(value => value + 1);
    store.dispatcher.update(value => ({ ...value, owner: 'human' })); TestBed.tick();
    commit.next(actor({ ...ready(), phase: 'committed' })); commit.complete(); flushMicrotasks(); tick(5000);
    expect(store.acceptDirectorComparison).toHaveBeenCalledTimes(1);
    expect(store.play).not.toHaveBeenCalled();
  }));

  it('refuses identical geometry and rejected execution checks', fakeAsync(() => {
    launch(); const unchanged = ready(); unchanged.alternative!.divergence = { reroutes: {}, holds: [] };
    prepare.next(actor(unchanged)); prepare.complete(); flushMicrotasks(); TestBed.tick(); tick(5000);
    expect(service.stage()).toBe('unavailable');
    expect(api.commitDirectorComparison).not.toHaveBeenCalled();
    expect(store.play).not.toHaveBeenCalled();
  }));

  it('requires the execution gate even for a drawable candidate', fakeAsync(() => {
    launch(); const rejected = ready(); rejected.validation!.accepted = false;
    prepare.next(actor(rejected)); prepare.complete(); flushMicrotasks(); TestBed.tick(); tick(5000);
    expect(service.canCommit()).toBeFalse();
    expect(api.commitDirectorComparison).not.toHaveBeenCalled();
  }));

  it('releases comparison ownership after confirmed playback advances and leaves human plans alone', fakeAsync(() => {
    store.dispatcher.set(actor({ ...ready(), phase: 'committed' })); TestBed.tick();
    expect(service.enabled()).toBeTrue();
    store.elapsedSteps.set(2); TestBed.tick();
    expect(service.enabled()).toBeFalse();
    expect(service.snapshot()).toBeNull();
    present.calls.reset();
    store.dispatcher.update(value => ({ ...value, owner: 'human' })); TestBed.tick();
    store.dispatcher.update(value => ({ ...value, logical_time: 8 })); TestBed.tick();
    expect(present).not.toHaveBeenCalled();
  }));

});
