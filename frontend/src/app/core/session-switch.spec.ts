import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { SessionInfo } from './models';
import { SessionStore } from './session.store';

/**
 * A session that is left while it plays is paused on the server: a guided
 * condition starts a new session per leg, and the earlier legs' play loops ran
 * on unseen (found in the Plan B browser check, experiment-scenario-import.md §8).
 */
describe('SessionStore — leaving a playing session', () => {
  let store: SessionStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    http = TestBed.inject(HttpTestingController);
    store.session.set({ id: 'leg-1' } as SessionInfo);
  });

  const pauses = () => http.match((r) => r.method === 'POST' && r.url.endsWith('/session/leg-1/pause'));

  it('pauses it on the server when the next session starts', () => {
    store.playing.set(true);
    store.newSession({ width: 30, height: 30 });
    expect(pauses().length).toBe(1);
    expect(store.playing()).toBeFalse();
  });

  it('pauses it on the server when the session ends', () => {
    store.playing.set(true);
    store.endSession();
    expect(pauses().length).toBe(1);
  });

  it('sends no pause for a session that was not playing', () => {
    store.newSession({ width: 30, height: 30 });
    expect(pauses().length).toBe(0);
  });

  it('takes only the latest of two session requests, whichever answers first', () => {
    store.newSession({ scenarioPresetId: 'leg-a' });
    store.newSession({ scenarioPresetId: 'leg-b' });
    const [a, b] = http.match((r) => r.method === 'POST' && r.url.endsWith('/session'));
    b.flush({ id: 'b', width: 1, height: 1, num_agents: 0, scenario_preset_id: 'leg-b' } as SessionInfo);
    a.flush({ id: 'a', width: 1, height: 1, num_agents: 0, scenario_preset_id: 'leg-a' } as SessionInfo);
    expect(store.session()?.id).toBe('b');
  });
});
