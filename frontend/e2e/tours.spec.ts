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

  test('three-modes-original · agent decision disclosures', async ({ welcome, intro, work, guard }) => {
    const setup = 'tour three-modes-original · agent decision disclosures';
    const created = welcome.waitForAutoStart(setup);
    await welcome.goto('#/tour/three-modes-original/start');
    const response = await created;
    expect(response.ok(), `${setup}: POST /session`).toBe(true);
    await intro.passOpening();
    await intro.startScenario();
    await work.expectStarted(setup);
    await work.expectMode(setup, 'recommendation');
    await work.openPanel('agent-inspector');
    await work.expectAgentDecisionDisclosures(setup);
    guard.expectClean(setup);
  });
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
    const run3 = welcome.waitForAutoStart(name);
    await lab.next();
    const sent = (await run3).request().postDataJSON() as { disturbance_ids?: string[] };
    expect(sent.disturbance_ids, `${name}: run 3 adds the breakdown`).toEqual(['w1-door-fault']);

    // Run 3 · your model.
    await intro.startScenario();
    await work.expectStarted(name);
    expect(await work.sessionPolicy(name), `${name}: run 3 drives the model just trained`).toMatch(/^lab:tour-/);
    guard.expectClean(name);
  });

  // A leg's intro shows while the leg's `POST /session` is still pending; on a
  // busy backend a Start in that window used to play the previous session.
  test('marl-lab-colearning · Start waits for the next leg\'s session', async ({ welcome, intro, work, lab, guard }) => {
    const name = 'marl-lab-colearning · leg race';
    const created = welcome.waitForAutoStart(name);
    await welcome.goto('#/tour/marl-lab-colearning/start');
    const run1 = await created;
    expect(run1.ok(), `${name}: POST /session`).toBe(true);
    await intro.passOpening();
    await intro.startScenario();
    await work.expectStarted(name);
    await lab.pause();
    await lab.endShift();

    const held = await intro.holdNextSessionCreate(name);
    const playedAtLegEnd = work.playedSessions.length;
    await lab.next();
    await expect(intro.modeIntro, `${name}: run 2's intro shows while its session is created`).toBeVisible();
    await intro.expectStartWaits(name);
    held.release();
    const run2 = await held.created;
    expect(run2.ok(), `${name}: run 2 POST /session`).toBe(true);
    const run2Id = ((await run2.json()) as { id: string }).id;

    await intro.expectStartReady(name);
    await intro.startScenario();
    await work.expectStarted(name);
    // Only run 2 is played after run 1's leg ended: not run 1 from the early click.
    await expect
      .poll(() => work.playedSessions.slice(playedAtLegEnd), { message: `${name}: Start plays run 2's session` })
      .toEqual([run2Id]);
    // A late answer to run 1's play must not have marked run 2 as playing already.
    await work.expectPlaying(name);
    guard.expectClean(name);
  });
});
