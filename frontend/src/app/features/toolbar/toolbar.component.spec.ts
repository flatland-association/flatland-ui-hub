import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiConfigService } from '../../core/config/ui-config.service';
import { PolicyInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ToolbarComponent } from './toolbar.component';

/** Four policies the session has enabled, as the backend would describe them. */
const POLICIES = [
  { id: 'deadlock_avoidance', label: 'DLA', is_default: true, show_in_ui: true },
  { id: 'shortest_path', label: 'Shortest path', show_in_ui: true },
  { id: 'goal_directed', label: 'Director planner', show_in_ui: true },
  { id: 'plan', label: 'Scripted plan', show_in_ui: false },
] as unknown as PolicyInfo[];

describe('ToolbarComponent — the policy selector', () => {
  let fixture: ComponentFixture<ToolbarComponent>;
  let cmp: ToolbarComponent;
  let store: SessionStore;
  let uiConfig: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ToolbarComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ToolbarComponent);
    cmp = fixture.componentInstance;
    store = TestBed.inject(SessionStore);
    uiConfig = TestBed.inject(UiConfigService);

    (store as unknown as { _policies: { set(v: PolicyInfo[]): void } })._policies.set(POLICIES);
    cmp.enabledPolicyIds.set(POLICIES.map((p) => p.id));
  });

  const ids = () => cmp.selectablePolicies().map((p) => p.id);

  it('offers every policy the session enabled when nothing is configured', () => {
    expect(ids()).toEqual(['deadlock_avoidance', 'shortest_path', 'goal_directed', 'plan']);
  });

  it('narrows the list to the allowlist', () => {
    uiConfig.apply({ policyAllowlist: ['deadlock_avoidance', 'plan'] });
    expect(ids()).toEqual(['deadlock_avoidance', 'plan']);
  });

  it('can only narrow — an allowlisted policy the session never enabled stays out', () => {
    cmp.enabledPolicyIds.set(['deadlock_avoidance']);
    uiConfig.apply({ policyAllowlist: ['deadlock_avoidance', 'goal_directed'] });
    expect(ids()).toEqual(['deadlock_avoidance']);
  });

  it('offers everything again once the restriction is dropped', () => {
    uiConfig.apply({ policyAllowlist: ['plan'] });
    uiConfig.apply({});
    expect(ids().length).toBe(4);
  });
});

describe('ToolbarComponent — hiding the selector', () => {
  let fixture: ComponentFixture<ToolbarComponent>;
  let cmp: ToolbarComponent;
  let store: SessionStore;
  let uiConfig: UiConfigService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ToolbarComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(ToolbarComponent);
    cmp = fixture.componentInstance;
    store = TestBed.inject(SessionStore);
    uiConfig = TestBed.inject(UiConfigService);

    (store as unknown as { _policies: { set(v: PolicyInfo[]): void } })._policies.set(POLICIES);
    cmp.enabledPolicyIds.set(POLICIES.map((p) => p.id));
    store.session.set({ id: 'test-session' } as never);
  });

  const selectShown = () => {
    fixture.detectChanges();
    return !!fixture.nativeElement.querySelector('.policy-select');
  };

  it('renders the dropdown while there is a choice', () => {
    uiConfig.apply({ policyAllowlist: ['deadlock_avoidance', 'plan'] });
    expect(selectShown()).toBeTrue();
  });

  // One allowed policy means nothing to pick, so the control is noise — and
  // naming that one policy is what says which the session runs (§4.3c).
  it('drops the dropdown when exactly one policy is allowed', () => {
    uiConfig.apply({ policyAllowlist: ['deadlock_avoidance'] });
    expect(selectShown()).toBeFalse();
  });

  it('drops the dropdown when the allowlist is empty', () => {
    uiConfig.apply({ policyAllowlist: [] });
    expect(selectShown()).toBeFalse();
  });
});
