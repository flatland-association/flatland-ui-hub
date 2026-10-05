import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../api.service';
import { ContentionStrategiesResponse, ContentionStrategy, PolicyName } from '../models';
import { SessionStore } from '../session.store';

/**
 * The contention strategies behind Combined Actions' "strategies" source:
 * keep / switch policy / PP re-plan, each simulated by the backend
 * (`GET /hmi/contention-strategies`, `app/core/contention_strategies.py`).
 *
 * Fetched only while a Combined Actions panel asks for them (`use()`), and only
 * when the contention itself changes — not every step: a simulated comparison
 * takes seconds on a large network, and the operator needs figures that hold
 * still long enough to be compared.
 */
@Injectable({ providedIn: 'root' })
export class ContentionStrategiesService {
  private readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);

  private readonly users = signal(0);
  readonly response = signal<ContentionStrategiesResponse | null>(null);
  readonly loading = signal(false);
  private key: string | null = null;
  /** The request in flight, and the contention to ask about once it is back. */
  private inflight = false;
  private pending: string | null = null;

  /** The contention the strategies answer: most urgent group's trains + extent. */
  private readonly contentionKey = computed(() => {
    const sid = this.store.session()?.id;
    const g = this.store.contentions()[0];
    if (!sid || !g) return null;
    return `${sid}|${[...g.handles].sort((a, b) => a - b).join(',')}|${(g.window ?? []).length}`;
  });

  constructor() {
    // Stale-while-revalidate: on a busy network the contention changes every
    // few steps while a comparison takes seconds, so dropping the running
    // request on every change meant no cards ever appeared during play. The
    // last result stays up (it names its step) until the next one lands, and
    // at most one request runs at a time.
    effect(() => {
      const key = this.users() > 0 ? this.contentionKey() : null;
      untracked(() => {
        if (key === this.key) return;
        this.key = key;
        if (!key) {
          this.response.set(null);
          return;
        }
        this.load(key);
      });
    });
  }

  /** A panel in strategies mode registers while it is shown. */
  use(): () => void {
    this.users.update((n) => n + 1);
    return () => this.users.update((n) => Math.max(0, n - 1));
  }

  private load(key: string): void {
    if (this.inflight) {
      this.pending = key;
      return;
    }
    const sid = this.store.session()?.id;
    if (!sid) return;
    this.inflight = true;
    this.loading.set(true);
    const done = () => {
      this.inflight = false;
      const next = this.pending;
      this.pending = null;
      if (next && next === this.key && next !== key) this.load(next);
      else this.loading.set(false);
    };
    this.api.getContentionStrategies(sid).subscribe({
      next: (resp) => {
        // Shown even if the contention moved on meanwhile: a few steps old
        // beats nothing, and the panel says which step it is from.
        if (this.store.session()?.id === sid && this.key) this.response.set(resp);
        done();
      },
      error: () => done(),
    });
  }

  /** PP solved for the operator's own order of the contending trains. */
  async human(priority: readonly number[]): Promise<ContentionStrategy | null> {
    const sid = this.store.session()?.id;
    if (!sid) return null;
    const resp = await firstValueFrom(this.api.getContentionStrategies(sid, priority));
    return resp.strategies.find((s) => s.id === 'pp-human') ?? null;
  }

  /** Make a strategy what drives the session, until changed again. */
  async apply(strategy: string, priority?: readonly number[]): Promise<void> {
    const sid = this.store.session()?.id;
    if (!sid) return;
    const res = await firstValueFrom(this.api.applyContentionStrategy(sid, strategy, priority));
    if (res.policy) this.store.setActivePolicy(res.policy as PolicyName);
    // What drives the session changed: forecasts, contentions and these
    // strategies all have to be asked again.
    this.store.refreshState();
    this.store.refreshForecasts();
    const key = this.contentionKey();
    this.key = key;
    this.response.set(null);
    if (key) this.load(key);
    else this.loading.set(false);
  }
}
