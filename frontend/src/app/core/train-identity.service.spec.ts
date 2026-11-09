import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { SessionStore } from './session.store';
import { SessionInfo, SessionState } from './models';
import { TourContextService } from './demo/tour-context.service';
import { SERVICE_ROSTER, TrainIdentityService } from './train-identity.service';

describe('TrainIdentityService', () => {
  let store: SessionStore;
  let trains: TrainIdentityService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    trains = TestBed.inject(TrainIdentityService);
    store.state.set({ agents: [{ handle: 1 }, { handle: 0 }, { handle: 2 }] } as unknown as SessionState);
  });

  it('names the trains from the roster by handle order', () => {
    expect([0, 1, 2].map((h) => trains.nameFor(h))).toEqual(SERVICE_ROSTER.slice(0, 3));
  });

  function onPreset(train_names: string[] | null): void {
    TestBed.inject(TourContextService).scenarioPresets.set([
      { id: 'drawn', name: 'D', width: 30, height: 30, agents: 3, train_names },
    ]);
    store.session.set({ id: 's', width: 30, height: 30, num_agents: 3, scenario_preset_id: 'drawn' } as SessionInfo);
  }

  it("uses an experiment scenario's own names from its preset", () => {
    onPreset(['Z-W-1-S', 'Z-W-2-IR', 'F-W-S']);
    expect([0, 1, 2].map((h) => trains.nameFor(h))).toEqual(['Z-W-1-S', 'Z-W-2-IR', 'F-W-S']);
    expect(trains.handleFor('F-W-S')).toBe(2);
    expect(trains.withTrainNames('Train 1 is malfunctioning')).toBe('Z-W-2-IR is malfunctioning');
  });

  it('keeps the roster when the preset names no trains', () => {
    onPreset(null);
    expect(trains.nameFor(0)).toBe(SERVICE_ROSTER[0]);
  });
});
