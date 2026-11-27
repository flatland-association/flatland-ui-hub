// Smoke test: the start screen renders its one Start button without console
// errors. The fastest signal that the app boots at all.
import { test } from './support/fixtures';

test('start screen renders with a Start button and no console errors', async ({ page, welcome, guard }) => {
  await welcome.goto();
  await welcome.expectShown();
  await page.waitForLoadState('networkidle');
  guard.expectClean('start screen');
});
