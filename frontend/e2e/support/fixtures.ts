// Shared fixtures: language, the clean-run guard and the page objects.
//
//   import { test, expect } from './support/fixtures';
//   test.use({ lang: 'de' });
//   test('…', async ({ welcome, work, guard }) => { … });
import { test as base, expect, type Page } from '@playwright/test';

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

interface Fixtures {
  guard: Guard;
  welcome: WelcomePage;
  work: WorkingScreen;
  intro: TourIntro;
}

interface Options {
  /** App language, written to `localStorage['flatland.lang']` before the app loads. */
  lang: Lang;
}

export const test = base.extend<Fixtures & Options>({
  lang: ['en', { option: true }],
  page: async ({ page, lang }, use) => {
    await page.addInitScript((code) => {
      try {
        localStorage.setItem('flatland.lang', code);
      } catch {
        // Storage unavailable: the app falls back to English, which the test then sees.
      }
    }, lang);
    await use(page);
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
