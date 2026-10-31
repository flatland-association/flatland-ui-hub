import { Injectable, computed, inject, signal } from '@angular/core';
import type { SessionState } from '../models';
import { SessionStore } from '../session.store';
import { WebSocketService } from '../websocket.service';
import type { SessionRecord } from '../interaction-log/session-record';
import type { StateFrame } from '../interaction-log/state-log.service';
import { applyFrame, isReplayable, legAt, sessionSpan } from './replay-timeline';

/** How often the replay clock advances while playing. */
export const REPLAY_TICK_MS = 100;

/**
 * Plays a recorded session back on the normal working screen
 * (docs/plans/experiment-logging-frontend-and-replay.md §9.2): it takes the
 * place of the live sources instead of adding a second UI. `SessionStore` is
 * fed from the `states` stream in place of the WebSocket, which stays closed;
 * `store.replayActive()` makes the screen read-only and stops all logging.
 */
@Injectable({ providedIn: 'root' })
export class ReplayService {
  private readonly store = inject(SessionStore);
  private readonly ws = inject(WebSocketService);

  /** The sessions being replayed, in order: one leg, or every leg of a run. */
  readonly legs = signal<SessionRecord[]>([]);
  /** The recorded moment on screen (epoch ms). */
  readonly time = signal(0);
  readonly playing = signal(false);
  readonly active = computed(() => this.legs().length > 0);
  readonly start = computed(() => (this.legs().length ? sessionSpan(this.legs()[0]).start : 0));
  readonly end = computed(() => (this.legs().length ? sessionSpan(this.legs()[this.legs().length - 1]).end : 0));
  /** Index into `legs` of the session on screen. */
  readonly legIndex = computed(() => legAt(this.legs(), this.time()));
  readonly leg = computed<SessionRecord | null>(() => this.legs()[this.legIndex()] ?? null);

  /** What has been applied of the current leg, so a step forward only applies what is new. */
  private _applied: { leg: number; time: number; frames: number; state: SessionState | null } | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;

  /** Start replaying these sessions (only those with train movements). Returns false if none can be. */
  load(records: readonly SessionRecord[]): boolean {
    const legs = records.filter(isReplayable).sort((a, b) => a.header.startedAt - b.header.startedAt);
    if (!legs.length) return false;
    this.pause();
    this.ws.disconnect();
    this.store.playing.set(false);
    this.store.replayActive.set(true);
    this._applied = null;
    this.legs.set(legs);
    this.seek(sessionSpan(legs[0]).start);
    return true;
  }

  play(): void {
    if (!this.active() || this._timer) return;
    if (this.time() >= this.end()) this.seek(this.start());
    this.playing.set(true);
    this._timer = setInterval(() => this._tick(), REPLAY_TICK_MS);
  }

  pause(): void {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.playing.set(false);
  }

  /** Show the recorded moment `t`. */
  seek(t: number): void {
    const time = Math.min(Math.max(t, this.start()), this.end());
    this.time.set(time);
    this._apply(time);
  }

  /** Leave the replay: the start screen, with nothing of the replay left in the store. */
  exit(): void {
    this.pause();
    this.legs.set([]);
    this._applied = null;
    this.store.session.set(null);
    this.store.state.set(null);
    this.store.trajectories.set(new Map());
    this.store.replayActive.set(false);
  }

  private _tick(): void {
    const next = this.time() + REPLAY_TICK_MS;
    this.seek(next);
    if (next >= this.end()) this.pause();
  }

  /** Bring the store to `t`: forwards from what is shown, or the leg from its start. */
  private _apply(t: number): void {
    const index = legAt(this.legs(), t);
    const leg = this.legs()[index];
    if (!leg) return;
    if (!this._applied || this._applied.leg !== index || t < this._applied.time) this._startLeg(index, leg);
    const applied = this._applied!;
    const frames = (leg.states ?? []) as StateFrame[];
    let state = applied.state;
    let i = applied.frames;
    for (; i < frames.length && frames[i].t <= t; i++) {
      state = applyFrame(state, frames[i]);
      if (state) this.store.applyReplayState(state);
    }
    this._applied = { ...applied, time: t, frames: i, state };
  }

  /** A leg comes on screen: its session, mode and an empty map, as when it started. */
  private _startLeg(index: number, leg: SessionRecord): void {
    const h = leg.header;
    this.store.trajectories.set(new Map());
    this.store.state.set(null);
    this.store.interactionMode.set(h.mode);
    this.store.session.set({
      id: h.sessionId,
      width: h.grid?.width ?? 0,
      height: h.grid?.height ?? 0,
      num_agents: h.grid?.numAgents ?? 0,
      scenario_preset_id: h.scenarioId,
      disturbance_ids: h.disturbanceIds,
    });
    this._applied = { leg: index, time: h.startedAt, frames: 0, state: null };
  }
}
