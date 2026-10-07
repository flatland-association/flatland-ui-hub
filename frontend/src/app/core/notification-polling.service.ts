import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { SessionStore } from './session.store';

/**
 * Keeps `SessionStore.notifications` filled from the backend while at least one
 * panel that shows them is on screen (the notification list, the triaged event
 * feed). Until this existed the notification panel polled on its own, so a
 * layout that showed the triaged feed without it got no events at all.
 *
 * Polling is throttled to ~2 s while a session is active — refetching on every
 * state update blocked /pause and made Play feel unresponsive (see
 * strategy-comparison for the same fix) — plus one immediate fetch on a new session
 * and when Play stops, so fresh notifications show right after pausing.
 */
@Injectable({ providedIn: 'root' })
export class NotificationPollingService {
  private readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly consumers = signal(0);
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private lastSession: string | null = null;
  private lastPlaying = false;

  constructor() {
    effect(() => {
      const sess = this.store.session();
      const playing = this.store.playing();
      const active = this.consumers() > 0;
      untracked(() => {
        if (!sess) this.store.notifications.set([]);
        if (!sess || !active) {
          this.stop();
          this.lastSession = null;
          this.lastPlaying = false;
          return;
        }

        const sessionChanged = sess.id !== this.lastSession;
        if (sessionChanged || (this.lastPlaying && !playing)) this.fetch(sess.id);
        if (sessionChanged) {
          this.stop();
          this.pollHandle = setInterval(() => this.fetch(sess.id), 2000);
        }
        this.lastSession = sess.id;
        this.lastPlaying = playing;
      });
    });
  }

  /** Start polling on behalf of one panel; call the returned function on destroy. */
  acquire(): () => void {
    this.consumers.update((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.consumers.update((n) => n - 1);
    };
  }

  private fetch(sessionId: string): void {
    this.api.getNotifications(sessionId).subscribe({
      next: (notifications) => this.store.notifications.set(notifications),
      error: () => {},
    });
  }

  private stop(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
  }
}
