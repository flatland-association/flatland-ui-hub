// End-to-end tests (plan: docs/plans/e2e-playwright.md).
// `npm run e2e` builds the frontend once (e2e/support/global-setup.ts), then
// every worker starts its own backend on :8100 + its index, which serves that
// build (e2e/support/backend.ts). Nothing needs to run beforehand.
// E2E_BASE_URL=<url> instead runs against an app that is already up.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/support/global-setup.ts',
  forbidOnly: !!process.env['CI'],
  // Every test creates its own session and every worker has its own backend,
  // so tests run in parallel across files and within them. The default fits a
  // 16 GB / 8-core machine (measured, see the Decisions log in
  // docs/plans/e2e-playwright.md); E2E_WORKERS=<n> overrides it.
  fullyParallel: true,
  workers: process.env['E2E_WORKERS'] ? Number(process.env['E2E_WORKERS']) : 4,
  // A cold scenario load (first session on a corridor) takes up to ~30 s.
  // Tests tagged @slow call test.slow(), which triples this.
  timeout: 90_000,
  // No retries: a flaky test must fail, not pass on the second try.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Set per worker by the `baseURL` fixture in e2e/support/fixtures.ts.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', grepInvert: /@slow/, use: { ...devices['Desktop Chrome'] } },
    // Director planning is CPU-bound and forks three planner processes per
    // strategy request. Since its first plan runs off the event loop (bug 6),
    // two `@slow` tests at a time pass; with no limit, two corridor plans at
    // once starved each other past the 90 s settle window (measured, Decisions
    // log). So `@slow` tests run two at a time, next to the other workers.
    { name: 'chromium-director', grep: /@slow/, workers: 2, use: { ...devices['Desktop Chrome'] } },
  ],
});
