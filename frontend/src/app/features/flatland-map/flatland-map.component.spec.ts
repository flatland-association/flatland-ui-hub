import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessionStore } from '../../core/session.store';
import type { ContentionGroup } from '../../core/events/event-types';
import { CurrentDelayService } from '../../core/timetable/current-delay.service';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { FlatlandMapComponent } from './flatland-map.component';

/** The "×" on a train's option strip (docs/plans/plan-b-small-changes.md,
 *  item 6, finding F-7). */
describe('FlatlandMapComponent — closing a train\'s option strip', () => {
  let c: FlatlandMapComponent;
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FlatlandMapComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    c = TestBed.createComponent(FlatlandMapComponent).componentInstance;
  });

  it('keeps the train selected when its strip is closed', () => {
    c.toggleSelect(3);
    expect(store.selectedHandle()).toBe(3);
    c.closeTrainOptions(3);
    TestBed.tick();
    expect(c.trainOptionsClosedFor()).toBe(3);
    expect(store.selectedHandle()).toBe(3);
  });

  it('brings the strip back on the next click on that train, still selected', () => {
    c.toggleSelect(3);
    c.closeTrainOptions(3);
    TestBed.tick();
    c.toggleSelect(3);
    TestBed.tick();
    expect(c.trainOptionsClosedFor()).toBeNull();
    expect(store.selectedHandle()).toBe(3);
  });

  it('still deselects a train on a second click while its strip is open', () => {
    c.toggleSelect(3);
    c.toggleSelect(3);
    expect(store.selectedHandle()).toBeNull();
  });

  it('opens the strip of another train on a click on it', () => {
    c.toggleSelect(3);
    c.closeTrainOptions(3);
    TestBed.tick();
    c.toggleSelect(5);
    TestBed.tick();
    expect(c.trainOptionsClosedFor()).toBeNull();
    expect(store.selectedHandle()).toBe(5);
  });

  it('marks only mapped cells of the selected conflict, even with the layer hidden', () => {
    store.state.set({ rail_tiles: [{ r: 1, c: 2 }, { r: 1, c: 3 }] } as never);
    const conflict: ContentionGroup = {
      kind: 'blocked', step: 10, handles: [1, 2], position: [1, 2],
      window: [[1, 2], [1, 3], [9, 9]],
    };
    store.selectedContention.set(conflict);
    expect(c.selectedContentionCells().length).toBe(2);
    store.selectedContention.set({ ...conflict, window: [] });
    expect(c.selectedContentionCells().length).toBe(1);
    store.selectedContention.set({ ...conflict, window: [], position: null });
    expect(c.selectedContentionCells()).toEqual([]);
  });
});

/** A late train's plate on the map: "+5" on the plate, the unit in its
 *  tooltip and screen-reader name, as the map has no time axis (F-6). */
describe('FlatlandMapComponent — delay on a train plate', () => {
  it('says the unit where the plate itself is too small for it', () => {
    TestBed.configureTestingModule({
      imports: [FlatlandMapComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    spyOn(TestBed.inject(CurrentDelayService), 'label').and.callFake((h: number) => (h === 3 ? '+5' : ''));
    const c = TestBed.createComponent(FlatlandMapComponent).componentInstance;
    const stub = c as unknown as Record<string, unknown>;
    stub['trainLabelsOn'] = () => true;
    stub['viewBox'] = () => '0 0 100 100';
    stub['agents'] = () => [{ handle: 3, position: [1, 1] }, { handle: 4, position: [2, 2] }];
    stub['agentX'] = () => 50;
    stub['agentY'] = () => 50;
    const [late, onTime] = c.trainLabels();
    expect(late.delay).toBe('+5');
    expect(late.delayText).toBe('+5 steps');
    expect(onTime.delayText).toBe('');
  });
});

