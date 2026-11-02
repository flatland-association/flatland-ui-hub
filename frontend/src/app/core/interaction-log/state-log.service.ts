import { DestroyRef, Injectable, inject } from '@angular/core';
import type { AgentDTO, SessionState } from '../models';
import { WebSocketService } from '../websocket.service';
import { InteractionLogService } from './interaction-log.service';

/**
 * One state message as a replay frame (docs/plans/experiment-logging-frontend-and-replay.md
 * §5.4.1), in stream `states`. Only the trains that changed are in it; the
 * first frame of a session (and the first after a scenario change) also
 * carries the map and every train.
 */
export interface StateFrame {
  seq: number;
  t: number;
  simStep: number;
  /** Set when it changed since the previous frame. */
  maxSteps?: number;
  episodeDone?: boolean;
  agents: AgentDTO[];
  map?: Pick<SessionState, 'width' | 'height' | 'rail_grid' | 'rail_tiles' | 'decision_cells'>;
}

/**
 * Writes every WebSocket state message into stream `states`, as delta frames.
 * Reads `WebSocketService.messages`, not the `lastMessage` signal, which
 * coalesces messages that arrive between two effect runs (pattern P4).
 */
@Injectable({ providedIn: 'root' })
export class StateLogService {
  private readonly log = inject(InteractionLogService);
  private _seq = 0;
  private _sid: string | null = null;
  private _mapKey: string | null = null;
  private _maxSteps: number | null = null;
  private _episodeDone = false;
  private readonly _agents = new Map<number, string>();

  constructor() {
    const sub = inject(WebSocketService).messages.subscribe((msg) => {
      if (msg.type === 'state' && msg.state) this.frame(msg.state);
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  /** Turn one state into a frame (exposed for tests). */
  frame(state: SessionState): void {
    const sid = this.log.header()?.sessionId ?? null;
    // Off: no diffing work either; the next frame after switching on carries the map.
    if (!sid || !this.log.studyLoggingActive()) {
      this._sid = null;
      return;
    }
    if (sid !== this._sid) this._reset(sid);
    const mapKey = `${state.width}x${state.height}:${state.infrastructure_scene_id ?? ''}`;
    const withMap = mapKey !== this._mapKey;
    const agents = (state.agents ?? []).filter((a) => {
      const json = JSON.stringify(a);
      if (!withMap && this._agents.get(a.handle) === json) return false;
      this._agents.set(a.handle, json);
      return true;
    });
    const frame: StateFrame = { seq: ++this._seq, t: Date.now(), simStep: state.elapsed_steps ?? 0, agents };
    if (withMap || state.max_episode_steps !== this._maxSteps) frame.maxSteps = state.max_episode_steps;
    if (withMap || !!state.episode_done !== this._episodeDone) frame.episodeDone = !!state.episode_done;
    if (withMap) {
      frame.map = {
        width: state.width,
        height: state.height,
        rail_grid: state.rail_grid,
        rail_tiles: state.rail_tiles,
        decision_cells: state.decision_cells,
      };
    }
    this._mapKey = mapKey;
    this._maxSteps = state.max_episode_steps;
    this._episodeDone = !!state.episode_done;
    this.log.appendStream('states', frame);
  }

  private _reset(sid: string): void {
    this._sid = sid;
    this._seq = 0;
    this._mapKey = null;
    this._maxSteps = null;
    this._episodeDone = false;
    this._agents.clear();
  }
}
