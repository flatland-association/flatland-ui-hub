// Every Introduction-door tour (scripted), one live variant with a fixed seed, and
// every Experiments-door tour. Generated from TOURS, so a new tour is tested automatically.
//
// Introduction tours use the deep link `#/tour/<id>[/live/<seed>]/start` for speed;
// the click path is covered in languages.spec.ts. Experiments-door tours are clicked.
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

// The MARL lab loop (docs/plans/marl-lab-tour.md), in its Co-Learning build:
// the AI alone, one intervention at the Weesen switch, training from the
// browser, and the last run under the model just trained. The Director build
// is the same flow in another mode; its start is covered by the tour matrix.
test.describe('MARL lab tour', () => {
  test('marl-lab-colearning · watch, step in, train, drive with your model', async ({ welcome, intro, work, lab, guard }) => {
    const name = 'marl-lab-colearning · loop';
    const created = welcome.waitForAutoStart(name);
    await welcome.goto('#/tour/marl-lab-colearning/start');
    expect((await created).ok(), `${name}: POST /session`).toBe(true);
    await intro.passOpening();
    expect(await work.sessionPolicy(name), `${name}: run 1 drives the learned policy`).toBe('learned_ppo');

    // Run 1 · the AI alone.
    await intro.startScenario();
    await work.expectStarted(name);
    await lab.pause();
    await lab.endShift();
    await lab.expectStepDone(name, 'watch-ai');
    await lab.next();

    // Run 2 · with you: train 1 takes the right-hand track at the Weesen switch.
    await intro.startScenario();
    await work.expectStarted(name);
    expect(await work.sessionPolicy(name), `${name}: run 2 drives the learned policy`).toBe('learned_ppo');
    await lab.pause();
    await lab.stepIn(name, 1, 3);
    await lab.expectStepDone(name, 'intervene');
    await lab.runToEnd(name);
    await expect(lab.train, `${name}: run 2 ends in the training section`).toBeVisible();
    await lab.trainAndExpectCheck(name);
    await lab.expectStepDone(name, 'train');
    await lab.next();

    // Run 3 · your model.
    await intro.startScenario();
    await work.expectStarted(name);
    expect(await work.sessionPolicy(name), `${name}: run 3 drives the model just trained`).toMatch(/^lab:tour-/);
    guard.expectClean(name);
  });
});
