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

  /** The contention the strategies answer: most urgent group's trains + extent. */
  private readonly contentionKey = computed(() => {
    const sid = this.store.session()?.id;
    const g = this.store.contentions()[0];
    if (!sid || !g) return null;
    return `${sid}|${[...g.handles].sort((a, b) => a - b).join(',')}|${(g.window ?? []).length}`;
  });

  constructor() {
    effect(() => {
      const key = this.users() > 0 ? this.contentionKey() : null;
      untracked(() => {
        if (key === this.key) return;
        this.key = key;
        this.response.set(null);
        if (key) this.load(key);
      });
    });
  }

  /** A panel in strategies mode registers while it is shown. */
  use(): () => void {
    this.users.update((n) => n + 1);
    return () => this.users.update((n) => Math.max(0, n - 1));
  }

  private load(key: string): void {
    const sid = this.store.session()?.id;
    if (!sid) return;
    this.loading.set(true);
    this.api.getContentionStrategies(sid).subscribe({
      next: (resp) => {
        if (this.key !== key) return;
        this.response.set(resp);
        this.loading.set(false);
      },
      error: () => {
        if (this.key === key) this.loading.set(false);
      },
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
  }
}
