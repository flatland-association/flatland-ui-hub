// Screens reachable by hash (plan §2.2): each loads with no console errors and
// no failed backend requests.
import { expect, test } from './support/fixtures';

const SCREENS = ['widgets', 'algorithms', 'scenarios', 'contribute', 'infrastructure-builder', 'designer'];

/** Screens that fail today because of an app bug, not because of the test. */
const KNOWN_BUGS: Record<string, string> = {
  // KNOWN BUG: the Widget Gallery seeds SessionStore with the fixture session
  // `gallery-fixture-session` (core/gallery-fixture.service.ts); the store's
  // geography effect then requests GET /session/gallery-fixture-session/hmi/geography
  // from the real backend, which answers 404 and logs a console error.
  widgets: 'Widget Gallery fetches geography for its fixture session (404)',
};

test.describe('Hash screens', () => {
  for (const screen of SCREENS) {
    test(`#/${screen} loads cleanly`, async ({ page, guard }) => {
      test.fail(screen in KNOWN_BUGS, KNOWN_BUGS[screen]);
      await page.goto(`/#/${screen}`);
      await expect(page.getByTestId(`screen-${screen}`), `#/${screen}: screen rendered`).toBeVisible();
      await page.waitForLoadState('networkidle');
      guard.expectClean(`#/${screen}`);
    });
  }
});
