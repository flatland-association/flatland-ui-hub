import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DispatcherActivityService } from './dispatcher-activity.service';
import { DEFAULT_DISPATCHER, DispatcherEvent, DispatcherState } from './dispatcher';
import { SessionStore } from './session.store';
import { LanguageService } from './i18n/language.service';
import { WebSocketService } from './websocket.service';

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
    mode: 'recommendation', operator_type: 'synthetic_dispatcher', owner: 'synthetic', profile: 'baseline',
    config: structuredClone(DEFAULT_DISPATCHER), status: 'waiting', logical_time: 40, generation: 1,
    run_status: 'running', abort_reason: null, pending: null, observation: null, metrics: {},
    // A fresh/reconnected client receives only the last bounded observation events.
    events: Array.from({ length: 30 }, (_, index) => ({
      seq: index + 20, kind: 'effect_observed', source: 'environment', logical_time: 40, simulation_time: 80,
    })), ...overrides,
  });

  beforeEach(() => {
    actor.set(snapshot({ last_result: structuredClone(receipt) }));
    TestBed.configureTestingModule({ providers: [
      { provide: SessionStore, useValue: { dispatcher: actor, session: signal({ id: 'session' }) } },
      { provide: WebSocketService, useValue: {} },
      { provide: LanguageService, useValue: { t: (key: string) => key } },
    ] });
    service = TestBed.inject(DispatcherActivityService);
  });

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
});
