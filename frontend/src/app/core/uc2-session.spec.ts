import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { ApiService } from './api.service';
import { STUDY_CONDITIONS } from './demo/study-conditions';
import { TOURS, UC2_RL_TOURS, tourById } from './demo/tours';
import { LAYOUT_PRESETS } from './layout/layout-presets';
import { isFixedActorPolicy, PolicyInfo, SessionInfo } from './models';
import { restartSessionOpts } from './restart-session-opts';
import { SessionStore } from './session.store';
import { WebSocketService } from './websocket.service';

const NATIVE_DEMOS = [
  ['uc2-rl-tutorial', 'tutorial'], ['uc2-rl-1', 'uc2-1'], ['uc2-rl-2', 'uc2-2'],
  ['uc2-rl-3', 'uc2-3'], ['uc2-rl-4', 'uc2-4'],
];

describe('UC2 RL tours stay separate from participant conditions', () => {
  it('offers exactly the five named native fixtures without overriding their limits or faults', () => {
    expect(UC2_RL_TOURS.length).toBe(5);
    expect(TOURS.filter(tour => tour.backendPolicy === 'uc2_rl')).toEqual(UC2_RL_TOURS);
    for (const [id, preset] of NATIVE_DEMOS) {
      const tour = tourById(id)!;
      expect(tour.infrastructureId).withContext(id).toBe(preset);
      expect(tour.backendPolicy).toBe('uc2_rl');
      expect(tour.layout).toBe('preset-uc2-rl');
      expect(tour.modes).toEqual(['director']);
      expect(tour.maxEpisodeSteps).toBeUndefined();
      expect(tour.disturbanceIds).toBeUndefined();
      expect(tour.legDisturbanceIds).toBeUndefined();
      expect(tour.live).toBeUndefined();
      expect(tour.openAtStep).toBeUndefined();
      expect(tour.surveyAfterEachMode).toBeFalse();
      expect(tour.studyLogging).toBeFalse();
    }
  });

  it('preserves all ten Plan B participant conditions and their DLA driver', () => {
    const conditions = STUDY_CONDITIONS.filter(condition => /^plan-b-p\d\d$/.test(condition.id ?? ''));
    expect(conditions.length).toBe(10);
    for (const condition of conditions) {
      expect(condition.policy).toBe('deadlock_avoidance');
      expect(condition.layoutId).toBe('preset-plan-b');
      expect(condition.mode).toBe('co-learning');
      expect(condition.studyLogging).toBeTrue();
      expect(condition.legs?.[0].scenarioId).toBe('tutorial');
      expect(condition.legs?.slice(1).map(leg => leg.scenarioId).sort()).toEqual(['uc2-1', 'uc2-2', 'uc2-3', 'uc2-4']);
    }
    expect(isFixedActorPolicy('deadlock_avoidance')).toBeFalse();
    expect(isFixedActorPolicy('goal_directed')).toBeFalse();
  });

  it('reuses compact supervision without adding Director PP strategy surfaces', () => {
    const layout = LAYOUT_PRESETS.find(preset => preset.id === 'preset-uc2-rl')!;
    const old = LAYOUT_PRESETS.find(preset => preset.id === 'preset-pf-ch-rl')!;
    const panels = layout.layout.columns.flatMap(column => column.panels);
    expect(panels.map(panel => panel.type)).toEqual(['situation-summary', 'notifications', 'view-tabs', 'agent-inspector']);
    const oldIds = new Set(old.layout.columns.flatMap(column => column.panels.map(panel => panel.id)));
    expect(panels.some(panel => oldIds.has(panel.id))).toBeFalse();
    expect(panels[2].settings).not.toBe(old.layout.columns[1].panels[0].settings);
  });
});

describe('UC2 RL native session lifecycle', () => {
  let store: SessionStore;
  let api: ApiService;
  let ws: WebSocketService;
  let accepted: Subject<{ session_id: string; policy: string }>;
  const session = { id: 'uc2', width: 78, height: 8, num_agents: 3, scenario_preset_id: 'uc2-3',
    has_plan: true, active_policy: 'plan' } as SessionInfo;

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

  function open(preset = 'uc2-3') {
    store.interactionMode.set('director');
    store.newSession({ pinnedPolicy: 'uc2_rl', scenarioPresetId: preset,
      policyControlIds: ['deadlock_avoidance'] });
  }

  it('sends each exact native preset without horizon, speed or malfunction overrides', () => {
    for (const [, preset] of NATIVE_DEMOS) {
      open(preset);
      const payload = (api.createSession as jasmine.Spy).calls.mostRecent().args[0];
      expect(payload.scenario_preset_id).toBe(preset);
      expect(payload.enabled_policy_ids).toEqual(['deadlock_avoidance', 'uc2_rl']);
      for (const field of ['max_episode_steps', 'speed_profile', 'malfunction_rate', 'disturbance_ids']) {
        expect(payload[field]).withContext(`${preset}/${field}`).toBeUndefined();
      }
      expect((api.setPolicy as jasmine.Spy).calls.mostRecent().args).toEqual(['uc2', 'uc2_rl']);
    }
  });

  it('waits for backend actor acceptance before opening or playback and never substitutes the Director', () => {
    spyOn(api, 'step');
    spyOn(api, 'play');
    open();
    store.step('uc2_rl');
    store.play('uc2_rl');
    store.play('deadlock_avoidance');
    expect(api.step).not.toHaveBeenCalled();
    expect(api.play).not.toHaveBeenCalled();
    expect(api.setPolicy).toHaveBeenCalledOnceWith('uc2', 'uc2_rl');
    expect(ws.connect).not.toHaveBeenCalled();
    accepted.next({ session_id: 'uc2', policy: 'uc2_rl' });
    expect(ws.connect).toHaveBeenCalledOnceWith('uc2');
    expect(store.refreshState).toHaveBeenCalledOnceWith(true);
    store.interactionMode.set('co-learning');
    store.setInteractionMode('director');
    expect(api.setPolicy).toHaveBeenCalledTimes(1);
    expect(store.activePolicy()).toBe('uc2_rl');
  });

  for (const action of ['step', 'play'] as const) {
    it(`keeps the selected actor stopped when ${action} is rejected`, () => {
      open();
      accepted.next({ session_id: 'uc2', policy: 'uc2_rl' });
      store.loading.set(false);
      spyOn(api, action).and.returnValue(throwError(() => new Error('Policy uc2_rl is not enabled')));
      spyOn(api, 'listPolicies');
      store[action]('uc2_rl');
      expect(api.listPolicies).not.toHaveBeenCalled();
      expect(store.activePolicy()).toBe('uc2_rl');
      expect(store.playing()).toBeFalse();
    });
  }

  it('preserves actor selection when unavailable and on a native-fixture restart', () => {
    open();
    accepted.next({ session_id: 'uc2', policy: 'uc2_rl' });
    spyOn(api, 'listPolicies').and.returnValue(of([
      { id: 'deadlock_avoidance', show_in_ui: true, is_default: true } as PolicyInfo,
    ]));
    store.loadPolicies();
    expect(store.activePolicy()).toBe('uc2_rl');
    expect(store.loading()).toBeFalse();
    expect(store.error()).toBeTruthy();
    const tour = tourById('uc2-rl-3')!;
    const opts = restartSessionOpts({ randomEnv: false, opts: {
      pinnedPolicy: tour.backendPolicy, scenarioPresetId: tour.infrastructureId,
    } }, {});
    store.newSession(opts);
    expect(api.deleteSession).toHaveBeenCalledOnceWith('uc2');
    const payload = (api.createSession as jasmine.Spy).calls.mostRecent().args[0];
    expect(payload.scenario_preset_id).toBe('uc2-3');
    expect(payload.max_episode_steps).toBeUndefined();
    expect(payload.disturbance_ids).toBeUndefined();
    expect((api.setPolicy as jasmine.Spy).calls.mostRecent().args).toEqual(['uc2', 'uc2_rl']);
  });
});
