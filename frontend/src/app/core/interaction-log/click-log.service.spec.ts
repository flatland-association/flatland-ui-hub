import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SessionStore } from '../session.store';
import { ClickEvent, ClickLogService, resolveTarget } from './click-log.service';
import { InteractionLogService } from './interaction-log.service';
import { ViewTracker } from './view-tracker.service';

describe('ClickLogService', () => {
  let appendStream: jasmine.Spy;
  let view: ReturnType<typeof signal<{ view: string } | null>>;
  let active: ReturnType<typeof signal<boolean>>;
  let clicks: ClickLogService;
  let host: HTMLElement;

  beforeEach(() => {
    appendStream = jasmine.createSpy('appendStream');
    view = signal<{ view: string } | null>({ view: 'session' });
    active = signal(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: InteractionLogService, useValue: { header: signal({ sessionId: 's1' }), studyLoggingActive: active, appendStream } },
        { provide: SessionStore, useValue: { elapsedSteps: signal(7), interactionMode: signal('recommendation') } },
        { provide: ViewTracker, useValue: { currentView: view } },
      ],
    });
    clicks = TestBed.inject(ClickLogService);
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => host.remove());

  /** Click `el` and let the deferred append run. */
  async function click(el: Element): Promise<ClickEvent | undefined> {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    await new Promise((r) => setTimeout(r));
    return appendStream.calls.mostRecent()?.args[1] as ClickEvent | undefined;
  }

  it('logs the data-log id, the panel and the view', async () => {
    host.innerHTML = '<section data-panel-type="decision-log"><button data-log="decision.hold"><span>Halten</span></button></section>';
    const event = await click(host.querySelector('span')!);
    expect(event).toEqual(jasmine.objectContaining({
      seq: 1, simStep: 7, mode: 'recommendation', target: 'decision.hold', panel: 'decision-log', view: 'session',
    }));
    expect(appendStream.calls.mostRecent().args[0]).toBe('clicks');
  });

  it('a handler attaches the domain object and position of the click', async () => {
    host.innerHTML = '<svg><rect id="train-3"></rect></svg>';
    host.querySelector('rect')!.addEventListener('click', () => {
      clicks.object({ kind: 'agent', handle: 3 });
      clicks.at({ row: 4, col: 9 });
    });
    const event = await click(host.querySelector('rect')!);
    expect(event?.object).toEqual({ kind: 'agent', handle: 3 });
    expect(event?.at).toEqual({ row: 4, col: 9 });
  });

  it('marks a click into a text field, without its value', async () => {
    host.innerHTML = '<input type="text" value="secret">';
    const event = await click(host.querySelector('input')!);
    expect(event?.field).toBeTrue();
    expect(JSON.stringify(event)).not.toContain('secret');
  });

  it('logs nothing on the start screen or while study logging is off', async () => {
    host.innerHTML = '<button>x</button>';
    view.set({ view: 'start' });
    await click(host.querySelector('button')!);
    view.set({ view: 'session' });
    active.set(false);
    await click(host.querySelector('button')!);
    expect(appendStream).not.toHaveBeenCalled();
  });

  it('falls back to the id, then to a control tag with its position', () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<sbb-button></sbb-button><sbb-button><span></span></sbb-button>';
    const inner = wrap.querySelector('sbb-button:nth-child(2) span')!;
    expect(resolveTarget([inner, inner.parentElement!, wrap])).toBe('sbb-button[1]');
    wrap.id = 'toolbar';
    expect(resolveTarget([inner, inner.parentElement!, wrap])).toBe('#toolbar');
  });
});
