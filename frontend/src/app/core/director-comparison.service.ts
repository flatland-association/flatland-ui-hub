import { DestroyRef, Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { DispatcherEffect, DispatcherObservedMetrics, DispatcherState } from './dispatcher';
import { DirectorComparison } from './models';
import { SessionStore } from './session.store';

export type DirectorComparisonStage = 'idle' | 'waiting' | 'preparing' | 'baseline' | 'alternative' | 'committing' | 'committed' | 'unavailable' | 'cancelled';
export type DirectorOutcomeStage = 'tracking' | 'complete' | 'partial' | 'stopped' | 'error' | 'intervened' | 'unavailable';
export interface DirectorComparisonOutcome {
  sessionId: string;
  commandId: string;
  stage: DirectorOutcomeStage;
  adoptionStep: number;
  step: number | null;
  expectedArrived: number | null;
  expectedTotal: number | null;
  arrived: number | null;
  total: number | null;
  remaining: number | null;
  totalArrivalDelay: number | null;
  delayDenominator: number | null;
  arrivalReference: 'authored_plan' | 'latest_arrival' | 'unavailable';
  interveningCommands: number | null;
  intervened: boolean;
  measurementsAvailable: boolean;
  celebrate: boolean;
}
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
  /** Observed execution survives release of the short-lived map comparison.
   * This projection never prepares a plan, polls, resumes or changes controls. */
  readonly outcome = computed<DirectorComparisonOutcome | null>(() => projectOutcome(
    this.store.dispatcher(), this.store.session()?.id ?? null, this.store.elapsedSteps(),
  ));

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

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validMetrics(value: DispatcherObservedMetrics | undefined, total: number): value is DispatcherObservedMetrics {
  return !!value && nonNegativeInteger(value.arrived) && value.arrived <= total
    && nonNegativeInteger(value.simulation_steps) && nonNegativeInteger(value.delay_denominator)
    && value.delay_denominator <= value.arrived
    && (value.total_arrival_delay === null
      ? value.delay_denominator === 0
      : nonNegativeInteger(value.total_arrival_delay) && value.delay_denominator > 0);
}

function measuredAfter(effect: DispatcherEffect | undefined, actor: DispatcherState, total: number | null,
  adoptionStep: number, currentStep: number): DispatcherObservedMetrics | null {
  if (!effect || effect.scope !== 'observed_since_command' || effect.causal_claim !== false || total === null
    || !nonNegativeInteger(currentStep) || !validMetrics(effect.before, total) || !validMetrics(effect.after, total)
    || effect.before.simulation_steps !== adoptionStep || effect.after.simulation_steps !== currentStep
    || effect.after.simulation_steps < effect.before.simulation_steps || effect.after.arrived < effect.before.arrived
    || effect.after.delay_denominator < effect.before.delay_denominator) return null;
  // Supplied aggregate measurements must describe the same frame. Never fill a
  // missing command-linked observation from a later, unrelated aggregate.
  const aggregateStep = actor.metrics?.['simulation_steps'];
  const aggregateArrived = actor.metrics?.['arrived'];
  if ((aggregateStep !== undefined && (!nonNegativeInteger(aggregateStep) || aggregateStep !== effect.after.simulation_steps))
    || (aggregateArrived !== undefined && (!nonNegativeInteger(aggregateArrived) || aggregateArrived !== effect.after.arrived))) return null;
  return effect.after;
}

function projectOutcome(actor: DispatcherState | null, sessionId: string | null, currentStep: number): DirectorComparisonOutcome | null {
  const comparison = actor?.comparison;
  if (!actor || actor.mode !== 'director' || !['synthetic_dispatcher', 'mixed'].includes(actor.operator_type)
    || !actor.config.comparison || !comparison || comparison.phase !== 'committed' || comparison.validation?.accepted !== true
    || !sessionId || comparison.session_id !== sessionId || !comparison.command_id
    || !nonNegativeInteger(comparison.step) || !nonNegativeInteger(comparison.generation)
    || !nonNegativeInteger(actor.generation) || actor.generation < comparison.generation
    || !['running', 'finished', 'aborted', 'error'].includes(actor.run_status)) return null;
  const terminal = ['finished', 'aborted', 'error'].includes(actor.run_status);
  const ownershipIntervention = actor.owner === 'human' || actor.mixed === true || actor.operator_type === 'mixed';
  // Finishing/stopping invalidates the runtime generation without erasing the
  // original committed command. A new, unmixed running generation is different.
  if ((!terminal && !ownershipIntervention && actor.generation !== comparison.generation)
    || (nonNegativeInteger(currentStep) && (currentStep < comparison.step || (currentStep === comparison.step && !terminal)))) return null;
  const totalValue = actor.metrics?.['total_trains'];
  const total = nonNegativeInteger(totalValue) && totalValue > 0 ? totalValue : null;
  const matching = actor.effects?.filter(effect => effect.command_id === comparison.command_id) ?? [];
  const effect = matching.length === 1 ? matching[0] : undefined;
  const after = measuredAfter(effect, actor, total, comparison.step, currentStep);
  const interveningValue = effect?.intervening_commands;
  const interveningCommands = nonNegativeInteger(interveningValue) ? interveningValue : null;
  const intervened = ownershipIntervention || (interveningCommands !== null && interveningCommands > 0);
  const validation = comparison.validation;
  const expectedAvailable = nonNegativeInteger(validation.arrived) && nonNegativeInteger(validation.total)
    && validation.total > 0 && validation.arrived <= validation.total && validation.total === total;
  const expectedArrived = expectedAvailable ? validation.arrived : null;
  const expectedTotal = expectedAvailable ? validation.total : null;
  const arrived = after?.arrived ?? null;
  let stage: DirectorOutcomeStage;
  if (actor.run_status === 'error') stage = 'error';
  else if (actor.run_status === 'aborted') stage = 'stopped';
  else if (intervened) stage = 'intervened';
  else if (!after || interveningCommands === null) stage = 'unavailable';
  else if (actor.run_status === 'finished') stage = arrived === total ? 'complete' : 'partial';
  else stage = 'tracking';
  const reference = actor.arrival_reference_source;
  return {
    sessionId, commandId: comparison.command_id, stage, adoptionStep: comparison.step,
    step: after?.simulation_steps ?? null, expectedArrived, expectedTotal, arrived, total,
    remaining: after && total !== null ? total - after.arrived : null,
    totalArrivalDelay: after?.total_arrival_delay ?? null, delayDenominator: after?.delay_denominator ?? null,
    arrivalReference: reference === 'authored_plan' || reference === 'latest_arrival' ? reference : 'unavailable',
    interveningCommands, intervened, measurementsAvailable: !!after,
    celebrate: stage === 'complete' && !!after && !intervened && interveningCommands === 0
      && expectedArrived !== null && expectedArrived === total && expectedTotal === total,
  };
}
