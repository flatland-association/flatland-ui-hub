import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslocoTesting } from '../testing/transloco-testing';
import { PLAY_SPEED_DEFAULT_LEVEL, playSpeedBaseFor, playSpeedForLevel } from './play-speed';
import { SessionStore } from './session.store';

const LEVELS = [1, 2, 3, 4, 5];

describe('play speed', () => {
  it('keeps the five default speeds without a scenario pace', () => {
    expect(LEVELS.map((l) => playSpeedForLevel(l))).toEqual([0.25, 0.5, 1, 3, 10]);
    expect(playSpeedBaseFor(undefined)).toBe(0.5);
    expect(playSpeedBaseFor(null)).toBe(0.5);
  });

  it("makes «normal» the scenario's seconds per step, the other levels in proportion", () => {
    const base = playSpeedBaseFor(3);
    expect(1 / playSpeedForLevel(PLAY_SPEED_DEFAULT_LEVEL, base)).toBeCloseTo(3);
    LEVELS.forEach((l, i) => expect(1 / playSpeedForLevel(l, base)).toBeCloseTo([6, 3, 1.5, 0.5, 0.15][i]));
  });

  it('takes slow and fractional paces as they are', () => {
    expect(1 / playSpeedForLevel(2, playSpeedBaseFor(60))).toBeCloseTo(60);
    expect(1 / playSpeedForLevel(2, playSpeedBaseFor(0.1))).toBeCloseTo(0.1);
  });

  it("a session on a scenario with seconds per step plays «normal» at that pace, the next one without at the default", () => {
    TestBed.configureTestingModule({
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    const store = TestBed.inject(SessionStore);
    store.newSession({ scenarioPresetId: 'uc2-1', secondsPerStep: 3 });
    expect(store.playSpeedLevel()).toBe(PLAY_SPEED_DEFAULT_LEVEL);
    expect(1 / store.playSpeed()).toBeCloseTo(3);
    store.newSession({ width: 30, height: 30 });
    expect(store.playSpeed()).toBe(0.5);
  });
});
