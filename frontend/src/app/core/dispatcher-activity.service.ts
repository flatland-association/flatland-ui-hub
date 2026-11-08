import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SessionStore } from './session.store';
import { LanguageService } from './i18n/language.service';
import { WebSocketService } from './websocket.service';
import { DirectorProgress } from './api.service';
import { DispatcherCommand } from './dispatcher';

interface PlanningFeedback {
  sessionId: string;
  phase: 'first-plan' | 'strategies';
  progress: DirectorProgress | null;
  waitSeconds: number;
}

/** Read-only UI projection of authoritative dispatcher events. */
@Injectable({ providedIn: 'root' })
export class DispatcherActivityService {
  readonly store = inject(SessionStore);
  readonly logOpen = signal(false);
  private readonly ws = inject(WebSocketService);
  private readonly now = signal(Date.now());
  private readonly activeSession = computed(() => this.store.dispatcher() ? this.store.session()?.id ?? null : null);
  private readonly planning = signal<ReadonlyMap<symbol, PlanningFeedback>>(new Map());
  private readonly acknowledgedTarget = signal<{ sessionId: string; commandId: string; until: number } | null>(null);
  private lastAcknowledgement = '';
  private static readonly ACKNOWLEDGEMENT_MS = 2000;
  readonly isTeam = computed(() => this.store.dispatcher()?.operator_type === 'human_dispatcher_team');
  readonly neutralTeam = computed(() => this.isTeam() && this.store.dispatcher()?.mode === 'co-learning');
  /** Consent always refers to the immutable proposal supplied by the backend. */
  readonly proposal = computed(() => {
    const agent = this.store.dispatcher();
    const pending = agent?.pending;
    if (!this.isTeam() || this.neutralTeam() || !agent?.requires_approval || !pending
      || agent.owner !== 'agent' || ['finished', 'error', 'aborted'].includes(agent.run_status)) return null;
    if (agent.awaiting_approval) return { pending, state: 'awaiting_approval' as const };
    if (agent.approved_command_id === pending.command_id) return { pending, state: 'approved' as const };
    return null;
  });

  constructor() {
    effect(() => {
      const actor = this.store.dispatcher();
      const sessionId = this.activeSession();
      const result = actor?.last_result ?? [...(actor?.events ?? [])].reverse().find(event => event.kind === 'result');
      const commandId = result?.decision?.command_id;
      const effective = actor?.last_effective ?? [...(actor?.events ?? [])].reverse().find(event => event.kind === 'directive_effective');
      const acknowledgement = effective && result && effective.seq > result.seq ? effective : result;
      const key = sessionId && commandId ? sessionId + ':' + commandId + ':' + acknowledgement?.seq : '';
      if (key === this.lastAcknowledgement) return;
      this.lastAcknowledgement = key;
      const command = result?.decision?.command;
      // Old snapshots keep their audit history, but must not replay a click on reconnect.
      const age = typeof actor?.elapsed_ms === 'number' && typeof acknowledgement?.elapsed_ms === 'number'
        ? Math.max(0, actor.elapsed_ms - acknowledgement.elapsed_ms)
        : actor?.logical_time === acknowledgement?.logical_time ? 0 : Infinity;
      this.acknowledgedTarget.set(sessionId && commandId && result?.result?.status === 'executed'
        && command?.strategy !== 'keep' && age < DispatcherActivityService.ACKNOWLEDGEMENT_MS
        ? { sessionId, commandId, until: Date.now() + DispatcherActivityService.ACKNOWLEDGEMENT_MS - age } : null);
    });
    // Presentation age only. This interval never polls, plans or steps a session.
    effect(cleanup => {
      if (!this.activeSession()) return;
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      cleanup(() => clearInterval(timer));
    });
  }

  reportPlanning(source: symbol, feedback: PlanningFeedback | null): void {
    this.planning.update(entries => {
      const next = new Map(entries);
      if (feedback) next.set(source, feedback); else next.delete(source);
      return next;
    });
  }

  /** Current lifecycle, kept separate from the most recent command outcome. */
  readonly live = computed(() => {
    const agent = this.store.dispatcher();
    const sessionId = this.activeSession();
    const receipt = this.ws.stateReceipt();
    const matches = !!receipt && receipt.sessionId === sessionId;
    const seconds = matches ? Math.floor(Math.max(0, this.now() - receipt.at) / 1000) : null;
    const confirmed = matches && this.ws.stateConfirmed();
    const planning = [...this.planning().values()].find(p => p.sessionId === sessionId);
    const progress = planning?.progress;
    const count = planning && progress?.phase === planning.phase && Number.isInteger(progress.done)
      && Number.isInteger(progress.total) && progress.total! > 0 && progress.done! >= 0 && progress.done! <= progress.total!
      ? { done: progress.done!, total: progress.total! } : null;
    const controlPending = this.store.dispatcherControlPending();
    const busy = this.store.backendBusy();
    const paused = !this.store.playing() && !this.store.loading() && !busy;
    const draining = busy && !!controlPending && ['pause', 'ownership', 'stop'].includes(controlPending);
    let state: 'observing' | 'planning' | 'acting' | 'waiting' | 'paused' | 'human' | 'finished' | 'stopped' | 'error' | 'offline' | 'stale' | 'starting'
      | 'awaiting_approval' | 'approved' | 'co_learning' | 'control_pending' | 'draining';
    if (agent?.run_status === 'finished') state = 'finished';
    else if (agent?.run_status === 'error') state = 'error';
    else if (agent?.run_status === 'aborted') state = 'stopped';
    else if (!this.store.wsConnected()) state = 'offline';
    else if (!confirmed) state = 'starting';
    else if (draining) state = 'draining';
    else if (controlPending) state = 'control_pending';
    else if (this.neutralTeam()) state = paused ? 'paused' : 'co_learning';
    else if (agent?.owner === 'human') state = 'human';
    else if (paused) state = 'paused';
    else if (this.proposal()?.state === 'awaiting_approval') state = 'awaiting_approval';
    else if (planning || this.store.loading() || busy) state = 'planning';
    else if (this.proposal()?.state === 'approved') state = 'approved';
    else if (seconds !== null && seconds >= 10) state = 'stale';
    else if (agent?.pending) state = 'acting';
    else if (agent?.mode === 'director' && this.displayAction().stage === 'executed') state = 'waiting';
    else state = 'observing';
    return { state, step: this.store.state()?.elapsed_steps ?? 0, seconds,
      confirmed, revision: matches ? receipt.revision : 0, paused, controlPending, busy,
      progress: ['planning', 'paused', 'draining'].includes(state) ? count : null,
      planningSeconds: planning && ['planning', 'paused', 'draining'].includes(state) ? planning.waitSeconds : null };
  });
  readonly statusKey = computed(() => {
    const agent = this.store.dispatcher();
    if (agent?.run_status === 'finished') return 'dispatcher.runState.finished';
    if (agent?.awaiting_approval) return 'dispatcher.live.states.awaiting_approval';
    if (this.neutralTeam()) return 'dispatcher.teamCoLearning';
    if (agent?.mode === 'director' && agent.status === 'waiting' && Number(agent.metrics['effective_directives']) > 0) {
      return 'dispatcher.activity.maintaining';
    }
    return 'dispatcher.status.' + agent?.status;
  });
  /** Project actual command stages; a waiting pulse never erases the last action. */
  readonly activity = computed(() => this.projectAction(true, true));
  /** Keep the actual command text even after ownership/lifecycle changes. */
  readonly displayAction = computed(() => this.projectAction(false, !this.proposal()));
  /** A marker describes a current interaction, independently of retained history. */
  readonly interactionTarget = computed(() => {
    const actor = this.store.dispatcher();
    if (!actor || actor.owner !== 'agent' || this.neutralTeam()
      || ['human', 'finished', 'stopped', 'error', 'offline', 'stale', 'starting'].includes(this.live().state)) return null;
    const action = this.activity();
    if (actor.pending) return { ...action, pending: true };
    if (action.command?.strategy === 'keep') return null;
    const marker = this.acknowledgedTarget();
    return marker?.sessionId === this.activeSession() && marker.commandId === action.commandId && this.now() < marker.until
      ? { ...action, pending: false } : null;
  });

  /** Explain the immutable offer that was actually assessed, never a newer forecast. */
  readonly assessment = computed(() => {
    const actor = this.store.dispatcher();
    if (!actor || this.neutralTeam()) return null;
    const result = actor.last_result ?? [...actor.events].reverse().find(event => event.kind === 'result');
    const decision = actor.pending ?? result?.decision;
    if (!decision || decision.command.kind !== 'strategy') return null;
    const offer = decision.offer;
    const selected = offer?.strategies.find(strategy => strategy.id === decision.command.strategy);
    const alternatives = offer?.strategies.filter(strategy => strategy.id !== decision.command.strategy) ?? [];
    const requiredMetrics = ['score', 'deadlocks', 'notArrivedDue', 'lateness'] as const;
    const validMetrics = (strategy: typeof selected) => !!strategy && requiredMetrics.every(key => Number.isFinite(strategy.metrics[key]));
    const comparable = alternatives.filter(validMetrics);
    const other = comparable.reduce<(typeof comparable)[number] | null>((best, strategy) =>
      !best || strategy.metrics.score < best.metrics.score ? strategy : best, null);
    const score = selected?.metrics.score;
    const comparison = !offer || !selected ? 'missing' : !alternatives.length ? 'unavailable'
      : !validMetrics(selected) || !other || comparable.length !== alternatives.length ? 'missing'
      : score! < other.metrics.score ? 'better' : score === other.metrics.score ? 'equal' : 'worse';
    const location = decision.explanation?.location?.['name'] ?? offer?.location?.name;
    const metrics = ['deadlocks', 'notArrivedDue', 'lateness'] as const;
    const availableMetrics = metrics.filter(key => Number.isFinite(selected?.metrics[key]) && Number.isFinite(other?.metrics[key]));
    const comparisonMetric = availableMetrics.find(key => selected!.metrics[key] !== other!.metrics[key]) ?? availableMetrics.at(-1);
    return {
      commandId: decision.command_id, contentionId: decision.command.contention_id,
      choice: decision.command.strategy === 'keep' ? 'maintain' as const : 'change' as const,
      action: this.strategyLabel(decision.command), pending: !!actor.pending,
      stage: actor.pending ? this.proposal()?.state ?? 'planned' : result?.result?.status ?? 'observing',
      handles: decision.command.handles ?? offer?.handles ?? [],
      location: typeof location === 'string' ? location : null,
      forecastStep: decision.explanation?.forecast_step ?? offer?.step ?? null,
      comparison, reasonKey: comparison === 'worse' && decision.reason.rule === 'explicit_pp_train_order' ? 'preference' : comparison,
      count: offer?.strategies.length ?? 0,
      selectedScore: Number.isFinite(score) ? score! : null,
      otherScore: other?.metrics.score ?? null,
      otherAction: other ? this.strategyLabel({ kind: 'strategy', strategy: other.id }) : null,
      comparisonMetric: comparisonMetric ?? null,
      selectedMetric: comparisonMetric ? selected!.metrics[comparisonMetric] : null,
      otherMetric: comparisonMetric ? other!.metrics[comparisonMetric] : null,
    };
  });

  private strategyLabel(command: DispatcherCommand): string {
    const strategy = command.strategy ?? '';
    if (strategy.startsWith('policy:')) return this.i18n.t('ca.strategy.policy', {
      policy: this.i18n.t('policies.' + strategy.slice(7) + '.label'),
    });
    return ['keep', 'pp', 'pp-human'].includes(strategy) ? this.i18n.t('dispatcher.activity.strategies.' + strategy) : strategy;
  }

  private projectAction(lifecycle: boolean, includePending: boolean) {
    const agent = this.store.dispatcher();
    const events = [...(agent?.events ?? [])].reverse();
    const result = agent?.last_result ?? events.find(e => e.kind === 'result');
    const effective = agent?.last_effective ?? events.find(e => e.kind === 'directive_effective');
    const pending = includePending ? agent?.pending : null;
    const decision = pending ?? result?.decision;
    const command = decision?.command;
    let stage = pending ? 'planned' : result?.result?.status ?? 'observing';
    if (pending && this.proposal()) stage = this.proposal()!.state;
    if (!pending && !result && agent?.mode === 'director') stage = 'preparing';
    if (effective && !pending && (!result || effective.seq > result.seq)) stage = 'effective';
    if (lifecycle && agent?.owner === 'human' && stage !== 'cancelled') stage = 'human';
    if (lifecycle && agent?.run_status === 'error') stage = 'error';
    const message = ['planned', 'executed', 'awaiting_approval', 'approved'].includes(stage) ? `${stage}_${command?.kind}` : stage;
    const weights = stage === 'effective' ? effective?.weights : command?.weights
      ? [command.weights.punctuality, command.weights.connections, command.weights.stability] : [];
    return { stage, message, command, commandId: decision?.command_id,
      targetKey: command?.kind === 'strategy' ? 'strategy:' + command.strategy + (command.contention_id ? ':' + command.contention_id : '')
        : command?.weights ? `director:${command.weights.punctuality}:${command.weights.connections}:${command.weights.stability}` : 'map',
      rule: decision?.reason.rule,
      params: { due: pending?.due ?? 0, at: stage === 'effective' ? effective?.logical_time : result?.logical_time,
        weights: weights?.join(' / ') ?? '', action: command ? this.strategyLabel(command) : '',
        reason: (lifecycle ? agent?.abort_reason : null) ?? result?.result?.reason ?? '' } };
  }
  private readonly i18n = inject(LanguageService);
}
