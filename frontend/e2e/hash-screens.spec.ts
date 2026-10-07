// Screens reachable by hash (plan §2.2): each loads with no console errors and
// no failed backend requests.
import { expect, test } from './support/fixtures';

const SCREENS = ['widgets', 'algorithms', 'scenarios', 'contribute', 'infrastructure-builder', 'designer'];

test.describe('Hash screens', () => {
  for (const screen of SCREENS) {
    test(`#/${screen} loads cleanly`, async ({ page, guard }) => {
      await page.goto(`/#/${screen}`);
      await expect(page.getByTestId(`screen-${screen}`), `#/${screen}: screen rendered`).toBeVisible();
      await page.waitForLoadState('networkidle');
      guard.expectClean(`#/${screen}`);
    });
  }
});
