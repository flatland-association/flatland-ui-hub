import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of, Subject } from 'rxjs';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { ApiService } from './api.service';
import { SessionStore } from './session.store';
import { ScenarioOption } from './events/event-types';
import { SceneGeography, SessionState, StepResponse } from './models';

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
});
