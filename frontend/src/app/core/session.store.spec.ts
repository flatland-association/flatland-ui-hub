import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject, throwError } from 'rxjs';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { ApiService } from './api.service';
import { SessionStore } from './session.store';
import { ScenarioOption } from './events/event-types';
import { PolicyInfo, SceneGeography, SessionInfo, SessionState, StepResponse } from './models';
import { WebSocketService } from './websocket.service';
import { DEFAULT_DISPATCHER, DispatcherState } from './dispatcher';

describe('SessionStore stepping', () => {
  let store: SessionStore;
  let api: ApiService;
  const state: SessionState = {
    width: 1,
    height: 1,
    num_agents: 0,
    elapsed_steps: 10,
    max_episode_steps: 100,
    agents: [],
    rail_grid: [],
    rail_tiles: [],
    episode_done: false,
  };
  const dispatcher: DispatcherState = {
    mode: 'recommendation', operator_type: 'synthetic_dispatcher', owner: 'synthetic', profile: 'baseline',
    config: DEFAULT_DISPATCHER, status: 'running', logical_time: 0, generation: 0,
    run_status: 'running', abort_reason: null, pending: null, observation: null, metrics: {}, events: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...provideTranslocoTesting(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    store = TestBed.inject(SessionStore);
    api = TestBed.inject(ApiService);
    spyOn(api, 'getGeography').and.returnValue(of({} as SceneGeography));
  });

  for (const n_steps of [1, 10, 50]) {
    it(`runs ${n_steps} steps as one batch and refreshes data once`, () => {
      spyOn(api, 'step').and.returnValue(
        of({ session_id: 'session', elapsed_steps: n_steps, state } as StepResponse),
      );
      spyOn(api, 'getState').and.returnValue(of(state));
      const refreshForecasts = spyOn(store, 'refreshForecasts');

      store.session.set({ id: 'session', width: 1, height: 1, num_agents: 0 });
      store.state.set({ ...state, elapsed_steps: 0 });
      store.step('deadlock_avoidance', n_steps);

      expect(api.step).toHaveBeenCalledOnceWith('session', 'deadlock_avoidance', n_steps);
      expect(api.getState).not.toHaveBeenCalled();
      expect(store.state()).toBe(state);
      expect(refreshForecasts).toHaveBeenCalledTimes(1);
      expect(store.loading()).toBeFalse();
    });
  }

  it('waits for scenarios before requesting recommendations to reuse the rollout', () => {
    const scenarios = new Subject<ScenarioOption[]>();
    const getRecommendations = spyOn(api, 'getRecommendations').and.returnValue(of([]));
    spyOn(api, 'getScenarios').and.returnValue(scenarios);
    spyOn(api, 'getImpact').and.returnValue(of([]));
    spyOn(store, 'refreshContentions');

    store.session.set({ id: 'session', width: 1, height: 1, num_agents: 0 });
    store.refreshForecasts();

    expect(getRecommendations).not.toHaveBeenCalled();
    scenarios.next([]);
    expect(getRecommendations).toHaveBeenCalledTimes(1);
  });

  it('ignores a late creation response after End session', () => {
    const creation = new Subject<ReturnType<SessionStore['session']>>();
    spyOn(api, 'createSession').and.returnValue(creation as ReturnType<ApiService['createSession']>);
    const connect = spyOn(TestBed.inject(WebSocketService), 'connect');
    const refresh = spyOn(store, 'refreshState');
    store.session.set({ id: 'previous', width: 1, height: 1, num_agents: 0 });
    store.newSession();
    expect(store.sessionCreating()).toBeTrue();

    store.endSession();
    creation.next({ id: 'late', width: 1, height: 1, num_agents: 0 });
    expect(store.session()).toBeNull();
    expect(store.sessionCreating()).toBeFalse();
    expect(store.sessionOpening()).toBeFalse();
    expect(connect).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the newest creation pending when an older request fails', () => {
    const older = new Subject<ReturnType<SessionStore['session']>>();
    const newer = new Subject<ReturnType<SessionStore['session']>>();
    spyOn(api, 'createSession').and.returnValues(
      older as ReturnType<ApiService['createSession']>, newer as ReturnType<ApiService['createSession']>,
    );
    const connect = spyOn(TestBed.inject(WebSocketService), 'connect');
    spyOn(store, 'refreshState');
    store.newSession();
    store.newSession();
    older.error(new Error('obsolete failure'));
    expect(store.sessionCreating()).toBeTrue();
    expect(store.loading()).toBeTrue();
    expect(store.error()).toBeNull();

    newer.next({ id: 'newest', width: 1, height: 1, num_agents: 0 });
    expect(store.session()?.id).toBe('newest');
    expect(connect).toHaveBeenCalledOnceWith('newest');
  });

  it('does not let an older successful create replace the newest session', () => {
    const older = new Subject<ReturnType<SessionStore['session']>>();
    const newer = new Subject<ReturnType<SessionStore['session']>>();
    spyOn(api, 'createSession').and.returnValues(
      older as ReturnType<ApiService['createSession']>, newer as ReturnType<ApiService['createSession']>,
    );
    const connect = spyOn(TestBed.inject(WebSocketService), 'connect');
    spyOn(store, 'refreshState');
    store.newSession();
    store.newSession();
    newer.next({ id: 'newest', width: 1, height: 1, num_agents: 0 });
    older.next({ id: 'obsolete', width: 1, height: 1, num_agents: 0 });
    expect(store.session()?.id).toBe('newest');
    expect(connect).toHaveBeenCalledOnceWith('newest');
  });

  it('does not roll back policy or surface an old policy error after a new creation begins', () => {
    const oldPolicy = new Subject<never>();
    spyOn(api, 'setPolicy').and.returnValue(oldPolicy);
    spyOn(api, 'createSession').and.returnValue(new Subject());
    store.session.set({ id: 'previous', width: 1, height: 1, num_agents: 0 });
    store.setInteractionMode('director');
    expect(api.setPolicy).toHaveBeenCalled();
    store.newSession();
    store.setActivePolicy('shortest_path');
    oldPolicy.error(new Error('obsolete policy failure'));
    expect(store.activePolicy()).toBe('shortest_path');
    expect(store.error()).toBeNull();
  });

  it('ignores the late failure of an automatic opening step after End session', () => {
    const openingStep = new Subject<StepResponse>();
    spyOn(api, 'step').and.returnValue(openingStep);
    spyOn(api, 'getState').and.returnValue(of(state));
    spyOn(store, 'refreshForecasts');
    store.session.set({ id: 'opening', width: 1, height: 1, num_agents: 0 });
    store.refreshState(true);
    expect(api.step).toHaveBeenCalledTimes(1);
    expect(store.sessionOpening()).toBeTrue();

    store.endSession();
    openingStep.error(new Error('obsolete automatic step'));
    expect(store.session()).toBeNull();
    expect(store.sessionOpening()).toBeFalse();
    expect(store.loading()).toBeFalse();
    expect(store.error()).toBeNull();
    expect(api.getState).toHaveBeenCalledTimes(1);
  });

  it('does not start a replacement if End session happens while the previous dispatcher stops', () => {
    const stopping = new Subject<DispatcherState>();
    spyOn(api, 'dispatcherStop').and.returnValue(stopping);
    const create = spyOn(api, 'createSession');
    store.session.set({ id: 'previous', width: 1, height: 1, num_agents: 0, dispatcher });
    store.newSession();
    expect(store.dispatcherControlPending()).toBe('stop');
    store.endSession();
    stopping.next(dispatcher);
    expect(create).not.toHaveBeenCalled();
    expect(store.session()).toBeNull();
    expect(store.dispatcherControlPending()).toBeNull();
  });

  it('releases cancelled opening flags if stopping the old session fails', () => {
    const stopping = new Subject<DispatcherState>();
    const openingStep = new Subject<StepResponse>();
    spyOn(api, 'dispatcherStop').and.returnValue(stopping);
    spyOn(api, 'step').and.returnValue(openingStep);
    spyOn(api, 'getState').and.returnValue(of({ ...state, dispatcher }));
    spyOn(store, 'refreshForecasts');
    store.session.set({ id: 'previous', width: 1, height: 1, num_agents: 0, dispatcher });
    store.refreshState(true);
    expect(store.sessionOpening()).toBeTrue();
    expect(store.loading()).toBeTrue();

    store.newSession();
    stopping.error(new Error('stop failed'));
    openingStep.error(new Error('obsolete opening failure'));
    expect(store.session()?.id).toBe('previous');
    expect(store.sessionCreating()).toBeFalse();
    expect(store.sessionOpening()).toBeFalse();
    expect(store.loading()).toBeFalse();
    expect(store.dispatcherControlPending()).toBeNull();
    expect(store.error()).toBe('stop failed');
  });

  it('preserves the selected PF-CH RL driver when entering Director', () => {
    const setPolicy = spyOn(api, 'setPolicy');
    store.session.set({ id: 'rl', width: 191, height: 9, num_agents: 16 });
    store.setActivePolicy('pf_ch_rl');

    store.setInteractionMode('director');

    expect(store.interactionMode()).toBe('director');
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(setPolicy).not.toHaveBeenCalled();
    expect(store.playing()).toBeFalse();
  });

  it('pauses on leaving Director while preserving the PF-CH RL driver', () => {
    const setPolicy = spyOn(api, 'setPolicy');
    spyOn(api, 'pause').and.returnValue(of({ session_id: 'rl', playing: false, busy: false }));
    store.session.set({ id: 'rl', width: 191, height: 9, num_agents: 16 });
    store.setActivePolicy('pf_ch_rl');
    store.setInteractionMode('director');
    store.playing.set(true);

    store.setInteractionMode('co-learning');

    expect(api.pause).toHaveBeenCalledOnceWith('rl');
    expect(store.playing()).toBeFalse();
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.optionPresentation()).toBe('neutral');
    expect(setPolicy).not.toHaveBeenCalled();
  });

  it('still enters Director with its planner and restores a non-RL policy on leaving', () => {
    spyOn(api, 'setPolicy').and.callFake((session_id, policy) => of({ session_id, policy }));
    store.session.set({ id: 'session', width: 1, height: 1, num_agents: 0 });
    store.setActivePolicy('shortest_path');

    store.setInteractionMode('director');
    expect(api.setPolicy).toHaveBeenCalledWith('session', 'goal_directed');
    expect(store.activePolicy()).toBe('goal_directed');
    store.setInteractionMode('recommendation');
    expect(api.setPolicy).toHaveBeenCalledWith('session', 'shortest_path');
    expect(store.activePolicy()).toBe('shortest_path');
  });

  it('waits for the pinned policy before opening a new RL session', () => {
    const accepted = new Subject<{ session_id: string; policy: string }>();
    spyOn(api, 'createSession').and.returnValue(of({
      id: 'rl', width: 191, height: 9, num_agents: 16, has_plan: true, active_policy: 'plan',
    }));
    spyOn(api, 'setPolicy').and.returnValue(accepted);
    const connect = spyOn(TestBed.inject(WebSocketService), 'connect');
    const refresh = spyOn(store, 'refreshState');
    const step = spyOn(api, 'step');
    const play = spyOn(api, 'play');
    store.setInteractionMode('director');

    store.newSession({ scenarioPresetId: 'pf-ch-corridor-stops', policy: 'pf_ch_rl',
      maxSteps: 320, openAtStep: 1, autoPlay: true });

    expect(api.setPolicy).toHaveBeenCalledOnceWith('rl', 'pf_ch_rl');
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.sessionOpening()).toBeTrue();
    store.step('pf_ch_rl');
    store.play('pf_ch_rl');
    expect(step).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    accepted.next({ session_id: 'rl', policy: 'pf_ch_rl' });
    expect(connect).toHaveBeenCalledOnceWith('rl');
    expect(refresh).toHaveBeenCalledOnceWith(true);
  });

  it('does not open or revert to PP if the requested RL policy is unavailable', () => {
    const accepted = new Subject<{ session_id: string; policy: string }>();
    spyOn(api, 'createSession').and.returnValue(of({
      id: 'rl', width: 191, height: 9, num_agents: 16, has_plan: true, active_policy: 'plan',
    }));
    spyOn(api, 'setPolicy').and.returnValue(accepted);
    const connect = spyOn(TestBed.inject(WebSocketService), 'connect');
    const refresh = spyOn(store, 'refreshState');
    const step = spyOn(api, 'step');
    const play = spyOn(api, 'play');

    store.newSession({ policy: 'pf_ch_rl', openAtStep: 1, autoPlay: true });
    accepted.error(new Error('PF-CH checkpoint unavailable'));

    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.error()).toContain('PF-CH checkpoint unavailable');
    expect(store.sessionOpening()).toBeFalse();
    expect(store.loading()).toBeFalse();
    expect(store.playing()).toBeFalse();
    expect(connect).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(step).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores a policy acknowledgement after the requested session ended', () => {
    const accepted = new Subject<{ session_id: string; policy: string }>();
    spyOn(api, 'createSession').and.returnValue(of({ id: 'rl', width: 191, height: 9, num_agents: 16 }));
    spyOn(api, 'setPolicy').and.returnValue(accepted);
    const connect = spyOn(TestBed.inject(WebSocketService), 'connect');
    const refresh = spyOn(store, 'refreshState');
    store.newSession({ policy: 'pf_ch_rl' });
    store.endSession();

    accepted.next({ session_id: 'rl', policy: 'pf_ch_rl' });

    expect(store.session()).toBeNull();
    expect(connect).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not recover a failed RL step using an enabled PP policy', () => {
    spyOn(api, 'step').and.returnValue(throwError(() => new Error('Policy pf_ch_rl is not enabled')));
    const fallback = spyOn(api, 'getScenarioPolicies');
    store.session.set({ id: 'rl', width: 191, height: 9, num_agents: 16 });
    store.setActivePolicy('pf_ch_rl');

    store.step('pf_ch_rl');

    expect(api.step).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.error()).toContain('not enabled');
    expect(store.loading()).toBeFalse();
  });

  it('does not recover failed RL playback using an enabled PP policy', () => {
    spyOn(api, 'play').and.returnValue(throwError(() => new Error('Policy pf_ch_rl is not enabled')));
    const fallback = spyOn(api, 'getScenarioPolicies');
    store.session.set({ id: 'rl', width: 191, height: 9, num_agents: 16 });
    store.setActivePolicy('pf_ch_rl');

    store.play('pf_ch_rl');

    expect(api.play).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.error()).toContain('not enabled');
    expect(store.playing()).toBeFalse();
  });

  it('keeps an unavailable RL selection when an older server offers only the planner', () => {
    const planner: PolicyInfo = {
      id: 'goal_directed', label: 'Planner', description: '', is_default: true, show_in_ui: true,
      supports_scenarios: true, family: 'hybrid', deterministic: true, role: 'operational',
      observation: '', at_conflict: '', provenance: '', licence: '', grounding: '',
    };
    spyOn(api, 'listPolicies').and.returnValue(of([planner]));
    const accepted = new Subject<{ session_id: string; policy: string }>();
    spyOn(api, 'createSession').and.returnValue(of({ id: 'rl', width: 191, height: 9, num_agents: 16 }));
    spyOn(api, 'setPolicy').and.returnValue(accepted);
    const connect = spyOn(TestBed.inject(WebSocketService), 'connect');
    const refresh = spyOn(store, 'refreshState');
    store.newSession({ policy: 'pf_ch_rl', autoPlay: true });

    store.loadPolicies();
    accepted.next({ session_id: 'rl', policy: 'pf_ch_rl' });

    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.error()).toBeTruthy();
    expect(store.sessionOpening()).toBeFalse();
    expect(store.loading()).toBeFalse();
    expect(connect).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('pauses an active RL session if its policy disappears from the catalog', () => {
    spyOn(api, 'listPolicies').and.returnValue(of([]));
    spyOn(api, 'pause').and.returnValue(of({ session_id: 'rl', playing: false, busy: false }));
    store.session.set({ id: 'rl', width: 191, height: 9, num_agents: 16 });
    store.setActivePolicy('pf_ch_rl');
    store.playing.set(true);

    store.loadPolicies();

    expect(api.pause).toHaveBeenCalledOnceWith('rl');
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.playing()).toBeFalse();
    expect(store.error()).toBeTruthy();
  });
});

/** A run error: the server's play loop raised and sent a WebSocket `error`
 *  (docs/plans/toolbar-under-guide.md D7, D12). */
describe('SessionStore — run errors', () => {
  let store: SessionStore;
  let ws: WebSocketService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    ws = TestBed.inject(WebSocketService);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.playing.set(true);
  });

  it('stops the run and remembers the error, apart from other failures', () => {
    store.error.set('Forecast failed');
    TestBed.tick();
    expect(store.runError()).toBeNull();

    ws.messages.next({ type: 'error', message: 'policy raised' } as never);
    TestBed.tick();
    expect(store.playing()).toBeFalse();
    expect(store.runError()?.message).toBe('policy raised');
    expect(store.runError()?.simStep).toBe(0);
  });

  it('forgets it when the session ends', () => {
    ws.messages.next({ type: 'error', message: 'x' } as never);
    TestBed.tick();
    store.endSession();
    expect(store.runError()).toBeNull();
  });
});
