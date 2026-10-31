import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ApiService, DirectorActivity, DirectorProgress } from '../../core/api.service';
import { SessionStore } from '../../core/session.store';
import { TrainIdentityService } from '../../core/train-identity.service';

/**
 * Optimization Monitor — does the autonomous plan have a real solution, since
 * when, where does it struggle, how far ahead does it look, and what can it not
 * see. Director only; reads, never acts. It never says "optimal": the planner
 * searches, it does not prove.
 * Spec: docs/plans/widget-optimization-monitor.md.
 */
export type PlanStatus = 'planning' | 'searched' | 'fallback' | 'unroutable' | 'none';

const FALLBACK_SOURCES = new Set(['lines', 'avoidance', 'avoidance (no models)']);

export function planStatus(
  activity: DirectorActivity | null,
  progress: DirectorProgress | null,
): PlanStatus {
  if (progress && progress.phase !== 'idle') return 'planning';
  const source = activity?.source ?? null;
  if (!source) return 'none';
  if (source === 'unroutable') return 'unroutable';
  if (FALLBACK_SOURCES.has(source)) return 'fallback';
  return 'searched';
}

export const MODEL_LIMITS = ['malfunctions', 'perfectExecution', 'grid', 'noBound'] as const;

@Component({
  selector: 'app-optimization-monitor',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './optimization-monitor.component.html',
  styleUrl: './optimization-monitor.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class OptimizationMonitorComponent implements OnDestroy {
  @Input() embedded = false;

  readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly identity = inject(TrainIdentityService);

  readonly activity = signal<DirectorActivity | null>(null);
  readonly progress = signal<DirectorProgress | null>(null);
  readonly limits = MODEL_LIMITS;

  private _poll: ReturnType<typeof setInterval> | null = null;
  private _pollSession: string | null = null;

  constructor() {
    effect(() => {
      const sid = this.store.session()?.id ?? null;
      if (sid === this._pollSession) return;
      this._stopPoll();
      this._pollSession = sid;
      this.activity.set(null);
      this.progress.set(null);
      if (!sid) return;
      this._fetch(sid);
      this._poll = setInterval(() => this._fetch(sid), 2500);
    });
  }

  ngOnDestroy(): void {
    this._stopPoll();
  }

  private _stopPoll(): void {
    if (this._poll) {
      clearInterval(this._poll);
      this._poll = null;
    }
  }

  private _fetch(sid: string): void {
    this.api.getDirectorActivity(sid, 50).subscribe({
      next: (a) => this.activity.set(a),
      error: () => {},
    });
    this.api.getDirectorProgress(sid).subscribe({
      next: (p) => this.progress.set(p),
      error: () => {},
    });
  }

  readonly status = computed(() => planStatus(this.activity(), this.progress()));

  /** Step of the last re-plan that replaced the plan; 0 = the plan from the start. */
  readonly sinceStep = computed(() => {
    const replaced = (this.activity()?.replans ?? []).filter((r) => r.verdict === 'research');
    return replaced.length ? Math.max(...replaced.map((r) => r.step)) : 0;
  });

  /** The newest re-plan, whatever its verdict: the planner's latest reaction. */
  readonly lastReplan = computed(() => this.activity()?.replans?.[0] ?? null);

  readonly lastReplanKey = computed(() => {
    const r = this.lastReplan();
    if (!r) return null;
    if (r.verdict === 'research') return 'optMon.replan.replaced';
    if (r.gate === 'rollout-veto') return 'optMon.replan.vetoed';
    return 'optMon.replan.kept';
  });

  /** Trains with a planned decision that has no branch left. */
  readonly stuck = computed(() => {
    const a = this.activity();
    if (!a) return [];
    const handles = new Set<number>();
    for (const e of [...a.recent, ...a.upcoming]) {
      if (e.stuck && e.handle != null) handles.add(e.handle);
    }
    return [...handles]
      .sort((x, y) => x - y)
      .map((handle) => ({ handle, name: this.identity.nameFor(handle) }));
  });

  /** Steps from now to the last decision the plan has scheduled. */
  readonly horizon = computed(() => {
    const a = this.activity();
    if (!a || a.upcoming.length === 0) return null;
    const last = Math.max(...a.upcoming.map((e) => e.step));
    return Math.max(0, last - a.step);
  });

  isSelected(handle: number): boolean {
    return this.store.selectedHandles().has(handle);
  }

  select(handle: number): void {
    this.store.toggleAgentSelection(handle);
  }
}
