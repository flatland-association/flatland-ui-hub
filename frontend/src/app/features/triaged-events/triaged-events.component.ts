import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, HostBinding, Input, OnDestroy, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppNotification } from '../../core/events/event-types';
import { NotificationPollingService } from '../../core/notification-polling.service';
import { NotificationWordingService } from '../../core/notification-wording.service';
import { SessionStore } from '../../core/session.store';
import { TrainIdentityService } from '../../core/train-identity.service';
import { EventBusService } from '../../core/events/event-bus.service';

type Urgency = 'act-now' | 'soon' | 'observe';

interface TriagedEvent {
  notification: AppNotification;
  urgency: Urgency;
  remaining: number | null;
  relatedTrain: number | null;
}

@Component({
  selector: 'app-triaged-events',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './triaged-events.component.html',
  styleUrl: './triaged-events.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class TriagedEventsComponent implements OnDestroy {
  @Input() embedded = false;

  @HostBinding('class.embedded')
  get embeddedClass(): boolean {
    return this.embedded;
  }

  readonly store = inject(SessionStore);
  private readonly identity = inject(TrainIdentityService);
  private readonly bus = inject(EventBusService);
  private readonly wording = inject(NotificationWordingService);
  private readonly releasePolling = inject(NotificationPollingService).acquire();

  ngOnDestroy(): void {
    this.releasePolling();
  }

  readonly events = computed<TriagedEvent[]>(() =>
    this.store.notifications()
      .map((notification) => this.triage(notification))
      .sort((a, b) => {
        const urgency = { 'act-now': 0, soon: 1, observe: 2 };
        return urgency[a.urgency] - urgency[b.urgency]
          || (a.remaining ?? Number.POSITIVE_INFINITY) - (b.remaining ?? Number.POSITIVE_INFINITY)
          || b.notification.timestamp - a.notification.timestamp;
      }),
  );

  private triage(notification: AppNotification): TriagedEvent {
    const relatedTrain = this.relatedTrain(notification);
    const agent = relatedTrain == null
      ? undefined
      : this.store.agents().find((candidate) => candidate.handle === relatedTrain);
    const remaining = agent?.time_to_deadline ?? null;
    const urgency: Urgency = notification.kind === 'error' || agent?.is_malfunctioning
      ? 'act-now'
      : notification.kind === 'warning' || (remaining != null && remaining <= 10)
        ? 'soon'
        : 'observe';
    return { notification, urgency, remaining, relatedTrain };
  }

  relatedTrain(notification: AppNotification): number | null {
    if (notification.relatedElement?.kind === 'train') {
      const handle = Number(notification.relatedElement.id);
      return Number.isFinite(handle) ? handle : null;
    }
    const text = `${notification.title} ${notification.message}`;
    const match = text.match(/\b(?:train|agent)\s*#?\s*(\d+)\b/i);
    return match ? Number(match[1]) : null;
  }

  titleOf(notification: AppNotification): string {
    return this.wording.titleOf(notification);
  }

  messageOf(notification: AppNotification): string {
    return this.wording.messageOf(notification);
  }

  trainName(handle: number): string {
    return this.identity.nameFor(handle);
  }

  urgencyLabel(urgency: Urgency): string {
    return `triagedEvents.urgency.${urgency}`;
  }

  select(event: TriagedEvent): void {
    if (event.relatedTrain != null) {
      this.store.toggleAgentSelection(event.relatedTrain);
      return;
    }
    const related = event.notification.relatedElement;
    if (related) {
      this.bus.emit({ type: 'FOCUS_INFRASTRUCTURE_ELEMENT', kind: related.kind, id: related.id });
    }
  }

  dismiss(event: TriagedEvent, click: Event): void {
    click.stopPropagation();
    this.bus.emit({ type: 'NOTIFICATION_DISMISSED', notificationId: event.notification.id });
    this.store.notifications.update((current) =>
      current.filter((notification) => notification.id !== event.notification.id),
    );
  }
}
