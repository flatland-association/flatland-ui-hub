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

  // docs/plans/plan-b-control-group.md F-5: an earlier leg's trains keep that scenario's names.
  it('names a train as another scenario of the run named it, else as this session does', () => {
    TestBed.inject(TourContextService).scenarioPresets.set([
      { id: 'leg-a', name: 'A', width: 30, height: 30, agents: 3, train_names: ['A-0', 'A-1', 'A-2'] },
      { id: 'leg-b', name: 'B', width: 30, height: 30, agents: 3, train_names: ['B-0', 'B-1', 'B-2'] },
      { id: 'leg-c', name: 'C', width: 30, height: 30, agents: 3, train_names: null },
    ]);
    store.session.set({ id: 's', width: 30, height: 30, num_agents: 3, scenario_preset_id: 'leg-b' } as SessionInfo);
    expect(trains.nameIn('leg-a', 1)).toBe('A-1');
    expect(trains.nameIn('leg-b', 1)).toBe('B-1');
    expect(trains.nameIn('leg-c', 1)).withContext('no own names: this session\'s').toBe('B-1');
    expect(trains.nameIn(null, 2)).toBe('B-2');
    expect(trains.withTrainNames('Train 1 is malfunctioning', (h) => trains.nameIn('leg-a', h))).toBe('A-1 is malfunctioning');
  });
});
