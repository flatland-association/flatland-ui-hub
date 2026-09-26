import {
  PLAY_SPEED_DEFAULT_LEVEL,
  PLAY_SPEED_STEPS_PER_SECOND,
  playSpeedForLevel,
} from '../play-speed';
import { TOURS, TOUR_ALIASES, tourBriefingId, tourById } from './tours';
import { briefingById } from './tour-briefings';

describe('tours', () => {
  it('has one picker entry per tour, not one per language', () => {
    const ids = TOURS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => /-(en|de|fr)$/.test(id))).toBeFalse();
  });

  it('picks the briefing by language, English when the language has none', () => {
    const olten = tourById('olten-zug-weg')!;
    expect(tourBriefingId(olten, 'de')).toBe('olten-zug-weg-de');
    expect(tourBriefingId(olten, 'en')).toBe('olten-zug-weg-en');
    expect(tourBriefingId(olten, 'fr')).toBe('olten-zug-weg-en');
  });

  it('every briefing a tour names exists', () => {
    for (const tour of TOURS) {
      for (const lang of ['en', 'de', 'fr'] as const) {
        const id = tourBriefingId(tour, lang);
        if (id) expect(briefingById(id)).withContext(`${tour.id}/${lang}`).toBeDefined();
      }
    }
  });

  it('a live variant has its own briefing in every language, and a scripted run keeps the story', () => {
    const live = TOURS.filter((t) => t.live);
    expect(live.map((t) => t.id)).toEqual(jasmine.arrayContaining(['walensee-zug-weg', 'olten-zug-weg', 'corridor-director']));
    for (const tour of live) {
      for (const lang of ['en', 'de', 'fr'] as const) {
        const id = tourBriefingId(tour, lang, 'live')!;
        expect(briefingById(id)).withContext(`${tour.id}/${lang}`).toBeDefined();
        expect(id).not.toBe(tourBriefingId(tour, lang, 'scripted')!);
      }
    }
    // A tour without a live variant falls back to its scripted briefing.
    const interview = tourById('colearning-interview')!;
    expect(tourBriefingId(interview, 'de', 'live')).toBe(tourBriefingId(interview, 'de'));
  });

  it('old per-language links still find their tour', () => {
    for (const [old, { id }] of Object.entries(TOUR_ALIASES)) {
      expect(tourById(old)?.id).withContext(old).toBe(id);
    }
  });
});

/**
 * Data assertions, not behaviour: these are the facts a Director tour has to hold
 * for its own point — that the operator chooses the objective — to be reachable.
 */
describe('Director tours', () => {
  // Director-only. `three-modes-original` also visits Director, but it runs all
  // three modes on the generated network in one go: pinning a tempo there would
  // slow its Recommendation and Co-Learning legs too, and its network is not the
  // corridor the Director map surfaces are built for. Left alone deliberately.
  const director = TOURS.filter(
    (tour) => tour.modes.length === 1 && tour.modes[0] === 'director',
  );

  it('exist', () => {
    expect(director.length).toBeGreaterThan(0);
  });

  it('open slower than the default, because deciding takes longer than the run', () => {
    // Measured: one set of A/B/C plans costs 25–45 s, while the corridor's 180–212
    // steps at the default 3 steps/s are 60–70 s end to end. Pressing play finished
    // the episode before the choice existed, and the shift review then reported
    // "you set the goal 0 times".
    for (const tour of director) {
      expect(tour.playSpeedLevel)
        .withContext(`${tour.id} has no slower opening tempo`)
        .toBe(1);
      expect(playSpeedForLevel(tour.playSpeedLevel!)).toBeLessThan(
        PLAY_SPEED_STEPS_PER_SECOND[PLAY_SPEED_DEFAULT_LEVEL - 1],
      );
    }
  });

  it('run on a corridor, which is what the Director map surfaces assume', () => {
    // The option bars are indexed by column, which is a position along the route
    // only on a line; on the generated 36 x 24 network all three options occupied
    // the same columns at every sampled step.
    for (const tour of director) {
      expect(tour.infrastructureId)
        .withContext(`${tour.id} is not on a PF-CH corridor scenario`)
        .toMatch(/^pf-ch-/);
    }
  });

  it('leaves every other tour on the default tempo', () => {
    const ids = new Set(director.map((t) => t.id));
    for (const tour of TOURS.filter((t) => !ids.has(t.id))) {
      expect(tour.playSpeedLevel)
        .withContext(`${tour.id} should not pin a tempo`)
        .toBeUndefined();
    }
  });
});
