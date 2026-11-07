import { Component, CUSTOM_ELEMENTS_SCHEMA, DestroyRef, ElementRef, afterEveryRender, effect, inject, signal, viewChild } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { DispatcherActivityService } from '../../core/dispatcher-activity.service';
import { DispatcherTargets } from '../../core/dispatcher-target.directive';
import { ApiService } from '../../core/api.service';

/** Presentation-only overlay; the server remains the single command executor. */
@Component({
  selector: 'app-dispatcher-activity-overlay', standalone: true, imports: [TranslocoPipe, JsonPipe],
  templateUrl: './dispatcher-agent-monitor.component.html',
  styleUrl: './dispatcher-agent-monitor.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class DispatcherAgentMonitorComponent {
  readonly source = inject(DispatcherActivityService);
  readonly store = this.source.store;
  readonly activity = this.source.activity;
  readonly displayAction = this.source.displayAction;
  readonly live = this.source.live;
  readonly proposal = this.source.proposal;
  readonly isTeam = this.source.isTeam;
  readonly avatarRevision = signal(0);
  readonly activityOpen = signal(true);
  readonly bubble = viewChild<ElementRef<HTMLElement>>('bubble');
  readonly position = signal({ x: 24, y: 90, cursorX: 0, cursorY: 0, target: '', label: '', cursor: false, auditTop: 190 });
  private readonly targets = inject(DispatcherTargets);
  private readonly api = inject(ApiService);
  private frame = 0;
  private revealed = '';
  private previousRevision: number | undefined;
  private observed: Element | null = null;
  private readonly resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.schedulePosition());

  constructor() {
    effect(() => {
      const revision = this.live().revision;
      if (this.previousRevision !== undefined && revision > this.previousRevision) {
        this.avatarRevision.update(value => value + 1);
      }
      this.previousRevision = revision;
    });
    effect(() => {
      this.activity(); this.live(); this.targets.elements(); this.bubble(); this.activityOpen();
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
    const action = this.activity();
    const entries = this.targets.elements();
    const live = this.live();
    const owns = actor.owner === 'agent' && !['error', 'aborted'].includes(actor.run_status)
      && !['human', 'finished', 'stopped', 'error', 'offline', 'stale', 'starting'].includes(live.state);
    const candidates = owns && action.commandId && action.targetKey !== 'map' ? entries.get(action.targetKey) ?? [] : [];
    let target = candidates.find(element => element.isConnected && element.getClientRects().length);
    // The demonstration reveals the actual control once per command, like an
    // operator opening its card. It never clicks or moves keyboard focus.
    const commandKey = this.store.session()?.id + ':' + action.commandId;
    const mayReveal = live.confirmed && ['observing', 'planning', 'acting', 'waiting', 'awaiting_approval', 'approved'].includes(live.state);
    if (target && mayReveal && action.commandId && commandKey !== this.revealed) {
      target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      this.revealed = commandKey;
    }
    let rect = target?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0 || rect.bottom < 80 || rect.top > innerHeight - 50 || rect.right < 0 || rect.left > innerWidth) {
      target = undefined; rect = undefined;
    }
    const map = (entries.get('map') ?? []).find(element => element.isConnected && element.getBoundingClientRect().height > 0);
    const fallback = map?.getBoundingClientRect();
    const width = Math.min(350, innerWidth - 24);
    const height = this.bubble()?.nativeElement.getBoundingClientRect().height ?? 120;
    const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, Math.max(low, high)));
    let x = (fallback?.right ?? innerWidth) - width - 18;
    let y = (fallback?.top ?? 80) + 16;
    if (rect) {
      x = rect.left >= width + 24 ? rect.left - width - 18 : rect.right + 18;
      y = rect.top - height - 14;
      if (y < 76) y = rect.bottom + 14;
    }
    const next = {
      x: clamp(x, 12, innerWidth - width - 12), y: clamp(y, 76, innerHeight - height - 56),
      cursorX: rect ? rect.left + rect.width / 2 : 0,
      cursorY: rect ? rect.top + rect.height / 2 : 0,
      target: rect ? action.targetKey : 'map', label: rect ? target?.getAttribute('data-dispatcher-caption') ?? '' : '', cursor: !!rect && owns,
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
