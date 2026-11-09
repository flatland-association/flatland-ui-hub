import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import { DirectorComparison } from './models';
import { SessionStore } from './session.store';

export type DirectorComparisonStage = 'idle' | 'waiting' | 'preparing' | 'baseline' | 'alternative' | 'committing' | 'committed' | 'unavailable' | 'cancelled';
interface ComparisonSurface { present(value: DirectorComparison | null, stage: DirectorComparisonStage): void; }

/** Domain workflow for the browser that explicitly launched this prepared demo.
 * Reading state in another viewer never prepares, commits or resumes a session. */
@Injectable({ providedIn: 'root' })
export class DirectorComparisonService {
  private readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly surface = signal<ComparisonSurface | null>(null);
  private readonly localStage = signal<DirectorComparisonStage>('idle');
  private readonly localCommand = signal<string | null>(null);
  private readonly attempted = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private epoch = 0;
  private interruption: number | null = null;
  readonly enabled = computed(() => {
    const actor = this.store.dispatcher();
    const comparison = actor?.comparison;
    return actor?.mode === 'director' && actor.owner === 'agent' && !actor.mixed && ['ready', 'running'].includes(actor.run_status)
      && !!actor.config.comparison && !['cancelled', 'unavailable'].includes(comparison?.phase ?? '')
      && (comparison?.phase !== 'committed' || this.store.elapsedSteps() <= comparison.step);
  });
  readonly snapshot = computed(() => {
    const actor = this.store.dispatcher();
    const value = actor?.comparison;
    return actor?.mode === 'director' && actor.owner === 'agent' && !actor.mixed && actor.config.comparison
      && !!value && value.session_id === this.store.session()?.id
      && (value.phase !== 'committed' || this.store.elapsedSteps() <= value.step) ? value : null;
  });
  readonly stage = computed<DirectorComparisonStage>(() => {
    const value = this.snapshot();
    if (!value) return 'idle';
    if (value.phase === 'cancelled' || value.phase === 'unavailable') return value.phase;
    if (value.command_id === this.localCommand() && this.localStage() !== 'idle') return this.localStage();
    return value.phase === 'ready' ? 'alternative' : value.phase;
  });
  readonly canCommit = computed(() => {
    const value = this.snapshot();
    return this.stage() === 'alternative' && !!value && this.valid(value) && this.drawable(value)
      && value.phase === 'ready' && !!value.token && value.validation?.accepted === true;
  });
  readonly counts = computed(() => {
    const divergence = this.snapshot()?.alternative?.divergence;
    return { reroutes: Object.keys(divergence?.reroutes ?? {}).length, holds: divergence?.holds.filter(hold => hold.steps > 0).length ?? 0 };
  });
  readonly forecast = computed(() => {
    const value = this.snapshot();
    const current = value?.current?.utilities;
    const alternative = value?.alternative?.plan?.utilities;
    if (!alternative) return [];
    return (['punctuality', 'connections', 'stability'] as const).flatMap(axis => {
      if (axis === 'connections' && value?.alternative?.plan?.reported?.connectionCount === 0) return [];
      const before = current?.[axis], after = alternative[axis];
      return Number.isFinite(after)
        ? [{ axis, before: Number.isFinite(before) ? Math.round(before! * 100) : null, after: Math.round(after * 100) }] : [];
    });
  });

  constructor() {
    effect(() => {
      const value = this.snapshot();
      const stage = this.stage();
      const surface = this.surface();
      const owns = this.enabled();
      untracked(() => surface?.present(owns && value && this.valid(value) ? value : null, stage));
    });
    effect(() => {
      const revision = this.store.directorComparisonInterruption();
      const value = this.snapshot();
      const launcher = this.store.directorComparisonLauncher();
      const actor = this.store.dispatcher();
      const sessionId = this.store.session()?.id;
      const step = this.store.elapsedSteps();
      const surface = this.surface();
      const connected = this.store.wsConnected();
      untracked(() => {
        if (this.interruption !== null && this.interruption !== revision) this.cancel();
        this.interruption = revision;
        if (this.localCommand() && (!connected || !value || actor?.owner !== 'agent' || actor.generation !== value.generation
          || ['error', 'aborted', 'finished'].includes(actor.run_status)
          || ['cancelled', 'unavailable'].includes(value.phase)
          || (value.phase !== 'committed' && value.step !== step))) {
          this.cancel();
          if (!value || !this.enabled() || actor?.owner !== 'agent') this.localCommand.set(null);
        }
        if (!value || value.phase !== 'waiting' || launcher !== sessionId || !surface || !this.valid(value)) return;
        const key = `${value.session_id}:${value.generation}:${value.command_id}`;
        if (this.attempted.has(key)) return;
        this.attempted.add(key);
        void this.prepare(value, revision);
      });
    });
    inject(DestroyRef).onDestroy(() => this.cancel());
  }

  register(surface: ComparisonSurface): () => void {
    this.surface.set(surface);
    return () => { if (this.surface() === surface) { this.surface.set(null); this.cancel(); } };
  }

  private valid(value: DirectorComparison): boolean {
    const actor = this.store.dispatcher();
    return this.store.wsConnected() && value.session_id === this.store.session()?.id && actor?.owner === 'agent' && actor.mode === 'director' && !actor.mixed
      && actor.generation === value.generation && actor.run_status === 'running'
      && (value.phase === 'committed' || value.step === this.store.elapsedSteps());
  }
  private drawable(value: DirectorComparison): boolean {
    const divergence = value.alternative?.divergence;
    return !!value.alternative?.plan && !!value.alternative.paths && !!divergence
      && (Object.values(divergence.reroutes).some(route => route.points.length >= 2)
        || divergence.holds.some(hold => hold.steps > 0));
  }
  private current(value: DirectorComparison, epoch: number, revision: number): boolean {
    return this.epoch === epoch && this.store.directorComparisonInterruption() === revision
      && this.valid(value) && !['cancelled', 'unavailable'].includes(this.snapshot()?.phase ?? 'cancelled');
  }
  private later(callback: () => void, milliseconds: number): void {
    if (this.timer) clearTimeout(this.timer);
    // Static map stages: no camera animation, also with reduced motion enabled.
    this.timer = setTimeout(() => { this.timer = null; callback(); }, milliseconds);
  }
  private cancel(): void {
    ++this.epoch;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (['preparing', 'baseline', 'alternative', 'committing'].includes(this.localStage())) this.localStage.set('cancelled');
    this.surface()?.present(null, 'cancelled');
  }

  private async prepare(value: DirectorComparison, revision: number): Promise<void> {
    const epoch = ++this.epoch;
    this.localCommand.set(value.command_id);
    this.localStage.set('preparing');
    try {
      const response = await firstValueFrom(this.api.prepareDirectorComparison(value.session_id, value.command_id, value.generation));
      if (!this.current(value, epoch, revision)) return;
      this.store.acceptDirectorComparison(response);
      const ready = response.comparison;
      if (!ready || ready.phase !== 'ready' || !ready.token || ready.validation?.accepted !== true || !this.drawable(ready)) {
        this.localStage.set('unavailable'); return;
      }
      this.localStage.set('baseline');
      this.later(() => {
        if (!this.current(ready, epoch, revision)) return;
        this.localStage.set('alternative');
        this.later(() => { if (this.current(ready, epoch, revision)) void this.commit(true); }, 3000);
      }, 1500);
    } catch {
      if (this.current(value, epoch, revision)) this.localStage.set('unavailable');
    }
  }

  /** Only the explicit presenter adopts the frozen token; no browser observation actuates it. */
  async commit(automatic = false): Promise<void> {
    const value = this.snapshot();
    if (!automatic || !value || !this.canCommit() || !value.token
      || this.store.directorComparisonLauncher() !== value.session_id) return;
    const revision = this.store.directorComparisonInterruption();
    const epoch = this.epoch;
    this.localCommand.set(value.command_id);
    this.localStage.set('committing');
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try {
      const response = await firstValueFrom(this.api.commitDirectorComparison(value.session_id, value.command_id, value.generation, value.token));
      if (!this.current(value, epoch, revision)) return;
      this.store.acceptDirectorComparison(response);
      if (response.comparison?.phase !== 'committed') { this.localStage.set('unavailable'); return; }
      this.localStage.set('committed');
      if (automatic && this.current(response.comparison, epoch, revision)
        && this.store.directorComparisonLauncher() === value.session_id) {
        this.store.play(this.store.activePolicy(), this.store.playSpeed(), 'automatic', value.token);
      }
    } catch {
      if (this.current(value, epoch, revision)) this.localStage.set('unavailable');
    }
  }
}
