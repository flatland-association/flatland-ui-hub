import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import type { AgentDTO, SessionState } from '../models';
import { WebSocketService, WSMessage } from '../websocket.service';
import { InteractionLogService } from './interaction-log.service';
import { StateFrame, StateLogService } from './state-log.service';

function agent(handle: number, row: number): AgentDTO {
  return { handle, position: [row, 1], direction: 1, state: 'MOVING' } as unknown as AgentDTO;
}

function state(step: number, agents: AgentDTO[]): SessionState {
  return {
    width: 10, height: 8, num_agents: agents.length, elapsed_steps: step, max_episode_steps: 100,
    agents, rail_grid: [[0]], rail_tiles: [], episode_done: false,
  };
}

describe('StateLogService', () => {
  let messages: Subject<WSMessage>;
  let appendStream: jasmine.Spy;
  let active: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    messages = new Subject<WSMessage>();
    appendStream = jasmine.createSpy('appendStream');
    active = signal(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: WebSocketService, useValue: { messages } },
        { provide: InteractionLogService, useValue: { header: signal({ sessionId: 's1' }), studyLoggingActive: active, appendStream } },
      ],
    });
    TestBed.inject(StateLogService);
  });

  const frames = () => appendStream.calls.allArgs().map(([, f]) => f as StateFrame);

  it('the first frame carries the map and every train, later ones only the changed trains', () => {
    messages.next({ type: 'state', state: state(0, [agent(0, 1), agent(1, 2)]) });
    messages.next({ type: 'state', state: state(1, [agent(0, 2), agent(1, 2)]) });
    const [first, second] = frames();
    expect(first.map?.width).toBe(10);
    expect(first.agents.length).toBe(2);
    expect(first.maxSteps).toBe(100);
    expect(second.map).toBeUndefined();
    expect(second.agents.map((a) => a.handle)).toEqual([0]);
    expect(second.maxSteps).toBeUndefined();
    expect(second.simStep).toBe(1);
  });

  it('records two messages that arrive back to back (no coalescing)', () => {
    messages.next({ type: 'state', state: state(0, [agent(0, 1)]) });
    messages.next({ type: 'state', state: state(1, [agent(0, 2)]) });
    messages.next({ type: 'state', state: state(2, [agent(0, 3)]) });
    expect(frames().map((f) => f.simStep)).toEqual([0, 1, 2]);
  });

  it('writes nothing while study logging is off, and starts with the map again when it is switched on', () => {
    active.set(false);
    messages.next({ type: 'state', state: state(0, [agent(0, 1)]) });
    expect(appendStream).not.toHaveBeenCalled();
    active.set(true);
    messages.next({ type: 'state', state: state(1, [agent(0, 1)]) });
    expect(frames()[0].map).toBeDefined();
  });
});
