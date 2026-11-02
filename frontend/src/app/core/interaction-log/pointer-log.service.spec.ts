import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { InteractionLogService } from './interaction-log.service';
import { POINTER_SAMPLE_MS, PointerLogService, PointerSample } from './pointer-log.service';
import { ViewTracker } from './view-tracker.service';

describe('PointerLogService', () => {
  let appendStream: jasmine.Spy;
  let active: ReturnType<typeof signal<boolean>>;
  let host: HTMLElement;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(1_000_000));
    appendStream = jasmine.createSpy('appendStream');
    active = signal(true);
    TestBed.configureTestingModule({
      providers: [
        { provide: InteractionLogService, useValue: { header: signal({ sessionId: 's1' }), studyLoggingActive: active, appendStream, noteUiState: () => {} } },
        { provide: ViewTracker, useValue: { currentView: signal({ view: 'session' }) } },
      ],
    });
    TestBed.inject(PointerLogService);
    host = document.createElement('div');
    host.innerHTML = '<section data-panel-type="decision-log" style="position:fixed;left:100px;top:100px;width:200px;height:100px"><span>x</span></section>';
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    jasmine.clock().uninstall();
  });

  const move = (x: number, y: number, target: Element = document.body, pointerType = 'mouse') =>
    target.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType, bubbles: true, composed: true }));
  const samples = () => appendStream.calls.allArgs().map((a) => a[1] as PointerSample);

  it('samples at most every 200 ms, skips tiny moves and writes where a movement stops', () => {
    move(10, 10);
    move(12, 11); // under 4 px: ignored
    jasmine.clock().tick(50);
    move(40, 10);
    jasmine.clock().tick(50);
    move(60, 10); // within the interval: becomes the trailing sample
    expect(samples().length).toBe(1);
    jasmine.clock().tick(POINTER_SAMPLE_MS);
    expect(samples().length).toBe(2);
    expect(samples()[1].t - samples()[0].t).toBe(POINTER_SAMPLE_MS);
    expect(samples()[1].x).toBeCloseTo(60 / window.innerWidth, 2);
    expect(appendStream.calls.mostRecent().args[0]).toBe('pointer');
  });

  it('adds the panel and the position within it, and marks leaving the window', () => {
    move(150, 125, host.querySelector('span')!);
    expect(samples()[0]).toEqual(jasmine.objectContaining({ panel: 'decision-log', px: 0.25, py: 0.25 }));
    document.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null }));
    expect(samples()[1]).toEqual({ t: 1_000_000, out: true });
    // Leaving twice logs once; the next move starts afresh.
    document.dispatchEvent(new MouseEvent('mouseout', { relatedTarget: null }));
    move(300, 300);
    expect(samples().length).toBe(3);
  });

  it('logs nothing for touch or without "Study logging"', () => {
    move(10, 10, document.body, 'touch');
    active.set(false);
    move(100, 100);
    expect(appendStream).not.toHaveBeenCalled();
  });
});
