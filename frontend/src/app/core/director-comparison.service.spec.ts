import { signal } from '@angular/core';
import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { ApiService } from './api.service';
import { DEFAULT_DISPATCHER, DispatcherEffect, DispatcherState } from './dispatcher';
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

  describe('observed native outcome', () => {
    const effect = (arrived = 0, step = 2, delay: number | null = null, denominator = 0): DispatcherEffect => ({
      command_id: 'switch', scope: 'observed_since_command', causal_claim: false, intervening_commands: 0,
      before: { arrived: 0, simulation_steps: 1, total_arrival_delay: null, delay_denominator: 0 },
      after: { arrived, simulation_steps: step, total_arrival_delay: delay, delay_denominator: denominator },
      delta: { arrived, simulation_steps: step - 1, total_arrival_delay: null, delay_denominator: denominator },
    });
    const measured = (arrived = 0, step = 2, delay: number | null = null, denominator = 0): DispatcherState => ({
      ...actor({ ...ready(), phase: 'committed', validation: { accepted: true, reason: 'verified', arrived: 3, total: 3 } }),
      metrics: { total_trains: 3, arrived, simulation_steps: step }, effects: [effect(arrived, step, delay, denominator)],
      arrival_reference_source: 'authored_plan',
    });
    const show = (value: DispatcherState, step = Number(value.metrics['simulation_steps'])) => {
      store.elapsedSteps.set(step); store.dispatcher.set(value); TestBed.tick();
      return service.outcome();
    };

    it('begins after actual execution advances and retains zero as measured progress', () => {
      expect(show(measured(0, 1))).toBeNull();
      const outcome = show(measured());
      expect(service.snapshot()).toBeNull();
      expect(outcome).toEqual(jasmine.objectContaining({ stage: 'tracking', commandId: 'switch', adoptionStep: 1,
        step: 2, arrived: 0, total: 3, remaining: 3, totalArrivalDelay: null, delayDenominator: 0,
        expectedArrived: 3, expectedTotal: 3, measurementsAvailable: true, celebrate: false }));
    });

    it('updates intermediate observations and preserves a measured zero delay', () => {
      expect(show(measured(1, 59, 0, 1))).toEqual(jasmine.objectContaining({ stage: 'tracking', arrived: 1,
        remaining: 2, step: 59, totalArrivalDelay: 0, delayDenominator: 1, arrivalReference: 'authored_plan' }));
      expect(show(measured(2, 74, 8, 2))).toEqual(jasmine.objectContaining({ arrived: 2, remaining: 1,
        step: 74, totalArrivalDelay: 8, delayDenominator: 2, celebrate: false }));
    });

    it('uses its exact command rather than a newer unrelated effect', () => {
      const value = measured(1, 59, 0, 1);
      value.effects!.push({ ...effect(3, 82, 42, 3), command_id: 'different-command' });
      expect(show(value)).toEqual(jasmine.objectContaining({ commandId: 'switch', arrived: 1, step: 59 }));
      value.effects = [value.effects![1]];
      expect(show({ ...value })).toEqual(jasmine.objectContaining({ stage: 'unavailable', arrived: null,
        measurementsAvailable: false, celebrate: false }));
    });

    it('requires a committed accepted comparison for the current synthetic Director session', () => {
      for (const phase of ['waiting', 'preparing', 'ready', 'cancelled', 'unavailable'] as const) {
        const value = measured(); value.comparison = { ...value.comparison!, phase };
        expect(show(value)).withContext(phase).toBeNull();
      }
      const rejected = measured(); rejected.comparison!.validation!.accepted = false;
      expect(show(rejected)).toBeNull();
      expect(show({ ...measured(), operator_type: 'human_dispatcher_team' })).toBeNull();
      expect(show({ ...measured(), mode: 'recommendation' })).toBeNull();
      const other = measured(); other.comparison!.session_id = 'other';
      expect(show(other)).toBeNull();
      const off = measured(); off.config = { ...off.config, comparison: false };
      expect(show(off)).toBeNull();
    });

    it('retains a genuinely complete result through terminal generation invalidation', () => {
      const value = { ...measured(3, 82, 42, 3), run_status: 'finished', generation: 2 };
      expect(show(value)).toEqual(jasmine.objectContaining({ stage: 'complete', arrived: 3, total: 3,
        remaining: 0, expectedArrived: 3, expectedTotal: 3, step: 82, totalArrivalDelay: 42,
        delayDenominator: 3, celebrate: true }));
      expect(service.enabled()).toBeFalse();
      expect(service.snapshot()).toBeNull();
    });

    it('does not equate finished or early all-arrived measurements with completed success', () => {
      expect(show({ ...measured(2, 82, 17, 2), run_status: 'finished', generation: 2 }))
        .toEqual(jasmine.objectContaining({ stage: 'partial', arrived: 2, remaining: 1, celebrate: false }));
      expect(show(measured(3, 82, 42, 3))).toEqual(jasmine.objectContaining({ stage: 'tracking', celebrate: false }));
    });

    it('keeps expected measurements unavailable independently of valid actual completion', () => {
      for (const validation of [
        { accepted: true, reason: 'verified' },
        { accepted: true, reason: 'verified', arrived: NaN, total: 3 },
        { accepted: true, reason: 'verified', arrived: 3, total: 4 },
        { accepted: true, reason: 'verified', arrived: 4, total: 3 },
      ]) {
        const value = { ...measured(3, 82, 42, 3), run_status: 'finished' };
        value.comparison!.validation = validation as DirectorComparison['validation'];
        expect(show(value)).toEqual(jasmine.objectContaining({ stage: 'complete', arrived: 3,
          expectedArrived: null, expectedTotal: null, celebrate: false }));
      }
    });

    it('keeps manual ownership, mixed runs and later commands explicit without celebration', () => {
      const finished = { ...measured(3, 82, 42, 3), run_status: 'finished', generation: 2 };
      expect(show({ ...finished, owner: 'human' })).toEqual(jasmine.objectContaining({ stage: 'intervened',
        arrived: 3, intervened: true, celebrate: false }));
      expect(show({ ...finished, mixed: true, operator_type: 'mixed' }))
        .toEqual(jasmine.objectContaining({ stage: 'intervened', arrived: 3, celebrate: false }));
      const delegated = { ...measured(2, 74, 8, 2), generation: 3, mixed: true, operator_type: 'mixed' };
      expect(show(delegated)).toEqual(jasmine.objectContaining({ stage: 'intervened', arrived: 2, celebrate: false }));
      const later = { ...finished, effects: [{ ...effect(3, 82, 42, 3), intervening_commands: 1 }] };
      expect(show(later)).toEqual(jasmine.objectContaining({ stage: 'intervened', interveningCommands: 1, celebrate: false }));
    });

    it('distinguishes stopping and errors, including an adopted plan that never advanced', () => {
      expect(show({ ...measured(0, 1), run_status: 'aborted', generation: 2 }))
        .toEqual(jasmine.objectContaining({ stage: 'stopped', arrived: 0, step: 1, celebrate: false }));
      expect(show({ ...measured(1, 59, 0, 1), run_status: 'error', generation: 2 }))
        .toEqual(jasmine.objectContaining({ stage: 'error', arrived: 1, celebrate: false }));
      expect(show({ ...measured(0, 1), effects: [], run_status: 'error', generation: 2 }))
        .toEqual(jasmine.objectContaining({ stage: 'error', arrived: null, measurementsAvailable: false, celebrate: false }));
    });

    it('makes missing, contradictory or malformed measurements unavailable', () => {
      const invalid: DispatcherState[] = [
        { ...measured(), effects: [] },
        { ...measured(), effects: [effect(), effect()] },
        { ...measured(), metrics: { total_trains: null, arrived: 0, simulation_steps: 2 } },
        { ...measured(), metrics: { total_trains: 0, arrived: 0, simulation_steps: 2 } },
        { ...measured(), metrics: { total_trains: 3, arrived: 1, simulation_steps: 2 } },
        { ...measured(), metrics: { total_trains: 3, arrived: 0, simulation_steps: 3 } },
      ];
      for (const patch of [
        { arrived: -1 }, { arrived: 4 }, { arrived: 0.5 }, { simulation_steps: 1 },
        { simulation_steps: NaN }, { total_arrival_delay: Infinity }, { total_arrival_delay: -1 },
        { delay_denominator: -1 }, { delay_denominator: 1 }, { total_arrival_delay: 0 },
      ]) {
        const value = measured(); value.effects![0].after = { ...value.effects![0].after, ...patch };
        invalid.push(value);
      }
      for (const value of invalid) expect(show(value, 2)).toEqual(jasmine.objectContaining({
        stage: 'unavailable', arrived: null, measurementsAvailable: false, celebrate: false,
      }));
    });

    it('does not trust another observation scope or unknown intervening-command count', () => {
      const scoped = measured(); scoped.effects![0].scope = 'different' as DispatcherEffect['scope'];
      expect(show(scoped)?.measurementsAvailable).toBeFalse();
      const causal = measured(); causal.effects![0].causal_claim = true as false;
      expect(show(causal)?.measurementsAvailable).toBeFalse();
      const unknown = measured(3, 82, 42, 3); unknown.run_status = 'finished';
      unknown.effects![0].intervening_commands = NaN;
      expect(show(unknown)).toEqual(jasmine.objectContaining({ stage: 'unavailable', arrived: 3, celebrate: false }));
    });

    it('releases the previous outcome on reset, new session or a new unmixed running generation', () => {
      expect(show(measured())).not.toBeNull();
      expect(show(measured(), 0)).toBeNull();
      store.session.set({ id: 'next' });
      expect(service.outcome()).toBeNull();
      store.session.set({ id: 's' });
      expect(show({ ...measured(), generation: 2 })).toBeNull();
      expect(show({ ...measured(), comparison: waiting() })).toBeNull();
    });

    it('observes while disconnected or paused without creating controls, requests or timers', fakeAsync(() => {
      for (const value of [measured(), measured(1, 59, 0, 1), { ...measured(3, 82, 42, 3), run_status: 'finished', generation: 2 }]) {
        expect(show(value)).not.toBeNull();
        store.wsConnected.set(false); TestBed.tick();
        expect(service.outcome()).not.toBeNull();
        store.wsConnected.set(true); TestBed.tick();
      }
      tick(10000); TestBed.tick();
      expect(api.prepareDirectorComparison).not.toHaveBeenCalled();
      expect(api.commitDirectorComparison).not.toHaveBeenCalled();
      expect(store.acceptDirectorComparison).not.toHaveBeenCalled();
      expect(store.play).not.toHaveBeenCalled();
    }));
  });

});
