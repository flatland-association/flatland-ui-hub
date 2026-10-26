import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { backendHttpBase } from '../../core/backend-origin';
import { AppNotification } from '../../core/events/event-types';
import { PolicyInfo, PolicyName } from '../../core/models';
import { PLAY_SPEED_DEFAULT_LEVEL, clampPlaySpeedLevel, playSpeedForLevel } from '../../core/play-speed';
import {
  GraphEnvNetwork,
  GraphEnvSessionResponse,
  GraphEnvState,
  GraphEnvStateResponse,
} from './graph-env.models';

const API_BASE = `${backendHttpBase()}/graph-env-api`;

/** The one policy the graph env runs (env_factory.GraphShortestPathPolicy), shown in the disabled policy select. */
const SHORTEST_PATH: PolicyInfo = {
  id: 'shortest_path',
  label: 'Shortest Path',
  description: '',
  is_default: true,
  show_in_ui: true,
  supports_scenarios: false,
  family: 'search-based',
  deterministic: true,
  role: 'baseline',
  observation: 'FullEnvObservation',
  at_conflict: '',
  provenance: 'flatland-scenarios #36',
  licence: '',
  grounding: '',
};

function toState(response: GraphEnvStateResponse): GraphEnvState {
  const { step, ...rest } = response;
  return { elapsed_steps: step, ...rest };
}

/**
 * State of the graph env playground page: the network, one backend session (created on every page load, so a
 * reload resets the env), and the play loop.
 *
 * Its members mirror the `SessionStore` members the copied toolbar and event feed read (`session`, `playing`,
 * `episodeDone`, `playSpeedLevel`, `step(policy, n)`, `notifications`, `agents`, ...), so the copies differ from
 * their originals mostly in which store they inject (docs/plans/graph-env-playground.md §8, §9). The `policy`
 * arguments are accepted and ignored: the graph env has one policy.
 */
@Injectable()
export class GraphEnvStore {
  private readonly http = inject(HttpClient);

  readonly network = signal<GraphEnvNetwork | null>(null);
  readonly session = signal<{ id: string } | null>(null);
  readonly state = signal<GraphEnvState | null>(null);
  readonly agents = computed(() => this.state()?.agents ?? []);
  readonly episodeDone = computed(() => this.state()?.done ?? false);

  readonly loading = signal(false);
  /** The step a pending request will reach (`targetStep() - state().elapsed_steps` steps left); null when idle. */
  readonly targetStep = signal<number | null>(null);
  readonly message = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  readonly playing = signal(false);
  readonly playSpeedLevel = signal(PLAY_SPEED_DEFAULT_LEVEL);
  /** Steps per second. */
  readonly playSpeed = computed(() => playSpeedForLevel(this.playSpeedLevel()));

  readonly selectedHandle = signal<number | null>(null);
  readonly hoveredHandle = signal<number | null>(null);

  readonly availablePolicies = signal<PolicyInfo[]>([SHORTEST_PATH]);
  readonly activePolicy = signal<PolicyName>(SHORTEST_PATH.id);
  readonly enabledControlPolicyIds = signal<string[]>([SHORTEST_PATH.id]);

  /** The event feed: empty for now. */
  readonly notifications = signal<AppNotification[]>([]);

  private playTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.pause());
  }

  /** Load the network and create a fresh session. */
  init(): void {
    this.http.get<GraphEnvNetwork>(`${API_BASE}/network`).subscribe({
      next: (network) => this.network.set(network),
      error: (e) => this.error.set(`Loading the network failed: ${e.message}`),
    });
    this.loading.set(true);
    this.http.post<GraphEnvSessionResponse>(`${API_BASE}/sessions`, {}).subscribe({
      next: (created) => {
        this.session.set({ id: created.id });
        this.state.set(toState(created.state));
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(`Creating the session failed: ${e.message}`);
      },
    });
  }

  step(_policy: PolicyName, n: number = 1, done?: () => void): void {
    const session = this.session();
    if (!session || this.loading() || this.episodeDone()) {
      done?.();
      return;
    }
    this.loading.set(true);
    this.targetStep.set((this.state()?.elapsed_steps ?? 0) + n);
    this.http.post<GraphEnvStateResponse>(`${API_BASE}/sessions/${session.id}/step`, {}, { params: { n } }).subscribe({
      next: (response) => {
        this.state.set(toState(response));
        this.loading.set(false);
        this.targetStep.set(null);
        done?.();
      },
      error: (e) => {
        this.loading.set(false);
        this.targetStep.set(null);
        this.pause();
        this.error.set(`Step failed: ${e.message}`);
      },
    });
  }

  togglePlay(policy: PolicyName): void {
    if (this.playing()) {
      this.pause();
    } else {
      this.play(policy);
    }
  }

  play(policy: PolicyName): void {
    if (this.episodeDone() || !this.session()) return;
    this.playing.set(true);
    this.scheduleNext(policy, 0);
  }

  pause(): void {
    this.playing.set(false);
    if (this.playTimer !== null) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
  }

  setPlaySpeedLevel(level: number, _policy: PolicyName): void {
    this.playSpeedLevel.set(clampPlaySpeedLevel(level));
  }

  toggleAgentSelection(handle: number): void {
    this.selectedHandle.update((selected) => (selected === handle ? null : handle));
  }

  /** One step per tick at `playSpeed()`, at most one request in flight: the next tick is timed from the last one's
   *  start, so a slow response does not pile up requests. */
  private scheduleNext(policy: PolicyName, delayMs: number): void {
    this.playTimer = setTimeout(() => {
      this.playTimer = null;
      if (!this.playing()) return;
      const started = performance.now();
      this.step(policy, 1, () => {
        if (!this.playing()) return;
        if (this.episodeDone()) {
          this.pause();
          return;
        }
        const interval = 1000 / this.playSpeed();
        this.scheduleNext(policy, Math.max(0, interval - (performance.now() - started)));
      });
    }, delayMs);
  }
}
