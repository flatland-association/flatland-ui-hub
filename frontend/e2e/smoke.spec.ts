// Smoke test (plan stage 1): the start screen renders without console errors.
//
// The Start button is an <sbb-button>. Lyne sets its button role through
// ElementInternals, which Playwright's getByRole does not see, so the test finds
// it by the existing `welcome-start` class instead. Stage 2 replaces this with a
// data-testid.
import { expect, test } from '@playwright/test';

test('start screen renders with a Start button and no console errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(`${msg.text()} (${msg.location().url})`);
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto('/');

  await expect(page.locator('sbb-button.welcome-start')).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(consoleErrors).toEqual([]);
});
