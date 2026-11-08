import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { ApiService } from './api.service';
import { DispatcherActivityService } from './dispatcher-activity.service';
import { DEFAULT_DISPATCHER, DispatcherState } from './dispatcher';
import { AgentDTO, SceneGeography, SessionState } from './models';
import { SessionStore } from './session.store';
import { WebSocketService, WSMessage } from './websocket.service';

/** Only the browser transport is controlled; parsing, message delivery and
 *  SessionStore's handlers are the actual application services. */
class QueuedSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static current: QueuedSocket;
  readyState = QueuedSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(_url: string) { QueuedSocket.current = this; }
  close(): void { this.readyState = 3; }
  open(): void { this.readyState = QueuedSocket.OPEN; this.onopen?.(); }
  frame(message: WSMessage): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

function dispatcher(finished: boolean): DispatcherState {
  return {
    mode: 'recommendation', operator_type: 'synthetic_dispatcher', owner: 'agent', profile: 'baseline',
    config: DEFAULT_DISPATCHER, status: 'waiting', logical_time: finished ? 172 : 171, generation: 1,
    run_status: finished ? 'finished' : 'running', abort_reason: null,
    pending: null, observation: null, metrics: {}, events: [{
      seq: finished ? 2 : 1, kind: 'observation', source: 'environment',
      logical_time: finished ? 172 : 171, simulation_time: finished ? 172 : 171,
    }],
  };
}

function state(finished: boolean): SessionState {
  const agents: AgentDTO[] = Array.from({ length: 16 }, (_, handle) => ({
    handle, position: null, direction: 0, initial_position: [0, 0], initial_direction: 0, target: [0, 0],
    state: finished || handle < 15 ? 'DONE' : 'MOVING', speed: 1,
    earliest_departure: 0, latest_arrival: 200, eta_to_depart: null, time_to_deadline: null,
    delay: 0, is_visible: false, delay_color_intensity: 0, cell_type: 'DONE', next_decision: null,
    override_action: null, malfunction_remaining: 0, is_malfunctioning: false,
  }));
  return {
    width: 1, height: 1, num_agents: 16, elapsed_steps: finished ? 172 : 171,
    max_episode_steps: 320, agents, rail_grid: [], rail_tiles: [], episode_done: finished,
    dispatcher: dispatcher(finished), active_policy: 'plan', playing: !finished, busy: false,
  };
}

describe('SessionStore ordered WebSocket states', () => {
  let store: SessionStore;
  let ws: WebSocketService;
  let socket: QueuedSocket;
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = window.WebSocket;
    window.WebSocket = QueuedSocket as unknown as typeof WebSocket;
    TestBed.configureTestingModule({ providers: [
      ...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting(),
    ] });
    store = TestBed.inject(SessionStore);
    ws = TestBed.inject(WebSocketService);
    spyOn(TestBed.inject(ApiService), 'getGeography').and.returnValue(of({} as SceneGeography));
    store.session.set({ id: 'shift', width: 1, height: 1, num_agents: 16 });
    ws.connect('shift');
    socket = QueuedSocket.current;
    socket.open();
    socket.frame({ type: 'state', session_id: 'shift', state: state(false) });
    TestBed.tick();
    expect(store.elapsedSteps()).toBe(171);
    expect(store.agents().filter(agent => agent.state === 'DONE').length).toBe(15);
  });

  afterEach(() => {
    ws.disconnect();
    window.WebSocket = originalWebSocket;
  });

  it('retains the final state when playback and episode notifications arrive before change detection', () => {
    const activity = TestBed.inject(DispatcherActivityService);
    // These are separate transport frames, queued before Angular flushes.
    socket.frame({ type: 'state', session_id: 'shift', state: state(true) });
    socket.frame({ type: 'play_status', session_id: 'shift', playing: false, busy: false });
    socket.frame({ type: 'episode_done', session_id: 'shift' });
    expect(ws.stateReceipt()?.revision).toBe(2);
    TestBed.tick();

    expect(store.elapsedSteps()).toBe(172);
    expect(store.agents().filter(agent => agent.state === 'DONE').length).toBe(16);
    expect(store.episodeDone()).toBeTrue();
    expect(store.dispatcher()?.run_status).toBe('finished');
    expect(activity.live().state).toBe('finished');
    expect(store.playing()).toBeFalse();
  });

  it('ignores old-session frames during replacement creation without replaying them afterward', () => {
    store.sessionCreating.set(true);
    socket.frame({ type: 'state', session_id: 'shift', state: state(true) });
    socket.frame({ type: 'play_status', session_id: 'shift', playing: false, busy: false });
    TestBed.tick();
    expect(store.elapsedSteps()).toBe(171);
    expect(store.playing()).toBeTrue();
    store.sessionCreating.set(false);
    TestBed.tick();
    expect(store.elapsedSteps()).toBe(171);
    expect(store.episodeDone()).toBeFalse();
  });

  it('keeps handover pending until its acknowledgement and rejects a stale ownership state', () => {
    const acknowledgement = new Subject<DispatcherState>();
    spyOn(TestBed.inject(ApiService), 'dispatcherOwnership').and.returnValue(acknowledgement);
    store.dispatcherOwnership('human');
    socket.frame({ type: 'play_status', session_id: 'shift', playing: false, busy: true });
    expect(store.dispatcherControlPending()).toBe('ownership');
    expect(store.dispatcher()?.owner).toBe('agent');
    expect(store.playing()).toBeTrue();
    expect(store.backendBusy()).toBeTrue();

    acknowledgement.next({ ...dispatcher(false), owner: 'human', generation: 2 });
    expect(store.dispatcherControlPending()).toBeNull();
    expect(store.dispatcher()?.owner).toBe('human');
    expect(store.playing()).toBeFalse();
    expect(store.backendBusy()).toBeFalse();
    const stale = state(false);
    stale.elapsed_steps = 170;
    socket.frame({ type: 'state', session_id: 'shift', state: stale });
    TestBed.tick();
    expect(store.elapsedSteps()).toBe(171);
    expect(store.dispatcher()?.owner).toBe('human');
    expect(store.playing()).toBeFalse();
  });

  it('keeps the authoritative error state when its text notification follows immediately', () => {
    const failed = state(false);
    failed.elapsed_steps = 172;
    failed.dispatcher = { ...dispatcher(false), run_status: 'error', abort_reason: 'Planner failed' };
    socket.frame({ type: 'state', session_id: 'shift', state: failed });
    socket.frame({ type: 'error', session_id: 'shift', message: 'Planner failed' });
    TestBed.tick();
    expect(store.elapsedSteps()).toBe(172);
    expect(store.dispatcher()?.run_status).toBe('error');
    expect(store.error()).toBe('Planner failed');
    expect(store.playing()).toBeFalse();
  });

  it('releases the ordered subscription when the store is destroyed', () => {
    TestBed.resetTestingModule();
    socket.frame({ type: 'state', session_id: 'shift', state: state(true) });
    expect(store.elapsedSteps()).toBe(171);
    expect(store.episodeDone()).toBeFalse();
  });
});
