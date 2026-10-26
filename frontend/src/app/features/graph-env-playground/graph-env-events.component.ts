// Copied from frontend/src/app/features/triaged-events/triaged-events.component.ts at 2f4dbcb; keep the diff to it minimal (docs/plans/graph-env-playground.md §9).
import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, HostBinding, Input, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { AppNotification } from '../../core/events/event-types';
import { GraphEnvStore } from './graph-env.store';

type Urgency = 'act-now' | 'soon' | 'observe';

interface TriagedEvent {
  notification: AppNotification;
  urgency: Urgency;
  remaining: number | null;
  relatedTrain: number | null;
}

@Component({
  selector: 'app-graph-env-events',
  standalone: true,
  imports: [CommonModule, TranslocoPipe],
  templateUrl: './graph-env-events.component.html',
  styleUrl: './graph-env-events.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class GraphEnvEventsComponent {
  @Input() embedded = false;

  @HostBinding('class.embedded')
  get embeddedClass(): boolean {
    return this.embedded;
  }

  /** No polling, wording or event bus yet: the graph env sends no notifications, so the feed stays empty. */
  readonly store = inject(GraphEnvStore);

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
    return notification.title;
  }

  messageOf(notification: AppNotification): string {
    return notification.message;
  }

  trainName(handle: number): string {
    return String(handle);
  }

  urgencyLabel(urgency: Urgency): string {
    return `triagedEvents.urgency.${urgency}`;
  }

  select(event: TriagedEvent): void {
    if (event.relatedTrain != null) {
      this.store.toggleAgentSelection(event.relatedTrain);
    }
  }

  dismiss(event: TriagedEvent, click: Event): void {
    click.stopPropagation();
    this.store.notifications.update((current) =>
      current.filter((notification) => notification.id !== event.notification.id),
    );
  }
}
