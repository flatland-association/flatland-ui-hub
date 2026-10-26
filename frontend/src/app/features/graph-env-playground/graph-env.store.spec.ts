import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { GraphEnvStore } from './graph-env.store';
import { GraphEnvStateResponse } from './graph-env.models';

function stateAt(step: number, done = false): GraphEnvStateResponse {
  return { step, max_episode_steps: 10000, done, agents: [] };
}

describe('GraphEnvStore', () => {
  let store: GraphEnvStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GraphEnvStore, provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(GraphEnvStore);
    http = TestBed.inject(HttpTestingController);
    store.init();
    http.expectOne((r) => r.url.endsWith('/graph-env-api/network'))
      .flush({ tracks: [], nodes: [], bounds: [[0, 0], [1, 1]] });
    http.expectOne((r) => r.url.endsWith('/graph-env-api/sessions')).flush({ id: 's1', state: stateAt(0) });
  });

  afterEach(() => {
    store.pause();
    http.verify();
  });

  it('creates a session on init and maps step to elapsed_steps', () => {
    expect(store.session()).toEqual({ id: 's1' });
    expect(store.state()?.elapsed_steps).toBe(0);
    expect(store.network()).not.toBeNull();
  });

  it('steps n and tracks the target step while loading', () => {
    store.step('shortest_path', 10);

    expect(store.loading()).toBeTrue();
    expect(store.targetStep()).toBe(10);
    const request = http.expectOne((r) => r.url.endsWith('/graph-env-api/sessions/s1/step'));
    expect(request.request.params.get('n')).toBe('10');
    request.flush(stateAt(10));

    expect(store.loading()).toBeFalse();
    expect(store.targetStep()).toBeNull();
    expect(store.state()?.elapsed_steps).toBe(10);
  });

  it('plays one request at a time and stops when the episode is done', fakeAsync(() => {
    store.togglePlay('shortest_path');
    expect(store.playing()).toBeTrue();

    tick(0);
    http.expectOne((r) => r.url.endsWith('/step')).flush(stateAt(1));
    tick(1000 / store.playSpeed());
    const second = http.expectOne((r) => r.url.endsWith('/step'));
    tick(5000);  // no second request while the first is in flight
    second.flush(stateAt(2, true));

    expect(store.playing()).toBeFalse();
    expect(store.episodeDone()).toBeTrue();
    tick(5000);
  }));

  it('toggles the selection', () => {
    store.toggleAgentSelection(0);
    expect(store.selectedHandle()).toBe(0);
    store.toggleAgentSelection(0);
    expect(store.selectedHandle()).toBeNull();
  });
});
