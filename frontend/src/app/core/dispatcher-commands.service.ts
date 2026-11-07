import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { DispatcherCommandContext, parseDispatcherCommand } from './dispatcher-commands';
import { SessionStore } from './session.store';

export const DISPATCHER_COMMANDS_STORAGE_KEY = 'flatland.dispatcher.commands.enabled';

export interface DispatcherCommandFeedback {
  key: string;
  params?: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class DispatcherCommandsService {
  private readonly store = inject(SessionStore);
  private readonly _enabled = signal(this.readPreference());
  readonly enabled = this._enabled.asReadonly();
  private readonly _draft = signal('');
  readonly draft = this._draft.asReadonly();
  private readonly _feedback = signal<DispatcherCommandFeedback | null>(null);
  readonly feedback = this._feedback.asReadonly();
  readonly busy = computed(() => !!this.store.dispatcherControlPending());
  private context: DispatcherCommandContext | null = null;
  private sessionId = this.store.session()?.id ?? null;

  constructor() {
    effect(() => {
      const sessionId = this.store.session()?.id ?? null;
      untracked(() => this.synchronizeSession(sessionId));
    });
  }

  setEnabled(enabled: boolean): void {
    this._enabled.set(enabled);
    if (!enabled) this.clear();
    try { localStorage.setItem(DISPATCHER_COMMANDS_STORAGE_KEY, String(enabled)); } catch { /* Browser preference is optional. */ }
  }

  focus(): void {
    this.synchronizeSession();
    if (this.enabled() && this.draft() === '') this.captureContext();
  }

  updateDraft(text: string): void {
    this.synchronizeSession();
    if (!this.enabled()) return;
    if (text === '') { this.clear(); return; }
    if (this.context === null) this.captureContext();
    this._draft.set(text);
    this._feedback.set(null);
  }

  submit(): void {
    this.synchronizeSession();
    if (!this.enabled() || this.busy()) { this.report('blocked'); return; }
    const command = parseDispatcherCommand(this.draft());
    if (!command) { this.report('unknown'); return; }
    const session = this.store.session();
    const actor = this.store.dispatcher();
    if (!session || !actor || !this.context || this.context.sessionId !== session.id) {
      this.report('blocked'); return;
    }
    // Pause uses the same availability as the native control, including a busy planner.
    if (command === 'pause') {
      if (!this.store.playing()) { this.report('noop'); return; }
      this.store.pause();
      this.submitted();
      return;
    }
    if (this.store.sessionCreating() || this.store.sessionOpening()) { this.report('blocked'); return; }
    const terminal = ['aborted', 'error', 'finished'].includes(actor.run_status);
    if (command === 'resume') {
      if (this.store.playing()) { this.report('noop'); return; }
      if (this.store.episodeDone() || this.store.loading() || this.store.backendBusy()
        || actor.run_status === 'error' || (terminal && actor.owner === 'agent')) {
        this.report('blocked'); return;
      }
      this.store.play(this.store.activePolicy());
      this.submitted();
      return;
    }
    if (terminal) { this.report('blocked'); return; }
    if (command === 'takeover') {
      if (actor.owner === 'human') { this.report('noop'); return; }
      this.store.dispatcherOwnership('human');
      this.submitted();
      return;
    }
    if (actor.operator_type !== 'human_dispatcher_team' || !actor.requires_approval || actor.mode === 'co-learning'
      || actor.owner !== 'agent') { this.report('blocked'); return; }
    const captured = this.context.proposal;
    const pending = actor.pending;
    if (!captured || !pending || captured.command_id !== pending.command_id
      || captured.generation !== pending.generation || captured.generation !== actor.generation) {
      this.report('stale'); return;
    }
    if (!actor.awaiting_approval || actor.approved_command_id === pending.command_id) {
      this.report(command === 'approve' && actor.approved_command_id === pending.command_id ? 'noop' : 'blocked');
      return;
    }
    this.store.dispatcherDecision(captured.command_id, captured.generation, command === 'approve' ? 'approve' : 'decline');
    this.submitted();
  }

  private captureContext(): void {
    const pending = this.store.dispatcher()?.pending;
    this.context = {
      sessionId: this.store.session()?.id ?? null,
      proposal: pending ? { command_id: pending.command_id, generation: pending.generation } : null,
    };
  }

  private synchronizeSession(sessionId = this.store.session()?.id ?? null): void {
    if (sessionId === this.sessionId) return;
    this.sessionId = sessionId;
    this.clear();
  }

  private clear(): void {
    this._draft.set('');
    this._feedback.set(null);
    this.context = null;
  }

  private submitted(): void {
    this.clear();
    this.report('submitted');
  }

  private report(result: 'submitted' | 'unknown' | 'stale' | 'blocked' | 'noop'): void {
    this._feedback.set({ key: `dispatcher.commands.feedback.${result}` });
  }

  private readPreference(): boolean {
    try { return localStorage.getItem(DISPATCHER_COMMANDS_STORAGE_KEY) === 'true'; } catch { return false; }
  }
}
