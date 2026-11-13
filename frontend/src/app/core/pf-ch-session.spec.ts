import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { ApiService } from './api.service';
import { SessionStore } from './session.store';
import { WebSocketService } from './websocket.service';
import { SessionInfo } from './models';
import { restartSessionOpts } from './restart-session-opts';
import { tourById, TOURS } from './demo/tours';
import { LAYOUT_PRESETS } from './layout/layout-presets';

describe('PF-CH RL session lifecycle on main', () => {
  let store: SessionStore;
  let api: ApiService;
  let ws: WebSocketService;
  const session = { id: 'rl', width: 191, height: 9, num_agents: 16 } as SessionInfo;
  let accepted: Subject<{ session_id: string; policy: string }>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [
      ...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting(),
    ] });
    store = TestBed.inject(SessionStore);
    api = TestBed.inject(ApiService);
    ws = TestBed.inject(WebSocketService);
    accepted = new Subject();
    spyOn(api, 'createSession').and.returnValue(of(session));
    spyOn(api, 'setPolicy').and.returnValue(accepted);
    spyOn(api, 'deleteSession').and.returnValue(of({ deleted: true }));
    spyOn(ws, 'connect');
    spyOn(ws, 'disconnect');
    spyOn(store, 'refreshState');
  });

  function open() {
    store.newSession({ pinnedPolicy: 'pf_ch_rl', maxSteps: 320,
      scenarioPresetId: 'pf-ch-corridor-stops', disturbanceIds: ['corridor-shift-incidents'] });
  }

  it('waits for backend acceptance before any opening step or Play', () => {
    spyOn(api, 'step');
    spyOn(api, 'play');
    store.interactionMode.set('director');
    open();
    store.step('pf_ch_rl');
    store.play('pf_ch_rl');
    store.play('deadlock_avoidance');
    store.step('plan');
    expect(api.setPolicy).toHaveBeenCalledOnceWith('rl', 'pf_ch_rl');
    expect(api.step).not.toHaveBeenCalled();
    expect(api.play).not.toHaveBeenCalled();
    expect(ws.connect).not.toHaveBeenCalled();
    accepted.next({ session_id: 'rl', policy: 'pf_ch_rl' });
    expect(ws.connect).toHaveBeenCalledOnceWith('rl');
    expect(store.refreshState).toHaveBeenCalledOnceWith(true);
  });

  it('enables the pinned actor before backend session creation even with old settings', () => {
    store.newSession({ pinnedPolicy: 'pf_ch_rl', policyControlIds: ['plan', 'deadlock_avoidance'] });
    expect(api.createSession).toHaveBeenCalledWith(jasmine.objectContaining({
      enabled_policy_ids: ['plan', 'deadlock_avoidance', 'pf_ch_rl'],
    }));
  });

  it('keeps an unavailable policy stopped without opening under PP', () => {
    open();
    accepted.error(new Error('checkpoint unavailable'));
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.error()).toContain('checkpoint unavailable');
    expect(store.loading()).toBeFalse();
    expect(store.playing()).toBeFalse();
    expect(ws.connect).not.toHaveBeenCalled();
    expect(store.refreshState).not.toHaveBeenCalled();
  });

  it('cancels a pending opening if the catalog no longer offers RL', () => {
    spyOn(api, 'listPolicies').and.returnValue(of([]));
    open();
    store.loadPolicies();
    accepted.next({ session_id: 'rl', policy: 'pf_ch_rl' });
    expect(store.error()).toBeTruthy();
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(ws.connect).not.toHaveBeenCalled();
  });

  it('preserves the RL driver when entering Director and pauses when leaving', () => {
    spyOn(api, 'pause').and.returnValue(of({ session_id: 'rl', playing: false }));
    store.session.set(session);
    store.setActivePolicy('pf_ch_rl');
    store.setInteractionMode('director');
    expect(api.setPolicy).not.toHaveBeenCalled();
    store.playing.set(true);
    store.setInteractionMode('co-learning');
    expect(api.pause).toHaveBeenCalledOnceWith('rl');
    expect(store.activePolicy()).toBe('pf_ch_rl');
    expect(store.playing()).toBeFalse();
  });

  it('ignores stale websocket states from an outgoing session', () => {
    open();
    ws.lastMessage.set({ type: 'state', session_id: 'old', state: { elapsed_steps: 90, agents: [] } as never });
    TestBed.tick();
    expect(store.loading()).toBeTrue();
    expect(store.elapsedSteps()).toBe(0);
  });

  it('keeps Play gated through opening even if a fresh websocket state arrives', () => {
    spyOn(api, 'play');
    open();
    accepted.next({ session_id: 'rl', policy: 'pf_ch_rl' });
    ws.lastMessage.set({ type: 'state', session_id: 'rl', state: { elapsed_steps: 0, agents: [] } as never });
    TestBed.tick();
    store.play('pf_ch_rl');
    expect(api.play).not.toHaveBeenCalled();
    expect(store.loading()).toBeTrue();
  });

  it('shows the server pause after a PP/RL actor switch', () => {
    store.session.set(session);
    store.setActivePolicy('pf_ch_rl');
    store.playing.set(true);
    ws.lastMessage.set({ type: 'play_status', session_id: 'rl', playing: false });
    TestBed.tick();
    expect(store.playing()).toBeFalse();
  });

  it('retains the existing planner selection for ordinary Director sessions', () => {
    (api.setPolicy as jasmine.Spy).and.callFake((session_id, policy) => of({ session_id, policy }));
    store.session.set(session);
    store.setActivePolicy('shortest_path');
    store.setInteractionMode('director');
    expect(api.setPolicy).toHaveBeenCalledWith('rl', 'goal_directed');
    store.setInteractionMode('recommendation');
    expect(api.setPolicy).toHaveBeenCalledWith('rl', 'shortest_path');
  });

  it('releases the outgoing RL environment on restart and keeps the tour inputs', () => {
    open();
    accepted.next({ session_id: 'rl', policy: 'pf_ch_rl' });
    const tour = tourById('pf-ch-rl-corridor')!;
    const opts = restartSessionOpts({ randomEnv: false, opts: {
      pinnedPolicy: tour.backendPolicy, maxSteps: tour.maxEpisodeSteps,
      scenarioPresetId: tour.infrastructureId, disturbanceIds: tour.disturbanceIds,
    } }, {});
    store.newSession(opts);
    expect(api.deleteSession).toHaveBeenCalledOnceWith('rl');
    expect(api.createSession).toHaveBeenCalledWith(jasmine.objectContaining({
      max_episode_steps: 320, scenario_preset_id: 'pf-ch-corridor-stops',
      disturbance_ids: ['corridor-shift-incidents'],
    }));
    expect(api.setPolicy).toHaveBeenCalledTimes(2);
  });

  it('releases an exiting RL demo and ignores its late policy acknowledgement', () => {
    open();
    store.endSession();
    accepted.next({ session_id: 'rl', policy: 'pf_ch_rl' });
    expect(api.deleteSession).toHaveBeenCalledOnceWith('rl');
    expect(store.session()).toBeNull();
    expect(ws.connect).not.toHaveBeenCalled();
  });

  it('cleans a superseded RL session whose create response arrived after exit', () => {
    const created = new Subject<SessionInfo>();
    (api.createSession as jasmine.Spy).and.returnValue(created);
    open();
    store.endSession();
    created.next(session);
    expect(api.deleteSession).toHaveBeenCalledOnceWith('rl');
    expect(api.setPolicy).not.toHaveBeenCalled();
    expect(store.session()).toBeNull();
  });

  it('does not change retention of existing Plan B sessions', () => {
    store.session.set(session);
    store.setActivePolicy('plan');
    store.endSession();
    expect(api.deleteSession).not.toHaveBeenCalled();
  });

  for (const action of ['step', 'play'] as const) {
    it(`does not substitute PP after an RL ${action} failure`, () => {
      spyOn(api, action).and.returnValue(throwError(() => new Error('Policy pf_ch_rl is not enabled')));
      spyOn(api, 'getScenarioPolicies');
      store.session.set(session);
      store.setActivePolicy('pf_ch_rl');
      store[action]('pf_ch_rl');
      expect(api[action]).toHaveBeenCalledTimes(1);
      expect(api.getScenarioPolicies).not.toHaveBeenCalled();
      expect(store.activePolicy()).toBe('pf_ch_rl');
      expect(store.error()).toContain('not enabled');
    });
  }

  it('adds an optional lightweight tour without replacing defaults or Plan B', () => {
    const tour = tourById('pf-ch-rl-corridor')!;
    expect(TOURS[0].id).toBe('three-modes-original');
    expect(tour.backendPolicy).toBe('pf_ch_rl');
    expect(tour.maxEpisodeSteps).toBe(320);
    expect(tour.playSpeedLevel).toBe(4);
    expect(tour.studyLogging).toBeFalse();
    const types = LAYOUT_PRESETS.find(p => p.id === tour.layout)!.layout.columns.flatMap(c => c.panels.map(p => p.type));
    expect(types).toContain('view-tabs');
    expect(types).not.toContain('strategy-options');
    expect(LAYOUT_PRESETS.some(p => p.id === 'preset-plan-b')).toBeTrue();
  });
});
