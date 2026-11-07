import { fakeAsync, tick } from '@angular/core/testing';
import { WebSocketService } from './websocket.service';

class ControlledSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: ControlledSocket[] = [];
  readyState = ControlledSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly send = jasmine.createSpy('send');
  readonly close = jasmine.createSpy('close').and.callFake(() => { this.readyState = ControlledSocket.CLOSED; });

  constructor(readonly url: string) { ControlledSocket.instances.push(this); }
  open(): void { this.readyState = ControlledSocket.OPEN; this.onopen?.(new Event('open')); }
  state(sessionId: string, step: number): void {
    this.onmessage?.(new MessageEvent('message', {
      data: JSON.stringify({ type: 'state', session_id: sessionId, state: { elapsed_steps: step } }),
    }));
  }
  error(): void { this.onerror?.(new Event('error')); }
  closed(): void { this.readyState = ControlledSocket.CLOSED; this.onclose?.(new CloseEvent('close')); }
}

describe('WebSocketService connection ownership', () => {
  let service: WebSocketService;
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    originalWebSocket = window.WebSocket;
    ControlledSocket.instances = [];
    window.WebSocket = ControlledSocket as unknown as typeof WebSocket;
    service = new WebSocketService();
  });

  afterEach(() => {
    service.disconnect();
    window.WebSocket = originalWebSocket;
  });

  it('keeps the replacement confirmed when callbacks arrive from its old socket', fakeAsync(() => {
    service.connect('old-session');
    const old = ControlledSocket.instances[0];
    old.open(); old.state('old-session', 1);

    service.connect('current-session');
    const current = ControlledSocket.instances[1];
    current.open(); current.state('current-session', 7);
    const receipt = service.stateReceipt();
    const message = service.lastMessage();

    old.state('old-session', 999);
    old.error(); old.open(); old.closed();
    tick(1600);

    expect(service.connected()).toBeTrue();
    expect(service.stateConfirmed()).toBeTrue();
    expect(service.stateReceipt()).toBe(receipt);
    expect(service.lastMessage()).toBe(message);
    expect(service.lastError()).toBeNull();
    expect(ControlledSocket.instances.length).toBe(2);
    service.send('ping');
    expect(current.send).toHaveBeenCalledWith('ping');
    expect(old.send).not.toHaveBeenCalled();
  }));

  it('does not revive or reconnect a socket after explicit disconnection', fakeAsync(() => {
    service.connect('session');
    const old = ControlledSocket.instances[0];
    old.open(); old.state('session', 1);
    service.disconnect();

    old.open(); old.state('session', 99); old.error(); old.closed();
    tick(1600);

    expect(service.connected()).toBeFalse();
    expect(service.stateConfirmed()).toBeFalse();
    expect(service.stateReceipt()).toBeNull();
    expect(service.lastMessage()).toBeNull();
    expect(service.lastError()).toBeNull();
    expect(ControlledSocket.instances.length).toBe(1);
  }));

  it('reuses a connecting socket and ignores a message for another session', () => {
    service.connect('session');
    service.connect('session');
    expect(ControlledSocket.instances.length).toBe(1);
    const current = ControlledSocket.instances[0];
    current.open(); current.state('other-session', 99);
    expect(service.connected()).toBeTrue();
    expect(service.stateConfirmed()).toBeFalse();
    expect(service.stateReceipt()).toBeNull();
    expect(service.lastMessage()).toBeNull();
    current.state('session', 3);
    expect(service.stateConfirmed()).toBeTrue();
    expect(service.stateReceipt()?.sessionId).toBe('session');
  });
});
