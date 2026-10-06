// Shared fixtures: the worker's own backend, language, the clean-run guard
// and the page objects.
//
//   import { test, expect } from './support/fixtures';
//   test.use({ lang: 'de' });
//   test('…', async ({ welcome, work, guard }) => { … });
import { test as base, expect, type Page } from '@playwright/test';

import { BASE_PORT, WorkerBackend } from './backend';
import { EXTERNAL_BASE_URL } from './build';
import { TourIntro, WelcomePage, WorkingScreen } from './pages';

export type Lang = 'en' | 'de' | 'fr';

/** Backend paths whose failure means a setup broke (plan §2.3, point 5). */
const WATCHED_PATHS = ['/session', '/policies', '/operator'];

/**
 * Records what makes a run unclean: console errors, uncaught page errors, and
 * failed or 4xx/5xx requests to the watched backend paths. Tests call
 * `expectClean()` at the end, so the failure message lists every entry.
 */
export class Guard {
  readonly consoleErrors: string[] = [];
  readonly failedRequests: string[] = [];

  constructor(page: Page) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') this.consoleErrors.push(`${msg.text()} (${msg.location().url})`);
    });
    page.on('pageerror', (err) => this.consoleErrors.push(`pageerror: ${err.message}`));
    page.on('requestfailed', (req) => {
      if (!isWatched(req.url())) return;
      this.failedRequests.push(`${req.method()} ${pathOf(req.url())} → ${req.failure()?.errorText ?? 'failed'}`);
    });
    page.on('response', (res) => {
      if (!isWatched(res.url()) || res.status() < 400) return;
      this.failedRequests.push(`${res.request().method()} ${pathOf(res.url())} → HTTP ${res.status()}`);
    });
  }

  expectClean(setup: string): void {
    expect(this.consoleErrors, `${setup}: console errors`).toEqual([]);
    expect(this.failedRequests, `${setup}: failed backend requests`).toEqual([]);
  }
}

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

function isWatched(url: string): boolean {
  const path = new URL(url).pathname;
  return WATCHED_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * A fresh backend process for every spec file, instead of one per worker.
 * Off: measured, a restart costs more than it isolates (plan, Decisions log).
 */
const RESTART_PER_FILE = process.env['E2E_RESTART_PER_FILE'] === '1';

interface Fixtures {
  guard: Guard;
  welcome: WelcomePage;
  work: WorkingScreen;
  intro: TourIntro;
  /** Auto: restarts the worker's backend per spec file when asked. */
  backendCheck: void;
}

interface WorkerFixtures {
  /** This worker's backend; `null` when E2E_BASE_URL points at a running app. */
  backend: WorkerBackend | null;
}

interface Options {
  /** App language, written to `localStorage['flatland.lang']` before the app loads. */
  lang: Lang;
}

export const test = base.extend<Fixtures & Options, WorkerFixtures>({
  backend: [
    async ({}, use, workerInfo) => {
      if (EXTERNAL_BASE_URL) {
        await use(null);
        return;
      }
      const backend = new WorkerBackend(BASE_PORT + workerInfo.parallelIndex);
      // Teardown does not run when the worker process dies; the backend runs
      // in its own process group, so end it here too.
      const onExit = () => backend.killNow();
      process.on('exit', onExit);
      try {
        await backend.start();
        await use(backend);
      } finally {
        process.off('exit', onExit);
        await backend.stop();
      }
    },
    { scope: 'worker', timeout: 90_000 },
  ],
  baseURL: async ({ backend }, use) => {
    await use(backend ? backend.url : EXTERNAL_BASE_URL);
  },
  backendCheck: [
    async ({ backend }, use, testInfo) => {
      if (backend && RESTART_PER_FILE && backend.file !== null && backend.file !== testInfo.file) {
        await backend.restart();
      }
      if (backend) backend.file = testInfo.file;
      await use();
    },
    { auto: true },
  ],
  lang: ['en', { option: true }],
  page: async ({ page, lang }, use) => {
    await page.addInitScript((code) => {
      try {
        localStorage.setItem('flatland.lang', code);
      } catch {
        // Storage unavailable: the app falls back to English, which the test then sees.
      }
    }, lang);

    // Sessions this test created, by backend origin. Playback runs on the
    // server and outlives the page, so without cleanup every earlier test's
    // session keeps stepping and a long run slows down until steps stall.
    const created: string[] = [];
    page.on('response', async (res) => {
      if (res.request().method() !== 'POST' || new URL(res.url()).pathname !== '/session' || !res.ok()) return;
      const id = ((await res.json().catch(() => null)) as { id?: string } | null)?.id;
      if (id) created.push(`${new URL(res.url()).origin}/session/${id}`);
    });

    await use(page);

    for (const session of created) {
      await page.request.post(`${session}/pause`).catch(() => undefined);
      await page.request.delete(session).catch(() => undefined);
    }
  },
  guard: async ({ page }, use) => {
    await use(new Guard(page));
  },
  welcome: async ({ page }, use) => {
    await use(new WelcomePage(page));
  },
  work: async ({ page }, use) => {
    await use(new WorkingScreen(page));
  },
  intro: async ({ page }, use) => {
    await use(new TourIntro(page));
  },
});

export { expect };
