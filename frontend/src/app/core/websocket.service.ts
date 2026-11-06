import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { SessionState } from './models';
import { backendWsBase } from './backend-origin';

export interface WSMessage {
  type: 'state' | 'episode_done' | 'error' | 'pong';
  session_id?: string;
  state?: SessionState;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private socket: WebSocket | null = null;
  private currentSessionId: string | null = null;
  private reconnectTimer: any = null;
  private shouldReconnect = false;

  readonly connected = signal(false);
  /** Receipt telemetry only; a connected socket alone does not prove progress. */
  readonly stateReceipt = signal<{ sessionId: string; at: number; revision: number } | null>(null);
  readonly stateConfirmed = signal(false);
  private stateRevision = 0;
  readonly lastMessage = signal<WSMessage | null>(null);
  /** Every message, in order. `lastMessage` keeps only the latest between two
   *  effect runs; the study logs need each one (pattern P4). */
  readonly messages = new Subject<WSMessage>();
  readonly lastError = signal<string | null>(null);

  connect(sessionId: string) {
    if (this.currentSessionId === sessionId && this.socket?.readyState === WebSocket.OPEN) {
      return;
    }

    this.disconnect();
    this.currentSessionId = sessionId;
    this.shouldReconnect = true;
    this._open();
  }

  private _open() {
    if (!this.currentSessionId) return;

    // Same-origin (wss inherited) in production, localhost:8000 during local
    // dev — see backend-origin. No hardcoded host/port.
    const sessionId = this.currentSessionId;
    this.stateConfirmed.set(false);
    const url = `${backendWsBase()}/ws/session/${sessionId}`;

    try {
      this.socket = new WebSocket(url);
    } catch (e: any) {
      this.lastError.set(`WS open failed: ${e.message}`);
      this._scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.connected.set(true);
      this.lastError.set(null);
    };

    this.socket.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as WSMessage;
        if (data.type === 'state' && data.state) {
          this.stateReceipt.set({ sessionId, at: Date.now(), revision: ++this.stateRevision });
          this.stateConfirmed.set(true);
        }
        this.lastMessage.set(data);
        this.messages.next(data);
      } catch (e: any) {
        this.lastError.set(`Parse error: ${e.message}`);
      }
    };

    this.socket.onerror = () => {
      this.lastError.set('WebSocket error');
    };

    this.socket.onclose = () => {
      this.stateConfirmed.set(false);
      this.connected.set(false);
      this.socket = null;
      if (this.shouldReconnect) {
        this._scheduleReconnect();
      }
    };
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldReconnect) {
        this._open();
      }
    }, 1500);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.connected.set(false);
    this.stateConfirmed.set(false);
    this.stateReceipt.set(null);
    this.currentSessionId = null;
  }

  send(msg: string) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(msg);
    }
  }
}
