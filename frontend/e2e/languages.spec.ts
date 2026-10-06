// Languages (plan §2.2): the start screen and one full flow per door, each in
// EN, DE and FR. These are also the click-driven runs of every door (plan
// §2.3, point 1): door, choices and Start are all clicked, as a user would.
//
// The language is set through `localStorage['flatland.lang']` before the app
// loads (fixture `lang`). The test proves it took effect by comparing the Start
// button with that language's own translation file, read by key; nothing is
// located by its text.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { INTRO_TOURS, STUDY_CONDITIONS, scenarioPresets } from './support/app-data';
import { expect, test, type Lang } from './support/fixtures';
import type { Door } from './support/pages';
import { SYSTEM_LAYOUT, SYSTEM_LAYOUT_OPTION } from './support/panel-expectations';
import { expectSetupRuns, walkTour } from './support/setup-check';

const LANGS: Lang[] = ['en', 'de', 'fr'];

/** The Start label per door, as `welcomeStartLabel()` picks it. */
const START_KEY: Record<Door, string> = {
  introduction: 'welcome.start.tour',
  build: 'welcome.start.session',
  experiments: 'welcome.start.experiment',
};

function translation(lang: Lang, key: string): string {
  const file = resolve(__dirname, `../public/i18n/${lang}.json`);
  let node: unknown = JSON.parse(readFileSync(file, 'utf8'));
  for (const part of key.split('.')) node = (node as Record<string, unknown>)[part];
  if (typeof node !== 'string') throw new Error(`${key} missing in ${lang}.json`);
  return node;
}

/** A tour short enough for a language run: the first Introduction tour that does not open in Director. */
const TOUR = INTRO_TOURS.find((t) => t.modes[0] !== 'director') ?? INTRO_TOURS[0];
const CONDITION = STUDY_CONDITIONS[0];
const CONDITION_SCENARIO = CONDITION.scenarioId ?? scenarioPresets().find((p) => p.has_plan)?.id ?? '';

for (const lang of LANGS) {
  test.describe(`Language ${lang}`, () => {
    test.use({ lang });

    test(`start screen · ${lang}`, async ({ page, welcome, guard }) => {
      await welcome.goto();
      await welcome.expectShown();
      await expect(welcome.start, `start screen · ${lang}: Start label`).toHaveText(
        translation(lang, START_KEY.introduction),
      );
      await page.getByTestId('shell-menu-trigger').click();
      await expect(page.getByTestId(`lang-option-${lang}`), `start screen · ${lang}: language menu`).toHaveAttribute(
        'aria-current',
        'true',
      );
      await page.waitForLoadState('networkidle');
      guard.expectClean(`start screen · ${lang}`);
    });

    test(`introduction door · tour ${TOUR.id} · clicked · ${lang}`, async ({ welcome, intro, work, guard }) => {
      const name = `introduction door · ${TOUR.id} · ${lang}`;
      await welcome.goto();
      await welcome.openDoor('introduction');
      await welcome.selectTour(TOUR.id);
      await expect(welcome.start, `${name}: Start label`).toHaveText(translation(lang, START_KEY.introduction));
      const created = await welcome.pressStart(name);
      expect(created.ok(), `${name}: POST /session`).toBe(true);
      await walkTour(name, TOUR, { intro, work, guard });
    });

    test(`build door · guided demo · clicked · ${lang}`, async ({ welcome, work, guard }) => {
      const name = `build door · guided-demo · recommendation · ${lang}`;
      await welcome.goto();
      await welcome.openDoor('build');
      await welcome.selectLayout(SYSTEM_LAYOUT_OPTION);
      await welcome.selectNetwork('guided-demo');
      await expect(welcome.start, `${name}: Start label`).toHaveText(translation(lang, START_KEY.build));
      const created = await welcome.pressStart(name);
      expect(created.ok(), `${name}: POST /session`).toBe(true);
      await expectSetupRuns(work, guard, { name, layout: SYSTEM_LAYOUT, mode: 'recommendation' });
    });

    test(`experiments door · ${CONDITION.layoutId} · clicked · ${lang}`, async ({ welcome, work, guard }) => {
      const name = `experiments door · ${CONDITION.layoutId} · ${CONDITION_SCENARIO} · ${lang}`;
      await welcome.goto();
      await welcome.openDoor('experiments');
      await welcome.selectExperimentKind('condition');
      await welcome.selectCondition(CONDITION.layoutId);
      if (!CONDITION.scenarioId) await welcome.selectExperimentScenario(CONDITION_SCENARIO);
      await welcome.fillParticipant('e2e-participant');
      await expect(welcome.start, `${name}: Start label`).toHaveText(translation(lang, START_KEY.experiments));
      const created = await welcome.pressStart(name);
      expect(created.ok(), `${name}: POST /session`).toBe(true);
      await expectSetupRuns(work, guard, { name, layout: CONDITION.layoutId, mode: CONDITION.mode });
    });
  });
}
