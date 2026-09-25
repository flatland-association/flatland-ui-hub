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

  it('old per-language links still find their tour', () => {
    for (const [old, { id }] of Object.entries(TOUR_ALIASES)) {
      expect(tourById(old)?.id).withContext(old).toBe(id);
    }
  });
});
