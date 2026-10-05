import { Injectable, inject } from '@angular/core';
import { AppNotification } from './events/event-types';
import { LanguageService } from './i18n/language.service';
import { TrainIdentityService } from './train-identity.service';

/**
 * How a notification reads on screen, shared by every panel that lists them.
 *
 * A notification with a code is worded from translation keys in the viewer's
 * language; the English title/message from the backend is the fallback, for
 * codes a language does not cover and for notifications without a code.
 * Scripted disturbances carry their authored text under
 * `disturbances.<file>.events.<index>`.
 */
@Injectable({ providedIn: 'root' })
export class NotificationWordingService {
  private readonly i18n = inject(LanguageService);
  private readonly identity = inject(TrainIdentityService);

  titleOf(n: AppNotification): string {
    const p = n.params ?? {};
    if (n.code === 'disturbance.event' && p['disturbance'] != null) {
      return this.i18n.t(`disturbances.${p['disturbance']}.events.${p['event']}.label`, undefined, this.named(n.title));
    }
    if (n.code) return this.i18n.t(`notifications.${n.code}.title`, this.resolvedParams(n), this.named(n.title));
    return this.named(n.title);
  }

  messageOf(n: AppNotification): string {
    const p = n.params ?? {};
    if (n.code === 'disturbance.event' && p['disturbance'] != null) {
      return this.i18n.t(`disturbances.${p['disturbance']}.events.${p['event']}.description`, undefined, this.named(n.message));
    }
    if (n.code) return this.i18n.t(`notifications.${n.code}.message`, this.resolvedParams(n), this.named(n.message));
    return this.named(n.message);
  }

  /** Backend texts name trains by handle; show the shared name instead. */
  named(text: string | null | undefined): string {
    return this.identity.withTrainNames(text ?? '');
  }

  /** Values as the sentence shows them: the train's shared name instead of its
   *  handle, and direction / cell type in the viewer's language. */
  private resolvedParams(n: AppNotification): Record<string, unknown> {
    const p: Record<string, unknown> = { ...(n.params ?? {}) };
    if (p['train'] != null && Number.isFinite(Number(p['train']))) {
      p['train'] = this.identity.nameFor(Number(p['train']));
    }
    if (typeof p['direction'] === 'string') {
      p['direction'] = this.i18n.t(`notifications.direction.${p['direction']}`, undefined, String(p['direction']).toUpperCase());
    }
    if (typeof p['cell'] === 'string') {
      p['cell'] = this.i18n.t(`notifications.cell.${p['cell']}`, undefined, String(p['cell']));
    }
    return p;
  }
}
