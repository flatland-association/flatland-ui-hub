import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, HostBinding, Input, inject, OnDestroy} from '@angular/core';
import { SessionStore } from '../../core/session.store';
import { TrainIdentityService } from '../../core/train-identity.service';
import { NotificationPollingService } from '../../core/notification-polling.service';
import { NotificationWordingService } from '../../core/notification-wording.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { AgentColorService } from '../../core/agent-color.service';
import { AppNotification } from '../../core/events/event-types';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-notifications-panel',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './notifications-panel.component.html',
  styleUrl: './notifications-panel.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class NotificationsPanelComponent implements OnDestroy {
  @Input() embedded = false;

  @HostBinding('class.embedded')
  get embeddedClass(): boolean {
    return this.embedded;
  }

  store = inject(SessionStore);
  bus = inject(EventBusService);
  colors = inject(AgentColorService);
  private readonly identity = inject(TrainIdentityService);

  private readonly releasePolling = inject(NotificationPollingService).acquire();

  private readonly wording = inject(NotificationWordingService);

  titleOf(n: AppNotification): string {
    return this.wording.titleOf(n);
  }

  messageOf(n: AppNotification): string {
    return this.wording.messageOf(n);
  }

  /** Backend texts name trains by handle; show the shared name instead. */
  named(text: string | null | undefined): string {
    return this.wording.named(text);
  }

  relatedLabel(n: AppNotification): string {
    const related = n.relatedElement;
    if (!related) return '';
    if (related.kind === 'train' && Number.isFinite(Number(related.id))) {
      return this.identity.nameFor(Number(related.id));
    }
    return `${related.kind} #${related.id}`;
  }

  notificationAgentHandles(n: AppNotification): number[] {
    const out = new Set<number>();

    // Structured relation from backend.
    if (n.relatedElement?.kind === 'train') {
      const h = Number(n.relatedElement.id);
      if (Number.isFinite(h)) out.add(h);
    }

    // Defensive fallback: parse "Train 2", "Train #2", "Agent 2",
    // "agent #2" from title/message.
    const text = `${n.title ?? ''} ${n.message ?? ''}`;
    const re = /\b(?:train|agent)\s*#?\s*(\d+)\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const h = Number(m[1]);
      if (Number.isFinite(h)) out.add(h);
    }

    return Array.from(out);
  }

  primaryNotificationAgentHandle(n: AppNotification): number | null {
    const handles = this.notificationAgentHandles(n);
    if (handles.length === 0) return null;

    // If one of the notification-related agents is already selected,
    // clicking the notification should behave exactly like clicking that
    // selected agent again: toggle it off.
    const selected = this.store.selectedHandle();
    if (selected != null && handles.includes(selected)) {
      return selected;
    }

    // Otherwise select the first related agent.
    return handles[0];
  }

  singleNotificationAgentHandle(n: AppNotification): number | null {
    const handles = this.notificationAgentHandles(n);
    return handles.length === 1 ? handles[0] : null;
  }

  notificationAgentColor(n: AppNotification): string | null {
    const h = this.singleNotificationAgentHandle(n);
    return h == null ? null : this.colors.getColorSolid(h);
  }

  isAgentRelated(n: AppNotification): boolean {
    return this.notificationAgentHandles(n).length > 0;
  }

  isSelectedAgentRelated(n: AppNotification): boolean {
    const selected = this.store.selectedHandle();
    if (selected == null) return false;
    return this.notificationAgentHandles(n).includes(selected);
  }

  isHoveredAgentRelated(n: AppNotification): boolean {
    const hovered = this.store.notificationHoverHandles();
    if (hovered.size === 0) return false;
    return this.notificationAgentHandles(n).some((h) => hovered.has(h));
  }


  onNotificationMouseEnter(n: AppNotification): void {
    const handles = this.notificationAgentHandles(n);

    if (handles.length > 0) {
      // Same cross-panel hover behaviour as hovering agent(s) directly.
      this.store.setAgentHoverAgents(handles);
    }
  }

  onNotificationMouseLeave(): void {
    // Same cross-panel hover clear behaviour as leaving an agent.
    this.store.clearAgentHoverAgents();
  }

  onNotificationClick(n: AppNotification): void {
    const handle = this.primaryNotificationAgentHandle(n);

    if (handle != null) {
      // Same behaviour as clicking the agent in the Flatland grid map:
      // select if not selected, deselect if already selected.
      this.store.toggleAgentSelection(handle);
      return;
    }

    // Non-agent notifications keep the previous infrastructure focus behaviour.
    if (n.relatedElement) {
      this.bus.emit({
        type: 'FOCUS_INFRASTRUCTURE_ELEMENT',
        kind: n.relatedElement.kind,
        id: n.relatedElement.id,
      });
    }
  }

  dismiss(n: AppNotification, event: Event) {
    event.stopPropagation();
    this.bus.emit({ type: 'NOTIFICATION_DISMISSED', notificationId: n.id });
    const cur = this.store.notifications();
    this.store.notifications.set(cur.filter((x) => x.id !== n.id));
  }

  errorCount(): number {
    return this.store.notifications().filter((n) => n.kind === 'error').length;
  }

  warningCount(): number {
    return this.store.notifications().filter((n) => n.kind === 'warning').length;
  }

  ngOnDestroy() {
    this.releasePolling();
  }
}
