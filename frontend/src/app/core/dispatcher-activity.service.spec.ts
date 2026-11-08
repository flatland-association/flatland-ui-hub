import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DispatcherActivityService } from './dispatcher-activity.service';
import { DEFAULT_DISPATCHER, DispatcherEvent, DispatcherState } from './dispatcher';
import { SessionStore } from './session.store';
import { LanguageService } from './i18n/language.service';
import { WebSocketService } from './websocket.service';
import { ContentionStrategy } from './models';

describe('DispatcherActivityService authoritative history', () => {
  let service: DispatcherActivityService;
  const receipt: DispatcherEvent = {
    seq: 10, kind: 'result', source: 'synthetic_dispatcher', logical_time: 4, simulation_time: 30,
    decision: { command_id: 'accepted', generation: 1, observed_at: 1, due: 4,
      command: { kind: 'strategy', strategy: 'pp', contention_id: 'second-group' },
      reason: { rule: 'preferred_strategy', fallback: null } },
    result: { status: 'executed', reason: 'accepted' },
  };
  const actor = signal<DispatcherState | null>(null);
  const snapshot = (overrides: Partial<DispatcherState> = {}): DispatcherState => ({
    mode: 'recommendation', operator_type: 'synthetic_dispatcher', owner: 'agent', profile: 'baseline',
    config: structuredClone(DEFAULT_DISPATCHER), status: 'waiting', logical_time: 40, generation: 1,
    run_status: 'running', abort_reason: null, pending: null, observation: null, metrics: {},
    // A fresh/reconnected client receives only the last bounded observation events.
    events: Array.from({ length: 30 }, (_, index) => ({
      seq: index + 20, kind: 'effect_observed', source: 'environment', logical_time: 40, simulation_time: 80,
    })), ...overrides,
  });

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(0));
    actor.set(snapshot({ last_result: structuredClone(receipt) }));
    TestBed.configureTestingModule({ providers: [
      { provide: SessionStore, useValue: { dispatcher: actor, session: signal({ id: 'session' }),
        dispatcherControlPending: signal(null), backendBusy: signal(false), playing: signal(true), loading: signal(false),
        wsConnected: signal(true), state: signal({ elapsed_steps: 80 }) } },
      { provide: WebSocketService, useValue: { stateReceipt: signal({ sessionId: 'session', at: 0, revision: 1 }), stateConfirmed: signal(true) } },
      { provide: LanguageService, useValue: { t: (key: string) => key } },
    ] });
    service = TestBed.inject(DispatcherActivityService);
  });

  afterEach(() => jasmine.clock().uninstall());

  it('keeps the acknowledged action when bounded observation history no longer contains it', () => {
    expect(service.displayAction().stage).toBe('executed');
    expect(service.displayAction().commandId).toBe('accepted');
    expect(service.activity().targetKey).toBe('strategy:pp:second-group');
    actor.update(value => ({ ...value!, owner: 'human', run_status: 'finished' }));
    expect(service.activity().stage).toBe('human');
    expect(service.displayAction().stage).toBe('executed');
    expect(service.displayAction().commandId).toBe('accepted');
  });

  it('keeps actual controller confirmation after its event leaves the bounded history', () => {
    const directive = structuredClone(receipt);
    directive.decision!.command = { kind: 'directive', weights: { punctuality: 2, connections: 2, stability: 5 } };
    actor.set(snapshot({ mode: 'director', last_result: directive, last_effective: {
      seq: 11, kind: 'directive_effective', source: 'controller', logical_time: 5,
      simulation_time: 31, weights: [2, 2, 5],
    } }));
    expect(service.displayAction().stage).toBe('effective');
    expect(service.displayAction().params.weights).toBe('2 / 2 / 5');
  });

  it('still supports older snapshots whose result is present only in events', () => {
    actor.set(snapshot({ events: [structuredClone(receipt)] }));
    expect(service.displayAction().stage).toBe('executed');
    expect(service.displayAction().commandId).toBe('accepted');
  });

  const offered = (id: string, score: number, lateness = score): ContentionStrategy => ({
    id, kind: id === 'keep' ? 'keep' : id.startsWith('policy:') ? 'policy' : 'pp',
    metrics: { score, lateness, lateTrains: 1, notArrivedDue: 0, deadlocks: 0, arrived: 1 },
    passOrder: [1, 0], lateSavedSteps: 0,
  });
  const assess = (strategies: ContentionStrategy[], selected = 'keep') => {
    const result = structuredClone(receipt);
    result.decision!.command = { kind: 'strategy', strategy: selected, handles: [0, 1], contention_id: 'group' };
    result.decision!.offer = { step: 22, horizonSteps: 80, handles: [0, 1],
      location: { kind: 'station', name: 'PF', cell: null }, strategies };
    actor.set(snapshot({ last_result: result }));
    return service.assessment()!;
  };

  it('explains a keep assessment against its best immutable alternative, with named context', () => {
    const assessment = assess([offered('keep', 3), offered('policy:ppo', 10), offered('pp', 6)]);
    expect(assessment.choice).toBe('maintain');
    expect(assessment.comparison).toBe('better');
    expect(assessment.handles).toEqual([0, 1]);
    expect(assessment.location).toBe('PF');
    expect(assessment.forecastStep).toBe(22);
    expect(assessment.otherScore).toBe(6);
    expect(assessment.comparisonMetric).toBe('lateness');
    expect(assessment.selectedMetric).toBe(3);
    expect(assessment.otherMetric).toBe(6);
  });

  it('distinguishes a tie with the best alternative from a worse configured selection', () => {
    expect(assess([offered('keep', 3), offered('pp', 3), offered('policy:ppo', 10)]).comparison).toBe('equal');
    const preferred = assess([offered('keep', 3), offered('pp', 8)], 'pp');
    expect(preferred.choice).toBe('change');
    expect(preferred.comparison).toBe('worse');
    expect(preferred.reasonKey).toBe('worse');
    actor.update(value => ({ ...value!, last_result: { ...value!.last_result!, decision: { ...value!.last_result!.decision!,
      reason: { rule: 'explicit_pp_train_order', fallback: null } } } }));
    expect(service.assessment()!.reasonKey).toBe('preference');
  });

  it('does not invent a comparison from unavailable or nonfinite scores', () => {
    expect(assess([offered('keep', 3)]).comparison).toBe('unavailable');
    expect(assess([offered('keep', NaN), offered('pp', 3)]).comparison).toBe('missing');
    expect(assess([offered('keep', 3), offered('pp', Infinity)]).comparison).toBe('missing');
    expect(assess([offered('keep', 3), offered('pp', 5), offered('policy:ppo', NaN)]).comparison).toBe('missing');
    expect(assess([offered('keep', 3), offered('pp', 4, NaN)]).comparison).toBe('missing');
    expect(assess([], 'keep').comparison).toBe('missing');
    actor.set(snapshot({ last_result: structuredClone(receipt) }));
    expect(service.assessment()!.comparison).toBe('missing');
  });

  it('uses policy labels and prioritises deadlock differences over lateness in compact evidence', () => {
    const alternative = offered('policy:ppo', 12);
    const selected = offered('keep', 3);
    alternative.metrics.deadlocks = 1;
    const assessment = assess([selected, alternative]);
    expect(assessment.otherAction).toBe('ca.strategy.policy');
    expect(assessment.comparisonMetric).toBe('deadlocks');
    expect(assessment.selectedMetric).toBe(0);
    expect(assessment.otherMetric).toBe(1);
    expect(assess([offered('keep', 3), offered('policy:ppo', 2)], 'policy:ppo').action).toBe('ca.strategy.policy');
  });

  it('removes a keep target after execution but retains a real pending consent target', () => {
    assess([offered('keep', 3), offered('pp', 6)]);
    TestBed.tick();
    expect(service.interactionTarget()).toBeNull();
    actor.update(value => ({ ...value!, operator_type: 'human_dispatcher_team', requires_approval: true,
      awaiting_approval: true, pending: value!.last_result!.decision! }));
    expect(service.interactionTarget()?.targetKey).toBe('strategy:keep:group');
    expect(service.interactionTarget()?.pending).toBeTrue();
    actor.update(value => ({ ...value!, owner: 'human' }));
    expect(service.interactionTarget()).toBeNull();
  });

  it('expires acknowledged changes without rearming on a normal state update', () => {
    const result = structuredClone(receipt);
    result.elapsed_ms = 100;
    actor.set(snapshot({ last_result: result, elapsed_ms: 100 }));
    TestBed.tick();
    expect(service.interactionTarget()?.targetKey).toBe('strategy:pp:second-group');
    expect(service.interactionTarget()?.pending).toBeFalse();
    jasmine.clock().tick(3000);
    TestBed.tick();
    expect(service.interactionTarget()).toBeNull();
    actor.update(value => ({ ...value!, logical_time: 41, elapsed_ms: 3100 }));
    TestBed.tick();
    expect(service.interactionTarget()).toBeNull();
    expect(service.displayAction().commandId).toBe('accepted');
  });

  it('does not replay an old change when a client first receives its history', () => {
    TestBed.tick();
    expect(service.interactionTarget()).toBeNull();
  });

  it('briefly marks controller confirmation even if acceptance happened much earlier', () => {
    const result = structuredClone(receipt);
    result.elapsed_ms = 100;
    result.decision!.command = { kind: 'directive', weights: { punctuality: 2, connections: 2, stability: 5 } };
    actor.set(snapshot({ mode: 'director', last_result: result, elapsed_ms: 8000, last_effective: {
      seq: 11, kind: 'directive_effective', source: 'controller', logical_time: 5,
      simulation_time: 31, elapsed_ms: 8000, weights: [2, 2, 5],
    } }));
    TestBed.tick();
    expect(service.interactionTarget()?.targetKey).toBe('director:2:2:5');
    jasmine.clock().tick(3000);
    TestBed.tick();
    expect(service.interactionTarget()).toBeNull();
    expect(service.displayAction().stage).toBe('effective');
  });

  it('does not expose preferred assessments or interaction targets in neutral Co-Learning', () => {
    assess([offered('keep', 3), offered('pp', 6)]);
    actor.update(value => ({ ...value!, mode: 'co-learning', operator_type: 'human_dispatcher_team' }));
    expect(service.assessment()).toBeNull();
    expect(service.interactionTarget()).toBeNull();
  });


  it('clears interaction markers during connection loss and terminal ownership states', () => {
    actor.set(snapshot({ pending: structuredClone(receipt.decision!) }));
    expect(service.interactionTarget()?.pending).toBeTrue();
    (service.store.wsConnected as WritableSignal<boolean>).set(false);
    expect(service.interactionTarget()).toBeNull();
    (service.store.wsConnected as WritableSignal<boolean>).set(true);
    for (const run_status of ['finished', 'error', 'aborted']) {
      actor.update(value => ({ ...value!, run_status }));
      expect(service.interactionTarget()).toBeNull();
      expect(service.displayAction().commandId).toBe('accepted');
    }
  });

});
