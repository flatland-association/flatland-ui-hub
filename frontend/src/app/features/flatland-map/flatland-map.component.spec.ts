import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SessionStore } from '../../core/session.store';
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
});
