// Shared fixtures: the worker's own backend, language, the clean-run guard,
// the page objects, and failures that name the backend error behind them.
//
//   import { test, expect } from './support/fixtures';
//   test.use({ lang: 'de' });
//   test('…', async ({ welcome, work, guard }) => { … });
import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';

import { test as base, expect, type Page, type Response } from '@playwright/test';

import { BASE_PORT, WorkerBackend, backendExceptions } from './backend';
import { EXTERNAL_BASE_URL } from './build';
import { TourIntro, WelcomePage, WorkingScreen } from './pages';

export type Lang = 'en' | 'de' | 'fr';

/** Backend paths whose failure means a setup broke. */
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
      const entry = `${res.request().method()} ${pathOf(res.url())} → HTTP ${res.status()}`;
      const index = this.failedRequests.push(entry) - 1;
      // The backend's own error, added when the body has arrived.
      void errorDetail(res).then((detail) => {
        if (detail) this.failedRequests[index] = `${entry}: ${detail}`;
      });
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

/** FastAPI's `{"detail": …}`, else the start of the body. */
async function errorDetail(res: Response): Promise<string> {
  const body = await res.text().catch(() => '');
  try {
    const detail = (JSON.parse(body) as { detail?: unknown }).detail;
    if (detail !== undefined) return typeof detail === 'string' ? detail : JSON.stringify(detail);
  } catch {
    // Not JSON.
  }
  return body.trim().slice(0, 300);
}

interface FailedResponse {
  status: number;
  method: string;
  path: string;
  detail: string;
}

/**
 * Backend responses that failed during one test: every 5xx, and 4xx on the
 * watched paths. With the backend log, they make the failure message name the
 * request, status and backend error instead of only the timeout they caused.
 */
export class BackendErrors {
  readonly responses: FailedResponse[] = [];
  private readonly pending: Promise<void>[] = [];
  private stopped = false;

  record(res: Response): void {
    // After the test body: the page still polls while cleanup deletes its
    // sessions, and those 404s say nothing about why the test failed.
    if (this.stopped) return;
    const status = res.status();
    if (status < 400 || (status < 500 && !isWatched(res.url()))) return;
    this.pending.push(
      errorDetail(res).then((detail) => {
        this.responses.push({ status, method: res.request().method(), path: pathOf(res.url()), detail });
      }),
    );
  }

  /** Stop recording and wait for the bodies still being read (before the page closes). */
  async settle(): Promise<void> {
    this.stopped = true;
    await Promise.all(this.pending);
  }

  /**
   * One line per failed response, with the backend exception logged for it.
   * An unhandled exception answers 500 with a bare "Internal Server Error", so
   * those are paired in order with the tracebacks in the backend log.
   */
  describe(exceptions: string[]): string[] {
    const tracebacks = exceptions.filter((e) => !/\bfailed\b/i.test(e));
    const bare = this.responses.filter((r) => r.status >= 500 && /^internal server error$/i.test(r.detail));
    const paired = bare.length === tracebacks.length;
    const lines = this.responses.map((r) => {
      const fromLog = paired && bare.includes(r) ? tracebacks[bare.indexOf(r)] : null;
      return `backend ${r.status} on ${r.method} ${r.path}: ${fromLog ?? (r.detail || '(no body)')}`;
    });
    const unpaired = paired ? exceptions.filter((e) => !tracebacks.includes(e)) : exceptions;
    return [...lines, ...unpaired.map((e) => `backend logged: ${e}`)];
  }
}

/**
 * A fresh backend process for every spec file, instead of one per worker.
 * Off by default: a restart costs more than it isolates.
 */
const RESTART_PER_FILE = process.env['E2E_RESTART_PER_FILE'] === '1';

interface Fixtures {
  guard: Guard;
  welcome: WelcomePage;
  work: WorkingScreen;
  intro: TourIntro;
  backendErrors: BackendErrors;
  /** Auto: restarts per file when asked, and names backend errors on failure. */
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
  backendErrors: async ({}, use) => {
    await use(new BackendErrors());
  },
  backendCheck: [
    async ({ backend, backendErrors }, use, testInfo) => {
      if (backend && RESTART_PER_FILE && backend.file !== null && backend.file !== testInfo.file) {
        await backend.restart();
      }
      if (backend) backend.file = testInfo.file;
      const mark = backend?.mark() ?? 0;

      await use();

      if (testInfo.status === testInfo.expectedStatus) return;
      const log = backend?.since(mark) ?? [];
      // Written as files next to error-context.md, so an agent without a GUI
      // can read them whole (the terminal only previews an inline attachment).
      const logPath = testInfo.outputPath('backend.log');
      if (log.length) {
        writeFileSync(logPath, log.join('\n'));
        await testInfo.attach('backend.log', { path: logPath, contentType: 'text/plain' });
      }
      if (backendErrors.responses.length) {
        const responsesPath = testInfo.outputPath('failed-responses.json');
        writeFileSync(responsesPath, JSON.stringify(backendErrors.responses, null, 2));
        await testInfo.attach('failed-responses.json', { path: responsesPath, contentType: 'application/json' });
      }
      const causes = backendErrors.describe(backendExceptions(log));
      if (causes.length) {
        throw new Error(
          `Backend errors during this test (the likely cause of the failure):\n  ${causes.join('\n  ')}\n` +
            `Full backend output: ${relative(process.cwd(), logPath)}`,
        );
      }
    },
    { auto: true },
  ],
  lang: ['en', { option: true }],
  page: async ({ page, lang, backendErrors }, use) => {
    page.on('response', (res) => backendErrors.record(res));
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

    await backendErrors.settle();
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
