// Experiments door, condition kind (plan §2.2): every STUDY_CONDITIONS entry
// (cases in support/matrix.ts).
//
// The condition and scenario are preselected with the existing deep link
// `#/experiment/<layoutId>/<scenarioId>`; disturbances, the participant id and
// Start are then clicked. A run without ticks uses `…/start` directly.
import { expect, test } from './support/fixtures';
import { CONDITION_CASES } from './support/matrix';
import { expectSetupRuns } from './support/setup-check';

test.describe('Experiments door · conditions', () => {
  for (const c of CONDITION_CASES) {
    test(c.name, async ({ welcome, work, guard }) => {
      const base = `#/experiment/${c.condition.layoutId}/${c.scenarioId}`;
      let created;
      if (c.tick.length === 0) {
        const auto = welcome.waitForAutoStart(c.name);
        await welcome.goto(`${base}/start`);
        created = await auto;
      } else {
        await welcome.goto(base);
        await welcome.expectShown();
        await welcome.fillParticipant('e2e-participant');
        for (const id of c.tick) await welcome.tickDisturbance('experiments', id);
        created = await welcome.pressStart(c.name);
      }
      expect(created.ok(), `${c.name}: POST /session`).toBe(true);
      const sent = created.request().postDataJSON() as { scenario_preset_id?: string; disturbance_ids?: string[] };
      expect(sent.scenario_preset_id, `${c.name}: scenario sent`).toBe(c.scenarioId);
      expect([...(sent.disturbance_ids ?? [])].sort(), `${c.name}: disturbances sent`).toEqual([...c.expected].sort());
      await expectSetupRuns(work, guard, { name: c.name, layout: c.condition.layoutId, mode: c.condition.mode });
      await expect(work.finishExperiment, `${c.name}: the experiment's "finish & questionnaire" is offered`).toBeVisible();
    });
  }
});
