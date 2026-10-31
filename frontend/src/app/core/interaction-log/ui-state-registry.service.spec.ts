import { DestroyRef, signal } from '@angular/core';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { InteractionLogService } from './interaction-log.service';
import { UI_STATE_QUIET_MS, UiStateRegistry } from './ui-state-registry.service';

describe('UiStateRegistry', () => {
  let header: ReturnType<typeof signal<{ sessionId: string } | null>>;
  let noted: [string, unknown][];
  let registry: UiStateRegistry;

  beforeEach(() => {
    header = signal<{ sessionId: string } | null>(null);
    noted = [];
    TestBed.configureTestingModule({
      providers: [{ provide: InteractionLogService, useValue: { header, noteUiState: (k: string, v: unknown) => noted.push([k, v]) } }],
    });
    registry = TestBed.inject(UiStateRegistry);
  });

  it('logs one event per settled change, not every intermediate value', fakeAsync(() => {
    const collapsed = signal(false);
    registry.register('panel.decision-log.collapsed', collapsed);
    TestBed.tick();
    collapsed.set(true);
    TestBed.tick();
    collapsed.set(false);
    TestBed.tick();
    collapsed.set(true);
    TestBed.tick();
    tick(UI_STATE_QUIET_MS);
    expect(noted).toEqual([['panel.decision-log.collapsed', true]]);
  }));

  it('logs a viewport as one object and snapshots every key when a session starts', fakeAsync(() => {
    const zoom = signal(1);
    const panX = signal(0);
    registry.register('map.viewport', { zoom, panX });
    registry.register('panel.scenario.collapsed', signal(true));
    TestBed.tick();
    header.set({ sessionId: 's1' });
    TestBed.tick();
    expect(noted).toEqual([
      ['map.viewport', { zoom: 1, panX: 0 }],
      ['panel.scenario.collapsed', true],
    ]);
    zoom.set(2.5);
    TestBed.tick();
    tick(UI_STATE_QUIET_MS);
    expect(noted.at(-1)).toEqual(['map.viewport', { zoom: 2.5, panX: 0 }]);
  }));

  it('applies a replayed value now, or when the component registers, without logging it', fakeAsync(() => {
    const zoom = signal(1);
    const panX = signal(0);
    registry.apply('map.viewport', { zoom: 3, panX: 40 });
    registry.register('map.viewport', { zoom, panX });
    expect([zoom(), panX()]).toEqual([3, 40]);

    const expanded = signal(true);
    registry.register('panel.p1.expanded', expanded);
    TestBed.tick();
    registry.apply('panel.p1.expanded', false);
    TestBed.tick();
    tick(UI_STATE_QUIET_MS);
    expect(expanded()).toBeFalse();
    expect(noted).toEqual([]);
  }));

  it('forgets a key when its component is destroyed', () => {
    let destroy = () => {};
    const ref = { onDestroy: (fn: () => void) => ((destroy = fn), () => {}) } as unknown as DestroyRef;
    registry.register('panel.kpi-filter.collapsed', signal(false), ref);
    expect(registry.keys()).toEqual(['panel.kpi-filter.collapsed']);
    destroy();
    expect(registry.keys()).toEqual([]);
  });
});
