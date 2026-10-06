// End-to-end tests (plan: docs/plans/e2e-playwright.md).
// `npm run e2e` starts the backend (:8000) and the frontend dev server (:4200)
// itself, or reuses them when they already run (outside CI).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const backendDir = resolve(__dirname, '../backend');

// The interpreter scripts/setup-dev.sh installed into: backend/.venv when it
// exists, otherwise whatever `python3` is on PATH (an active virtualenv, or the
// system Python in the dev container, which runs setup with SETUP_NO_VENV=1).
const venvPython = [
  join(backendDir, '.venv', 'bin', 'python'),
  join(backendDir, '.venv', 'Scripts', 'python.exe'),
].find((p) => existsSync(p));
const python = venvPython ? `"${venvPython}"` : 'python3';

export default defineConfig({
  testDir: './e2e',
  forbidOnly: !!process.env['CI'],
  // Every test creates its own session, so tests run in parallel across files
  // and within them. All workers share one backend process, which does the
  // simulation and planning; more workers than this slow each test down instead
  // of the run (measured, see the Decisions log in docs/plans/e2e-playwright.md).
  fullyParallel: true,
  workers: process.env['E2E_WORKERS'] ? Number(process.env['E2E_WORKERS']) : 1,
  // A cold scenario load (first session on a corridor) takes up to ~30 s, and
  // the backend keeps computing for earlier sessions in the background. Tests
  // tagged @slow call test.slow(), which triples this.
  timeout: 90_000,
  // No retries: a flaky test must fail, not pass on the second try.
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      name: 'backend',
      command: `${python} -m uvicorn app.main:app --port 8000`,
      cwd: backendDir,
      url: 'http://localhost:8000/health',
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
    {
      name: 'frontend',
      command: 'npm run start',
      cwd: __dirname,
      url: 'http://localhost:4200',
      reuseExistingServer: !process.env['CI'],
      timeout: 180_000,
    },
  ],
});
