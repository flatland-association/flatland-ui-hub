import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { PolicyInfo, SessionInfo } from './models';
import { SessionStore } from './session.store';

/**
 * A study condition's policy runs every leg, also one on a scenario with a
 * premade plan, which would otherwise switch the session to its plan
 * (experiment-scenario-import.md, finding 5).
 */
describe('SessionStore — a pinned policy on a planned scenario', () => {
  let store: SessionStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    http = TestBed.inject(HttpTestingController);
    store.interactionMode.set('co-learning');
  });

  const open = (pinnedPolicy?: 'deadlock_avoidance') => {
    store.setActivePolicy('deadlock_avoidance');
    store.newSession({ scenarioPresetId: 'planned', policyControlIds: ['deadlock_avoidance'], pinnedPolicy });
    if (pinnedPolicy) {
      // A pinned session first learns from the catalog whether its policy is a specialist.
      http.expectOne((r) => r.url.endsWith('/policies')).flush([
        { id: 'deadlock_avoidance', show_in_ui: true, is_default: true },
      ] as PolicyInfo[]);
    }
    http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/session')).flush({
      id: 'planned-1', width: 1, height: 1, num_agents: 1, has_plan: true, active_policy: 'plan',
    } as SessionInfo);
  };

  it('keeps the pinned policy, with the plan still offered', () => {
    open('deadlock_avoidance');
    expect(store.activePolicy()).toBe('deadlock_avoidance');
    expect(store.enabledControlPolicyIds()).toContain('plan');
  });

  it('switches to the plan without a pin, as before', () => {
    open();
    expect(store.activePolicy()).toBe('plan');
  });

  it('keeps the pinned policy in Director mode instead of switching to the planner', () => {
    store.interactionMode.set('director');
    open('deadlock_avoidance');
    store.setInteractionMode('co-learning');
    store.setInteractionMode('director');
    http.expectNone((r) => r.url.endsWith('/policy'));
    expect(store.activePolicy()).toBe('deadlock_avoidance');
  });
});
