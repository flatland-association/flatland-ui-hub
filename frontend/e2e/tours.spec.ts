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
      if (c.tour.policy && c.tour.maxEpisodeSteps !== undefined && !c.tour.surveyAfterEachMode) {
        const initial = await response.json();
        expect(initial.operator_type, `${c.name}: ordinary session supervises the learned driver`).toBe('human');
        expect(initial.dispatcher, `${c.name}: no synthetic operator at creation`).toBeNull();
        await work.expectPlaybackPolicy(c.name, c.tour.policy);
        await work.pausePlayback(c.name);
        await work.expectPinnedDriver(c.name, c.tour.policy);
        const restarted = await work.restartRun(c.name);
        const sent = restarted.request().postDataJSON();
        const replacement = await restarted.json();
        expect(replacement.id, `${c.name}: Restart creates a fresh run`).not.toBe(initial.id);
        expect(replacement.operator_type, `${c.name}: Restart keeps human supervision`).toBe('human');
        expect(replacement.dispatcher, `${c.name}: Restart keeps synthetic dispatch off`).toBeNull();
        expect(sent.scenario_preset_id, `${c.name}: Restart keeps the infrastructure`).toBe(c.tour.infrastructureId);
        expect(sent.disturbance_ids, `${c.name}: Restart keeps the authored disturbances`).toEqual(c.tour.disturbanceIds);
        expect(sent.max_episode_steps, `${c.name}: Restart keeps the fixed budget`).toBe(c.tour.maxEpisodeSteps);
        await work.expectStarted(c.name);
        await work.expectMode(c.name, c.tour.modes[0]);
        await work.expectPinnedDriver(c.name, c.tour.policy);
        await work.expectEpisodeHorizon(c.name, c.tour.maxEpisodeSteps);
        await work.playAndExpectSteps(c.name, c.tour.modes[0], c.tour.policy);
        await work.expectPlaybackPolicy(c.name, c.tour.policy);
        await work.pausePlayback(c.name);
        guard.expectClean(c.name);
      }
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
});
