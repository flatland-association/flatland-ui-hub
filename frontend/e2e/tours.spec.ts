// Tours (plan §2.2): every Introduction-door tour in its scripted variant, one
// live variant with a fixed seed, and every Experiments-door tour. Generated
// from TOURS (support/matrix.ts), so a new tour gets a test on its own.
//
// Introduction tours use the existing deep link `#/tour/<id>[/live/<seed>]/start`
// for speed; the click path through that door is covered per language in
// languages.spec.ts. Experiments-door tours are driven by clicks.
import { expect, test } from './support/fixtures';
import { EXPERIMENT_TOUR_CASES, INTRO_TOUR_CASES, LIVE_SEED, isSlowMode } from './support/matrix';
import { walkTour } from './support/setup-check';

test.describe('Introduction door', () => {
  for (const c of INTRO_TOUR_CASES) {
    const slow = isSlowMode(c.tour.modes[0]);
    test(c.name, { tag: slow ? ['@slow'] : [] }, async ({ welcome, intro, work, guard }) => {
      if (slow) test.slow();
      const hash = `#/tour/${c.tour.id}${c.variant === 'live' ? `/live/${LIVE_SEED}` : ''}/start`;
      const created = welcome.waitForAutoStart(c.name);
      await welcome.goto(hash);
      const response = await created;
      expect(response.ok(), `${c.name}: POST /session`).toBe(true);
      if (c.variant === 'live') {
        const sent = response.request().postDataJSON() as { seed?: number };
        expect(sent.seed, `${c.name}: live seed sent`).toBe(LIVE_SEED);
      }
      await walkTour(c.name, c.tour, { intro, work, guard });
    });
  }
});

test.describe('Experiments door · tours', () => {
  for (const c of EXPERIMENT_TOUR_CASES) {
    const slow = isSlowMode(c.tour.modes[0]);
    test(c.name, { tag: slow ? ['@slow'] : [] }, async ({ welcome, intro, work, guard }) => {
      if (slow) test.slow();
      await welcome.goto();
      await welcome.openDoor('experiments');
      await welcome.selectExperimentKind('tour');
      await welcome.selectExperimentTour(c.tour.id);
      const created = await welcome.pressStart(c.name);
      expect(created.ok(), `${c.name}: POST /session`).toBe(true);
      await walkTour(c.name, c.tour, { intro, work, guard });
    });
  }
});
