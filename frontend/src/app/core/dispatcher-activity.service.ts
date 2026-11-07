import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SessionStore } from './session.store';
import { LanguageService } from './i18n/language.service';
import { WebSocketService } from './websocket.service';
import { DirectorProgress } from './api.service';

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
  private projectAction(lifecycle: boolean, includePending: boolean) {
    const agent = this.store.dispatcher();
    const events = [...(agent?.events ?? [])].reverse();
    const result = events.find(e => e.kind === 'result');
    const effective = events.find(e => e.kind === 'directive_effective');
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
    const strategy = command?.strategy;
    const knownStrategy = strategy && ['keep', 'pp', 'pp-human'].includes(strategy);
    return { stage, message, command, commandId: decision?.command_id,
      targetKey: command?.kind === 'strategy' ? 'strategy:' + command.strategy
        : command?.weights ? `director:${command.weights.punctuality}:${command.weights.connections}:${command.weights.stability}` : 'map',
      rule: decision?.reason.rule,
      params: { due: pending?.due ?? 0, at: stage === 'effective' ? effective?.logical_time : result?.logical_time,
        weights: weights?.join(' / ') ?? '', action: knownStrategy ? this.i18n.t(`dispatcher.activity.strategies.${strategy}`) : strategy ?? '',
        reason: (lifecycle ? agent?.abort_reason : null) ?? result?.result?.reason ?? '' } };
  }
  private readonly i18n = inject(LanguageService);
}
