import {
  PLAY_SPEED_DEFAULT_LEVEL,
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

  it('the walk-through with survey is the interview walk without its pages, ending in a short questionnaire', () => {
    const tour = tourById('colearning-walkthrough-survey')!;
    const interview = tourById('colearning-interview')!;
    expect(tour.surveyAfterEachMode).toBeTrue();
    expect(tour.surveyParts).toEqual(['mode', 'nasa-tlx', 'ueq-s']);
    expect(tour.infrastructureId).toBe(interview.infrastructureId);
    expect(tour.disturbanceIds).toEqual(interview.disturbanceIds);
    for (const lang of ['de', 'en'] as const) {
      const b = briefingById(tourBriefingId(tour, lang))!;
      const original = briefingById(tourBriefingId(interview, lang))!;
      expect(b.opening).withContext(lang).toBeUndefined();
      expect(b.closing).withContext(lang).toBeUndefined();
      expect(b.guide).withContext(lang).toEqual(original.guide);
      expect(b.debriefSections).withContext(lang).toBeUndefined();
      expect(b.language).toBe(original.language);
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

  it('run at a tempo that leaves time to decide', () => {
    // Measured: one set of A/B/C plans costs 25–45 s. At the old default of 3
    // steps/s the corridor's 180–212 steps were over in 60–70 s — pressing play
    // finished the episode before the choice existed. The default is now 0.5
    // steps/s (about seven minutes for the corridor), so the Director tours no
    // longer pin a slower tempo of their own.
    for (const tour of director) {
      const tempo = playSpeedForLevel(tour.playSpeedLevel ?? PLAY_SPEED_DEFAULT_LEVEL);
      expect(tempo).withContext(`${tour.id} runs too fast to decide in`).toBeLessThanOrEqual(0.5);
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

  it('leaves every tour on the default tempo', () => {
    for (const tour of TOURS) {
      expect(tour.playSpeedLevel)
        .withContext(`${tour.id} should not pin a tempo`)
        .toBeUndefined();
    }
  });

  it('opens the single-conflict tour past the step where the objectives still agree', () => {
    // Measured on `pf-ch-wn-wal-long-approach` with `e1-late-into-the-section`,
    // driven under goal_directed from step 1: the three options differ pairwise
    // from step 8 on, and from step 20 on none of them is empty. Opening earlier
    // shows three tiles that all say the objective changes nothing — which is
    // true there, and is what made the screen look broken.
    const tour = tourById('director-only')!;
    expect(tour.infrastructureId).toBe('pf-ch-wn-wal-long-approach');
    expect(tour.disturbanceIds).toEqual(['e1-late-into-the-section']);
    expect(tour.openAtStep).toBeGreaterThanOrEqual(20);
  });

  it('pins an opening step only where the scenario was measured for one', () => {
    // Not a style rule: the step is a property of one scenario's traffic, so
    // carrying a number to another tour would be an unmeasured claim.
    for (const tour of TOURS.filter((t) => t.id !== 'director-only')) {
      expect(tour.openAtStep)
        .withContext(`${tour.id} pins an opening step without a measurement`)
        .toBeUndefined();
    }
  });
});
