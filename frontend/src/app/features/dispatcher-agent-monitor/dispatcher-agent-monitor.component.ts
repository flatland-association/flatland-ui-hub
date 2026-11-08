import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, ElementRef, afterEveryRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { DispatcherCommandsService } from '../../core/dispatcher-commands.service';
import { DispatcherActivityService } from '../../core/dispatcher-activity.service';
import { DispatcherTargets } from '../../core/dispatcher-target.directive';
import { ApiService } from '../../core/api.service';
import { TrainIdentityService } from '../../core/train-identity.service';
import { LanguageService } from '../../core/i18n/language.service';
import { DispatcherCommand } from '../../core/dispatcher';

/** Presentation-only overlay; the server remains the single command executor. */
@Component({
  selector: 'app-dispatcher-activity-overlay', standalone: true, imports: [TranslocoPipe, JsonPipe],
  templateUrl: './dispatcher-agent-monitor.component.html',
  styleUrl: './dispatcher-agent-monitor.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class DispatcherAgentMonitorComponent {
  readonly source = inject(DispatcherActivityService);
  readonly commands = inject(DispatcherCommandsService);
  readonly commandComposing = signal(false);
  readonly store = this.source.store;
  readonly activity = this.source.activity;
  readonly displayAction = this.source.displayAction;
  readonly live = this.source.live;
  readonly proposal = this.source.proposal;
  readonly assessment = this.source.assessment;
  readonly isTeam = this.source.isTeam;
  readonly avatarRevision = signal(0);
  readonly activityOpen = signal(false);
  readonly commandHelpOpen = signal(false);
  readonly queue = computed(() => this.store.dispatcher()?.queue ?? []);
  readonly evidence = computed(() => {
    if (this.source.neutralTeam()) return null;
    const actor = this.store.dispatcher();
    const decision = actor?.pending ?? actor?.last_result?.decision ?? [...(actor?.events ?? [])].reverse().find(event => event.kind === 'result' && event.decision?.explanation)?.decision;
    if (!decision?.explanation) return null;
    const explanation = decision.explanation;
    const rows = ['lateness', 'lateTrains', 'notArrivedDue', 'deadlocks', 'arrived'].flatMap(key => {
      const baseline = explanation.baseline_metrics?.[key];
      const selected = explanation.selected_metrics?.[key];
      const delta = explanation.forecast_delta?.[key];
      return typeof baseline === 'number' && Number.isFinite(baseline)
        && typeof selected === 'number' && Number.isFinite(selected)
        && typeof delta === 'number' && Number.isFinite(delta) ? [{ key, baseline, selected, delta }] : [];
    });
    return { decision, explanation, rows };
  });
  readonly observedEffect = computed(() => {
    if (this.source.neutralTeam()) return null;
    const actor = this.store.dispatcher();
    const effect = actor?.effects?.at(-1);
    if (!effect) return null;
    const result = actor?.last_result?.decision?.command_id === effect.command_id ? actor.last_result : null;
    const command = (result ?? [...(actor?.events ?? [])].reverse().find(event => event.decision?.command_id === effect.command_id))?.decision?.command;
    return { effect, action: command ? this.commandLabel(command) : null };
  });
  readonly bubble = viewChild<ElementRef<HTMLElement>>('bubble');
  readonly position = signal({ x: 24, y: 90, cursorX: 0, cursorY: 0, target: '', label: '', cursor: false, auditTop: 190, maxHeight: Math.max(0, innerHeight - 132) });
  private readonly targets = inject(DispatcherTargets);
  private readonly api = inject(ApiService);
  private readonly identity = inject(TrainIdentityService);
  private readonly i18n = inject(LanguageService);

  trainNames(handles: readonly number[]): string {
    return handles.map(handle => this.identity.nameFor(handle)).join(' · ');
  }

  private commandLabel(command: DispatcherCommand): string {
    if (command.weights) return this.i18n.t('dispatcher.bubble.directive', {
      weights: [command.weights.punctuality, command.weights.connections, command.weights.stability].join(' / '),
    });
    const strategy = command.strategy ?? '';
    if (strategy.startsWith('policy:')) {
      return this.i18n.t('ca.strategy.policy', { policy: this.i18n.t('policies.' + strategy.slice(7) + '.label') });
    }
    return this.i18n.t('dispatcher.activity.strategies.' + strategy);
  }
  private frame = 0;
  private revealed = '';
  private previousRevision: number | undefined;
  private observed: Element | null = null;
  private readonly resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.schedulePosition());

  constructor() {
    effect(() => {
      if (!this.commands.enabled()) this.commandComposing.set(false);
    });
    effect(() => {
      const revision = this.live().revision;
      if (this.previousRevision !== undefined && revision > this.previousRevision) {
        this.avatarRevision.update(value => value + 1);
      }
      this.previousRevision = revision;
    });
    effect(() => {
      this.activity(); this.source.interactionTarget(); this.live(); this.targets.elements(); this.bubble(); this.activityOpen();
      this.schedulePosition();
    });
    afterEveryRender(() => this.schedulePosition());
    const reposition = () => this.schedulePosition();
    window.addEventListener('resize', reposition);
    document.addEventListener('scroll', reposition, true);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') this.source.logOpen.set(false); };
    document.addEventListener('keydown', escape);
    inject(DestroyRef).onDestroy(() => {
      cancelAnimationFrame(this.frame); this.resizeObserver?.disconnect();
      window.removeEventListener('resize', reposition);
      document.removeEventListener('scroll', reposition, true);
      document.removeEventListener('keydown', escape);
    });
  }

  private schedulePosition(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.positionOverlay());
  }

  private positionOverlay(): void {
    const actor = this.store.dispatcher();
    if (!actor) return;
    const action = this.source.interactionTarget();
    const entries = this.targets.elements();
    const live = this.live();
    const owns = actor.owner === 'agent' && !['error', 'aborted'].includes(actor.run_status)
      && !['human', 'finished', 'stopped', 'error', 'offline', 'stale', 'starting'].includes(live.state);
    const candidates = owns && action?.commandId && action.targetKey !== 'map' ? entries.get(action.targetKey) ?? [] : [];
    let target = candidates.find(element => element.isConnected && element.getClientRects().length);
    // The demonstration reveals the actual control once per command, like an
    // operator opening its card. It never clicks or moves keyboard focus.
    const commandKey = this.store.session()?.id + ':' + action?.commandId;
    const mayReveal = live.confirmed && ['observing', 'planning', 'acting', 'waiting', 'awaiting_approval', 'approved'].includes(live.state);
    if (target && mayReveal && action?.pending && action.commandId && commandKey !== this.revealed) {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      this.revealed = commandKey;
    }
    let rect = target?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0 || rect.bottom < 80 || rect.top > innerHeight - 50 || rect.right < 0 || rect.left > innerWidth) {
      target = undefined; rect = undefined;
    }
    const map = (entries.get('map') ?? []).find(element => element.isConnected && element.getBoundingClientRect().height > 0);
    const fallback = map?.getBoundingClientRect();
    // Reserve the actual toolbar, including wrapped ownership controls. A
    // bubble above its target must never cover Pause, takeover or delegation.
    const toolbars = (entries.get('toolbar') ?? []).filter(element => {
      const bounds = element.getBoundingClientRect();
      return element.isConnected && bounds.height > 0 && bounds.bottom > 0 && bounds.top < innerHeight;
    });
    const top = Math.max(76, ...toolbars.map(element => element.getBoundingClientRect().bottom + 8));
    const maxHeight = Math.max(0, innerHeight - top - 56);
    const width = Math.min(350, innerWidth - 24);
    const height = Math.min(this.bubble()?.nativeElement.getBoundingClientRect().height ?? 120, maxHeight);
    const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, Math.max(low, high)));
    let x = (fallback?.right ?? innerWidth) - width - 18;
    let y = (fallback?.top ?? 80) + 16;
    if (rect) {
      x = rect.left >= width + 24 ? rect.left - width - 18 : rect.right + 18;
      y = rect.top - height - 14;
      if (y < top) y = rect.bottom + 14;
    }
    const next = {
      x: clamp(x, 12, innerWidth - width - 12), y: clamp(y, top, innerHeight - height - 56), maxHeight,
      cursorX: rect ? rect.left + rect.width / 2 : 0,
      cursorY: rect ? rect.top + rect.height / 2 : 0,
      target: rect && action ? action.targetKey : 'map', label: rect ? target?.getAttribute('data-dispatcher-caption') ?? '' : '', cursor: !!rect && owns,
      auditTop: (entries.get('toolbar')?.[0]?.getBoundingClientRect().bottom ?? 180) + 8,
    };
    if (JSON.stringify(next) !== JSON.stringify(this.position())) this.position.set(next);
    const observed = target ?? map;
    if (observed && this.observed !== observed) {
      this.resizeObserver?.disconnect();
      let ancestor: Element | null = observed;
      while (ancestor && ancestor !== document.body) {
        this.resizeObserver?.observe(ancestor); ancestor = ancestor.parentElement;
      }
      if (this.bubble()) this.resizeObserver?.observe(this.bubble()!.nativeElement);
      this.observed = observed;
    }
    toolbars.forEach(element => this.resizeObserver?.observe(element));
  }

  commandKeydown(event: KeyboardEvent): void {
    // Text editing and dictation must not trigger application shortcuts.
    event.stopPropagation();
    if (event.key !== 'Enter') return;
    if (event.isComposing || this.commandComposing()) return;
    event.preventDefault();
    if (event.repeat) return;
    this.submitCommand();
  }

  submitCommand(): void {
    if (!this.commandComposing()) this.commands.submit();
  }

  exportRun(): void {
    const id = this.store.session()?.id;
    if (!id) return;
    this.api.dispatcherExport(id).subscribe({ next: data => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `synthetic-dispatcher-${id}.json`; link.click(); URL.revokeObjectURL(url);
    }, error: error => this.store.error.set(error.message) });
  }
}
