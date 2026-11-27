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
import { proposalSnapshot } from '../testing/proposal-snapshot';
import { DECISION_LOG_CAP } from './decision-log';
import type { ContentionGroup, ContentionsResponse } from './events/event-types';
import { DEFAULT_DISPATCHER, DispatcherState } from './dispatcher';

describe('SessionStore — selected forecast contention', () => {
  let store: SessionStore;
  let responses: Subject<ContentionsResponse>[];
  let getContentions: jasmine.Spy;
  const group: ContentionGroup = { kind: 'blocked', step: 10, position: [1, 2], handles: [1, 2] };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    responses = [];
    getContentions = spyOn(TestBed.inject(ApiService), 'getContentions').and.callFake(() => {
      const response = new Subject<ContentionsResponse>();
      responses.push(response);
      return response;
    });
    store.contentions.set([group]);
    store.selectedContention.set(group);
  });

  it('updates the selection from a unique matching forecast and clears ambiguous or missing matches', () => {
    store.refreshContentions();
    const updated = { ...group, step: 12, handles: [2, 1] };
    responses[0].next({ groups: [updated], horizonSteps: 50 });
    expect(store.selectedContention()).toBe(updated);
    store.refreshContentions();
    responses[1].next({ groups: [updated, { ...updated, step: 13 }], horizonSteps: 50 });
    expect(store.selectedContention()).toBeNull();
    store.selectedContention.set(updated);
    store.refreshContentions();
    responses[2].next({ groups: [], horizonSteps: 50 });
    expect(store.selectedContention()).toBeNull();
  });

  it('deduplicates refreshes from ZWL instances and ignores out-of-order results', () => {
    store.refreshContentionsForZwl('sess-1', 0);
    store.refreshContentionsForZwl('sess-1', 0);
    expect(getContentions).toHaveBeenCalledTimes(1);
    store.refreshContentionsForZwl('sess-1', 3);
    responses[1].next({ groups: [], horizonSteps: 50 });
    responses[0].next({ groups: [group], horizonSteps: 50 });
    expect(store.contentions()).toEqual([]);
    expect(store.selectedContention()).toBeNull();
  });

  it('reports a failed refresh without pretending the last result is fresh', () => {
    store.refreshContentions();
    responses[0].error(new Error('offline'));
    expect(store.contentionRefreshFailed()).toBeTrue();
    expect(store.selectedContention()).toBe(group);
  });
});

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

  describe('prepared Director outcome view lifecycle', () => {
    const completedActor = (): DispatcherState => ({
      ...dispatcher, mode: 'director', profile: 'goal-switch', run_status: 'finished', generation: 1,
      config: { ...DEFAULT_DISPATCHER, profile: 'goal-switch', comparison: true },
      metrics: { arrived: 3, total_trains: 3, simulation_steps: 82 },
      comparison: { phase: 'committed', session_id: 'outcome', command_id: 'switch', generation: 0, step: 1,
        validation: { accepted: true, reason: 'verified', arrived: 3, total: 3 } },
    });
    const finish = (value = completedActor(), operatorType = 'synthetic_dispatcher') => {
      store.interactionMode.set('director');
      store.session.set({ id: 'outcome', width: 1, height: 1, num_agents: 3, operator_type: operatorType, dispatcher: value });
      store.state.set({ ...state, elapsed_steps: 82, episode_done: true, dispatcher: value });
    };

    it('keeps the map on automatic completion for the committed current Director comparison', () => {
      finish();
      expect(store.episodeDone()).toBeTrue();
      expect(store.shiftEnded()).toBeFalse();
      expect(store.shiftReviewOpen()).toBeFalse();
      // The result may be partial or mixed; those outcomes still belong beside
      // the map rather than being replaced by a generic review screen.
      finish({ ...completedActor(), operator_type: 'mixed', mixed: true, owner: 'human', generation: 2,
        metrics: { arrived: 2, total_trains: 3, simulation_steps: 82 } });
      expect(store.shiftReviewOpen()).toBeFalse();
    });

    it('keeps explicit End shift authoritative and allows its existing reopen action', () => {
      finish();
      const stop = spyOn(store, 'stopDispatcher');
      store.endShift();
      expect(stop).toHaveBeenCalledTimes(1);
      expect(store.shiftEnded()).toBeTrue();
      expect(store.shiftReviewOpen()).toBeTrue();
      store.state.update(value => ({ ...value!, episode_done: false }));
      expect(store.shiftReviewOpen()).toBeTrue();
      store.state.update(value => ({ ...value!, episode_done: true }));
      store.reopenShift();
      expect(store.shiftEnded()).toBeFalse();
      expect(store.shiftReviewOpen()).toBeFalse();
    });

    it('preserves ordinary modes and requires both the current UI mode and the actor Director mode', () => {
      finish();
      for (const mode of ['recommendation', 'co-learning'] as const) {
        store.interactionMode.set(mode);
        expect(store.shiftReviewOpen()).withContext(mode).toBeTrue();
      }
      store.interactionMode.set('director');
      finish({ ...completedActor(), mode: 'recommendation' });
      expect(store.shiftReviewOpen()).toBeTrue();
      finish({ ...completedActor(), mode: 'co-learning' });
      expect(store.shiftReviewOpen()).toBeTrue();
      const ordinary = completedActor(); ordinary.config = { ...ordinary.config, comparison: false };
      finish(ordinary);
      expect(store.shiftReviewOpen()).toBeTrue();
    });

    it('preserves Human and Team review and does not infer a synthetic session from stale actor data', () => {
      for (const role of ['human', 'human_dispatcher_team']) {
        finish({ ...completedActor(), operator_type: role }, role);
        expect(store.shiftReviewOpen()).withContext(role).toBeTrue();
        finish(completedActor(), role);
        expect(store.shiftReviewOpen()).withContext('creation role ' + role).toBeTrue();
      }
      finish({ ...completedActor(), operator_type: 'human_dispatcher_team' });
      expect(store.shiftReviewOpen()).toBeTrue();
    });

    it('does not retain a pre-commit, cancelled or unrelated comparison', () => {
      for (const phase of ['waiting', 'preparing', 'ready', 'unavailable', 'cancelled'] as const) {
        const value = completedActor(); value.comparison = { ...value.comparison!, phase };
        finish(value);
        expect(store.shiftReviewOpen()).withContext(phase).toBeTrue();
      }
      const other = completedActor(); other.comparison!.session_id = 'another-session';
      finish(other);
      expect(store.shiftReviewOpen()).toBeTrue();
      finish({ ...completedActor(), comparison: null });
      expect(store.shiftReviewOpen()).toBeTrue();
    });

    it('preserves the guided tour and experiment review lifecycle', () => {
      finish();
      store.demoActive.set(true);
      expect(store.shiftReviewOpen()).toBeTrue();
      store.demoActive.set(false);
      expect(store.shiftReviewOpen()).toBeFalse();
    });

    it('releases retained results on a reset frame or a different current session', () => {
      finish();
      store.state.set({ ...state, elapsed_steps: 0, episode_done: false, dispatcher: { ...completedActor(), comparison: null } });
      expect(store.shiftReviewOpen()).toBeFalse();
      store.state.set({ ...state, episode_done: true, dispatcher: { ...completedActor(), comparison: null } });
      expect(store.shiftReviewOpen()).toBeTrue();
      finish();
      store.session.update(value => ({ ...value!, id: 'next-session' }));
      expect(store.shiftReviewOpen()).toBeTrue();
      store.session.set(null);
      expect(store.shiftReviewOpen()).toBeTrue();
    });
  });

  it('passes the revocable comparison resume capability through the existing Play request', () => {
    const play = spyOn(api, 'play').and.returnValue(of({ session_id: 'session', playing: true }));
    store.session.set({ id: 'session', width: 1, height: 1, num_agents: 0 });
    store.state.set(state);
    store.directorComparisonLauncher.set('session');
    store.play('goal_directed', 1, 'automatic', 'resume-capability');
    expect(play).toHaveBeenCalledOnceWith('session', { speed: 1, policy: 'goal_directed', comparison_token: 'resume-capability' });
    expect(store.directorComparisonLauncher()).toBe('session');
    store.play('goal_directed', 1);
    expect(play.calls.mostRecent().args[1]).toEqual({ speed: 1, policy: 'goal_directed' });
    expect(store.directorComparisonLauncher()).toBeNull();
  });

  for (const comparison of [true, false]) {
    it(`${comparison ? 'starts the prepared comparison at its checkpoint' : 'keeps the ordinary opening movement requirement'} before another startup step`, () => {
      const config = { ...DEFAULT_DISPATCHER, profile: 'goal-switch' as const, comparison, switch_at: 2 };
      const initialActor: DispatcherState = { ...dispatcher, mode: 'director', profile: 'goal-switch', config, run_status: 'ready' };
      const checkpointActor: DispatcherState = { ...initialActor, run_status: 'running', logical_time: 1 };
      const session = { id: 'opening', width: 1, height: 1, num_agents: 0, active_policy: 'goal_directed', dispatcher: initialActor };
      spyOn(api, 'createSession').and.returnValue(of(session));
      spyOn(TestBed.inject(WebSocketService), 'connect');
      spyOn(store, 'refreshForecasts');
      spyOn(api, 'getState').and.returnValues(
        of({ ...state, elapsed_steps: 0, dispatcher: initialActor }),
        of({ ...state, elapsed_steps: 1, dispatcher: checkpointActor }),
      );
      const openingStep = new Subject<StepResponse>();
      const step = spyOn(api, 'step').and.returnValue(openingStep);
      const play = spyOn(api, 'play').and.returnValue(of({ session_id: 'opening', playing: true }));
      store.newSession({ dispatcher: config, interactionMode: 'director', autoPlay: true, openAtStep: 1 });
      expect(step).toHaveBeenCalledTimes(1);
      expect(play).not.toHaveBeenCalled();
      // There are no moving agents at this checkpoint. Only the bounded recipe
      // may finish opening here; all ordinary sessions still wait for movement.
      openingStep.next({ session_id: 'opening', elapsed_steps: 1 } as StepResponse);
      expect(store.state()?.elapsed_steps).toBe(1);
      expect(step).toHaveBeenCalledTimes(comparison ? 1 : 2);
      expect(play).toHaveBeenCalledTimes(comparison ? 1 : 0);
      expect(store.sessionOpening()).toBe(!comparison);
      if (comparison) expect(play.calls.first().args[0]).toBe('opening');
    });
  }

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

/** Open reflections without the pause (docs/plans/reflection-inline.md §4.1):
 *  decisions overlap, so none may be lost or replace the one being typed. */
describe('SessionStore — open reflections', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(true);
  });

  const decide = (handle: number) => store.recordProposalChoice(handle, 'proceed');
  const seqs = () => store.openReflections().map((r) => r.handle);

  it('shows the first decision and lets a second one wait', () => {
    decide(0);
    decide(1);
    expect(seqs()).toEqual([0, 1]);
    expect(store.pendingRationale()?.handle).toBe(0);
  });

  it('shows the waiting one once the shown one is answered, and stamps the answer', () => {
    decide(0);
    decide(1);
    const first = store.pendingRationale()!.decisionSeq;
    store.submitRationale({ rationale: 'x', response: 'yes' });
    expect(seqs()).toEqual([1]);
    expect(store.pendingRationale()?.handle).toBe(1);
    const entry = store.decisionLog().find((e) => e.seq === first)!;
    expect(entry.reflectedAt).toEqual(jasmine.any(Number));
    expect(entry.reflectedAtStep).toBe(0);
  });

  it('counts a bare «Nein» as answered (Q2)', () => {
    decide(0);
    store.submitRationale({ rationale: '', response: 'no' });
    expect(store.openReflections()).toEqual([]);
  });

  it('keeps a closed reflection open and offers it back by decision', () => {
    decide(0);
    const seq = store.pendingRationale()!.decisionSeq;
    store.dismissRationale();
    expect(store.pendingRationale()).toBeNull();
    expect(store.canReopenRationale()).toBeTrue();
    expect(store.openReflectionSeqs().has(seq)).toBeTrue();
    store.reopenRationale(seq);
    expect(store.pendingRationale()?.decisionSeq).toBe(seq);
  });

  it('shows a waiting decision when the shown one is closed, but not the closed one again', () => {
    decide(0);
    decide(1);
    store.dismissRationale();
    expect(store.pendingRationale()?.handle).toBe(1);
    store.dismissRationale();
    expect(store.pendingRationale()).toBeNull();
    store.reopenRationale();
    expect(store.pendingRationale()?.handle).toBe(1);
  });

  it('refuses to finish while reflections are open, and forgets the refusal once they are answered', () => {
    expect(store.refuseFinishForOpenReflections()).toBeFalse();
    decide(0);
    expect(store.refuseFinishForOpenReflections()).toBeTrue();
    expect(store.reflectionsMissing()).toBe(1);
    store.submitRationale({ rationale: 'x', response: 'once' });
    TestBed.tick();
    expect(store.reflectionsMissing()).toBe(0);
  });

  it('counts the missing reflections down as they are answered, not the ones decided later', () => {
    decide(0);
    decide(1);
    decide(2);
    store.refuseFinishForOpenReflections();
    expect(store.reflectionsMissing()).toBe(3);
    store.submitRationale({ rationale: 'x', response: 'once' });
    store.submitRationale({ rationale: 'x', response: 'once' });
    expect(store.reflectionsMissing()).toBe(1);
    decide(3);
    expect(store.reflectionsMissing()).toBe(1);
    store.submitRationale({ rationale: 'x', response: 'once' });
    expect(store.reflectionsMissing()).toBe(0);
  });

  it('starts a new leg without open reflections', () => {
    decide(0);
    store.refuseFinishForOpenReflections();
    store.clearDecisionLog();
    expect(store.openReflections()).toEqual([]);
    expect(store.pendingRationale()).toBeNull();
    expect(store.reflectionsMissing()).toBe(0);
  });

  // docs/plans/reflection-inline.md D16: no panel in the layout can show it.
  it('asks nothing where no place can show it, but still logs the decision', () => {
    store.reflectionPlaceInLayout.set(false);
    decide(0);
    expect(store.openReflections()).toEqual([]);
    expect(store.pendingRationale()).toBeNull();
    expect(store.decisionLog().length).toBe(1);
  });

  it('asks nothing in Director', () => {
    store.interactionMode.set('director');
    decide(0);
    expect(store.openReflections()).toEqual([]);
  });
});

/** Outside a tour that asks for reasons the prompt asks about the latest
 *  decision only, as before the reflection moved into the decision panel
 *  (docs/plans/reflection-inline.md §4.1). */
describe('SessionStore — reflections without a queue', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
  });

  const decide = (handle: number) => store.recordProposalChoice(handle, 'proceed');

  it('asks about the latest decision: a new one replaces the shown one', () => {
    decide(0);
    decide(1);
    expect(store.pendingRationale()?.handle).toBe(1);
    expect(store.openReflections().map((r) => r.handle)).toEqual([1]);
  });

  it('drops a closed prompt, so nothing stays open', () => {
    decide(0);
    store.dismissRationale();
    expect(store.pendingRationale()).toBeNull();
    expect(store.openReflections()).toEqual([]);
    expect(store.canReopenRationale()).toBeFalse();
  });

  it('derives the shown reflection from the list: an emptied log shows none', () => {
    decide(0);
    store.clearDecisionLog();
    expect(store.pendingRationale()).toBeNull();
  });
});

/** What «Handlungsoptionen» showed, kept per decision for its reflection
 *  (docs/plans/reflection-inline.md §4.8, D26). */
describe('SessionStore — decided options', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
  });

  it('files them under the newest decision taken in the panel for that train, without the map data', () => {
    store.recordProposalChoice(0, 'proceed');
    store.recordProposalChoice(0, 'accept');
    store.keepProposalSnapshot(proposalSnapshot('ai'));
    const seq = store.decisionLog().at(-1)!.seq;
    const kept = store.proposalSnapshots().get(seq)!;
    expect(store.proposalSnapshots().size).toBe(1);
    expect(kept.applied).toBe('ai');
    expect(kept.result.variants.every((v) => v.trajectories === undefined)).toBeTrue();
    expect(kept.result.ai_alternatives).toEqual([]);
  });

  it('keeps nothing without such a decision, and forgets them with the log', () => {
    store.keepProposalSnapshot(proposalSnapshot());
    expect(store.proposalSnapshots().size).toBe(0);
    store.recordProposalChoice(0, 'proceed');
    store.keepProposalSnapshot(proposalSnapshot());
    store.clearDecisionLog();
    expect(store.proposalSnapshots().size).toBe(0);
  });
});

describe('SessionStore — unsent reflections', () => {
  let store: SessionStore;
  const draft = { factors: ['delay'], gut: 'fit', missing: [], tradeoff: 'x' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(true);
  });

  it('keeps a draft per decision until its reflection is sent, or the log is cleared', () => {
    store.recordProposalChoice(0, 'proceed');
    store.recordProposalChoice(1, 'proceed');
    const [first, second] = store.openReflections().map((r) => r.decisionSeq);
    store.keepReflectionDraft(first, draft);
    store.keepReflectionDraft(second, draft);
    store.dismissRationale();
    expect(store.reflectionDraft(first)).withContext('closed, not sent').toEqual(draft);
    store.reopenRationale(first);
    store.submitRationale({ rationale: '', response: 'no' });
    expect(store.reflectionDraft(first)).toBeNull();
    expect(store.reflectionDraft(second)).toEqual(draft);
    store.clearDecisionLog();
    expect(store.reflectionDraft(second)).toBeNull();
  });

  it('forgets the draft of a reflection that is dropped, outside reason tours', () => {
    store.queueReflections.set(false);
    store.recordProposalChoice(0, 'proceed');
    const first = store.pendingRationale()!.decisionSeq;
    store.keepReflectionDraft(first, draft);
    store.recordProposalChoice(1, 'proceed');
    expect(store.reflectionDraft(first)).withContext('replaced by the next decision').toBeNull();
    const second = store.pendingRationale()!.decisionSeq;
    store.keepReflectionDraft(second, draft);
    store.dismissRationale();
    expect(store.reflectionDraft(second)).withContext('closed with ×').toBeNull();
  });

  it('forgets drafts and decided options of entries cut from the log', () => {
    store.recordProposalChoice(0, 'proceed');
    const first = store.decisionLog()[0].seq;
    store.keepReflectionDraft(first, draft);
    store.keepProposalSnapshot(proposalSnapshot());
    for (let i = 0; i < DECISION_LOG_CAP; i++) store.recordProposalChoice(1, 'proceed');
    expect(store.decisionLog()[0].seq).toBeGreaterThan(first);
    expect(store.reflectionDraft(first)).toBeNull();
    expect(store.proposalSnapshots().has(first)).toBeFalse();
  });

  it('sets the shown reflection aside without showing the next one, keeping its draft', () => {
    store.recordProposalChoice(0, 'proceed');
    store.recordProposalChoice(1, 'proceed');
    const [first] = store.openReflections().map((r) => r.decisionSeq);
    store.keepReflectionDraft(first, draft);
    store.setAsideRationale();
    expect(store.pendingRationale()).toBeNull();
    expect(store.openReflections().length).toBe(2);
    expect(store.reflectionDraft(first)).toEqual(draft);
    store.reopenRationale(first);
    expect(store.pendingRationale()?.decisionSeq).toBe(first);
  });
});
