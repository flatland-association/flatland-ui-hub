# End-to-end tests (Playwright)

The E2E suite drives the real app in a real browser (Chromium) against the real
backend. Every setup a user can pick on the start screen is started, checked
for the right mode and panels, and run. A passing `npm run e2e` means those
setups still start and run. A failing run names the setup that broke.

- **Runs locally only.** CI does not run it yet. Run it yourself before you
  open a PR: it is part of the
  [Definition of done](../../CONTRIBUTING.md#4-definition-of-done).
- **Nothing needs to be running.** The suite builds the frontend and starts its
  own backends.
- Design and history: [`docs/plans/e2e-playwright.md`](../plans/e2e-playwright.md)
  (Decisions log, Known bugs).

## Run it

You need the setup from [`start-contributing.md`](../start-contributing.md)
§1: `scripts/setup-dev.sh` installs the backend, the frontend and the Chromium
browser. If you skipped the browser (`SETUP_NO_PLAYWRIGHT=1`), run
`npm run e2e:install` once.

All commands run in `frontend/`:

| What | Command | Time (8 cores) |
| --- | --- | --- |
| Everything (90 tests) | `npm run e2e` | about 3 min |
| Everything except Director (76 tests) | `npm run e2e:fast` | about 1 min |
| One file | `npx playwright test e2e/tours.spec.ts` | |
| Tests whose title matches | `npx playwright test -g "olten-zug-weg"` | |
| With a visible browser | `npm run e2e:headed -- -g "smoke"` | |
| Playwright UI mode (pick and watch tests) | `npm run e2e:ui` | |
| List the tests without running them | `npx playwright test --list` | |
| Open the last HTML report | `npm run e2e:report` | |
| Open one trace | `npx playwright show-trace test-results/<test folder>/trace.zip` | |

`-g` takes a regular expression over the full test title, for example
`-g "build · director · olten "`. Test titles are the setup names listed by
`--list`.

## What it covers

The cases are generated from the app's own data (`e2e/support/matrix.ts`), so a
new tour, study condition, layout preset, mode or backend scenario preset gets a
test without editing the suite. The coverage guard fails if one is missing.

| File | Cases | Tests |
| --- | --- | --- |
| `build.spec.ts` | Build door: each mode × {guided demo, random, each backend scenario preset} in the default layout, plus each `LAYOUT_PRESETS` entry once on the guided demo, in the mode it is meant for | 45 |
| `tours.spec.ts` | Introduction door: every tour in its scripted variant, plus one live variant with seed 4242. Experiments door: every tour with `door: 'experiments'` | 10 |
| `experiments.spec.ts` | Experiments door: every `STUDY_CONDITIONS` entry. Without a fixed scenario: every preset with a plan, once with no disturbances and once with all ticked | 10 |
| `languages.spec.ts` | EN, DE, FR: the start screen, and one full flow per door driven by clicks | 12 |
| `hash-screens.spec.ts` | `#/widgets`, `#/algorithms`, `#/scenarios`, `#/contribute`, `#/infrastructure-builder`, `#/designer` load with no console errors | 6 |
| `coverage.spec.ts` | Coverage guard: the case lists match `TOURS`, `STUDY_CONDITIONS`, the `InteractionMode` union, `LAYOUT_PRESETS` and the backend presets | 5 |
| `concurrent-sessions.spec.ts` | Two sessions alive at once don't break each other (backend only) | 1 |
| `smoke.spec.ts` | The start screen renders | 1 |

Each setup test checks, in this order (`e2e/support/setup-check.ts`):

1. **Started:** `POST /session` answers 2xx and the WebSocket shows connected.
2. **Right mode:** the active mode tab, and the mode-restricted panels that
   [`panel-mode-matrix.md`](panel-mode-matrix.md) allows are visible, while the
   ones it excludes don't exist.
3. **Runs:** after play, the step counter rises.
4. **Clean:** no console errors, and no failed requests to `/session`,
   `/policies` or `/operator`.
5. **Tours only:** the mode intro appears, "Start scenario" leads into the run,
   and tours with a survey reach it.

## How a run works

```
npm run e2e
  └─ globalSetup: ng build --configuration development → frontend/dist/e2e   (once, ~5 s cached)
  └─ worker 0 ─ backend on 127.0.0.1:8100 ─ serves dist/e2e + the API ─ Chromium
  └─ worker 1 ─ backend on 127.0.0.1:8101 ─ …
  └─ …  (one backend per worker)
```

- **One backend per worker.** Each Playwright worker starts its own
  `python -m uvicorn app.main:app` on port `8100 + <worker index>`
  (`e2e/support/backend.ts`). It serves the E2E build through the backend
  setting `FRONTEND_DIST`, the way `./start-demo.sh` does, so the page and the
  API share one origin and a worker's tests only talk to their own backend.
  Leftover work from one test can't slow down another worker, and each
  backend's log belongs to one worker's tests.
- **Python:** `backend/.venv/bin/python` if it exists, else `python3` from
  `PATH` (the dev container installs without a venv).
- **Two projects.** `chromium` runs everything except `@slow` tests, with up to
  4 workers. `chromium-director` runs the `@slow` (Director) tests, at most 2 at
  a time, next to the others.
- **Cleanup.** Each test pauses and deletes the sessions it created. The
  backends stop when their worker ends.
- **Backend presets** are read once per run from
  `app.core.scenario_presets.list_presets()` through the backend interpreter,
  because Playwright collects the tests before any backend runs.

### Environment variables

| Variable | Effect |
| --- | --- |
| `E2E_WORKERS=<n>` | Total number of workers, and so of backends (default 4). Lower it on a smaller machine, see [Resource use](#resource-use). |
| `E2E_SKIP_BUILD=1` | Reuse the last build in `frontend/dist/e2e` instead of building. Use it when only test files changed. Fails if there is no earlier build. |
| `E2E_BASE_URL=<url>` | Run against an app that is already up, for example `http://localhost:4200` from `npm run start` with its backend on :8000. Nothing is built and no backend is started, so failures can't quote the backend log. Set `E2E_WORKERS=1` with it: all tests then share that one backend. |
| `E2E_RESTART_PER_FILE=1` | Restart each worker's backend before every spec file. Off by default: measured, it costs more time than it isolates. |
| `CI` | When set, a stray `test.only` fails the run. |
| `FRONTEND_DIST` | Backend setting the suite sets for its backends. Don't set it yourself. |
| `E2E_SCENARIO_PRESETS` | Internal cache of the backend preset list within one run. Don't set it. |

### Resource use

Measured on an Apple Silicon machine with 8 cores and 16 GB: about **5 GB at
peak** (each backend 1.1–1.85 GB, all backends together about 3 GB, Chromium
about 2.2 GB). The suite is **CPU-bound**, not memory-bound. Each Director
strategy request forks 3 planner processes, and two corridor plans at once
starve each other.

- **Why 4 workers:** with 6, five Director tests missed their time limit. 4 was
  the most that stayed green.
- **Why Director runs at most 2 at a time:** with no limit, two
  `pf-ch-corridor` Director tests planning together missed the 90 s settle
  window. With 2, both pass, with a margin of about 25 s.

On a machine or container with fewer cores, lower the workers instead of
raising timeouts:

```bash
E2E_WORKERS=2 npm run e2e
```

## Read a failure

Every assertion message starts with the setup name, for example
`build · co-learning · olten · default layout: panel "recommendations" must not
exist in co-learning`. That tells you which setup broke and what was wrong.

Where to look, in order:

1. **The terminal.** The `list` reporter prints each failure with its message
   and the paths of its files.
2. **The backend cause.** If backend requests failed during the test, a second
   error follows:
   ```
   Backend errors during this test (the likely cause of the failure):
     backend 500 on GET /session/<id>/hmi/contention-strategies: AssertionError: …
   ```
   Each line is one failed request (every 5xx, and 4xx on `/session`,
   `/policies`, `/operator`) with the backend's error. A bare 500 is paired
   with the Python traceback from the log. `backend logged: …` lines are errors
   the backend only logged.
3. **Attachments** (only on unexpected failures):
   - `backend.log`: that worker's backend output during this one test,
     tracebacks included.
   - `failed-responses.json`: the failed responses as
     `{status, method, path, detail}`, where `detail` is FastAPI's error text.

   Open them in the HTML report (`npm run e2e:report`), next to the trace and
   screenshot.
4. **`test-results/<test folder>/`**, one folder per failed test:
   - `error-context.md`: the error and a text snapshot of the page. Read this
     if you can't open a GUI (coding agents).
   - `trace.zip`: open with `npx playwright show-trace`. It holds every action,
     DOM snapshot, console message and network request.
   - `test-failed-1.png`: the screenshot at the failure.

`test-results/` and `playwright-report/` are replaced by the next run and are
gitignored.

### Known bug or regression?

App bugs the suite has found are listed in the plan's
[Known bugs](../plans/e2e-playwright.md#known-bugs).

- A test of a known open bug is marked `test.fail()` with a `// KNOWN BUG`
  comment. It shows as passing ("expected to fail"). If it turns red with
  **"expected to fail, but passed"**, the bug is fixed: remove the mark and move
  the entry to "Fixed".
- A failure that matches a row's "How to recognise it" column is that bug.
- Anything else is a regression until shown otherwise. Run the test alone
  (`npx playwright test -g "<setup name>"`). If it fails alone, it is real.
- A Director test that fails only in the full run, with **no** backend error,
  points to CPU contention (see [Resource use](#resource-use)). Try
  `E2E_WORKERS=2`. Don't raise timeouts.

## Folder layout

```
frontend/
  playwright.config.ts        workers, projects, timeouts, reporters
  e2e/
    *.spec.ts                 the tests (table above)
    support/
      app-data.ts             imports TOURS, STUDY_CONDITIONS, LAYOUT_PRESETS, PANEL_MODE_AVAILABILITY,
                              INTERACTION_MODES from src/, and the backend presets
      matrix.ts               builds every case list from app-data
      pages.ts                page objects: WelcomePage, TourIntro, WorkingScreen
      fixtures.ts             test + expect to import; fixtures below
      setup-check.ts          expectSetupRuns() and walkTour(): the checks every setup makes
      panel-expectations.ts   which mode-restricted panels a layout must show or hide
      backend.ts              the per-worker backend
      global-setup.ts, build.ts, python.ts
```

**Fixtures.** Import `test` and `expect` from `./support/fixtures`, never from
`@playwright/test`:

| Fixture | What it gives |
| --- | --- |
| `welcome`, `intro`, `work` | The page objects for the start screen, the tour intro and the working screen. |
| `guard` | Records console errors and failed backend requests. Call `guard.expectClean(name)` at the end. |
| `lang` | The app language, set before the page loads: `test.use({ lang: 'de' })`. |
| `page` | Playwright's page, plus cleanup of the sessions the test created. |
| `request` | Playwright's API client, pointed at this worker's backend. |
| `backend` | This worker's backend (`null` with `E2E_BASE_URL`). Tests rarely need it. |

**Page objects** wrap every locator. Add a method there rather than calling
`page.getByTestId` in a spec.

## Rules for tests

- **Find elements by `data-testid` only.** Visible labels change with the
  language. `getByRole` does not see SBB Lyne buttons (Lyne sets the role
  through `ElementInternals`). `grep -rnE "getByText|hasText|text=" frontend/e2e`
  must return nothing.
- **`data-testid` naming:** `<area>-<element>[-<id>]`, stable English ids,
  never translated, never shown. Examples: `welcome-door-build`,
  `welcome-start`, `mode-tab-director`, `panel-recommendations`. On a Lyne
  component, put it on the host element. Adding a `data-testid` is the only app
  change a test may need.
- **Assert on states, not on simulation numbers** (started, mode, panel
  visible, counter rose).
- **No blind waits** (`waitForTimeout`), **no retries**, and don't weaken an
  assertion to make a test pass.
- **`@slow`** marks tests that open in Director: planning takes about a minute.
  Give such a test `{ tag: ['@slow'] }` and call `test.slow()` in it (triple
  timeout). `@slow` tests run in the `chromium-director` project, and
  `npm run e2e:fast` skips them.

## Add a test

| You added | What to do |
| --- | --- |
| A tour, study condition, layout preset or backend scenario preset | Nothing in the suite: it is picked up from the app's data. Run `npx playwright test -g "<its id>"`, then `npm run e2e:fast`. |
| An interaction mode | Add it to the `InteractionMode` union and to `INTERACTION_MODES` (the mode tabs). The coverage guard fails if one is missing. If it plans like Director, extend `isSlowMode()` in `matrix.ts`. |
| A panel | Register it in `panel-mode-availability.ts` if it depends on the mode (the `create-widget` skill does this). Preset layouts tag it as `panel-<type>` on their own. If it sits in the default layout, add `data-testid="panel-<type>"` in `app.component.html` and its type to `SYSTEM_LAYOUT_SLOTS` in `panel-expectations.ts`. |
| A screen reachable by hash | Add `data-testid="screen-<name>"` to it and the name to `SCREENS` in `hash-screens.spec.ts`. |
| A new control in a flow | Add a `data-testid`, a page-object method in `pages.ts`, and use it from the spec. |
| Something else | Extend the matrix or a page object rather than writing a one-off test. |

Then run the narrowest command first (`-g`), then `npm run e2e:fast`, then
`npm run e2e` before the PR.

## Known limits

- Chromium only. No Firefox, WebKit or real devices.
- Needs the real backend and its Python environment. Nothing is mocked.
- No visual regression (no screenshot comparison).
- Not in CI yet.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `E2E backend: port 81xx is already in use` | A backend from an aborted run is still up. Find it with `lsof -i :8100` and stop it. |
| `Executable doesn't exist at …chromium…` | `npm run e2e:install` |
| `E2E_SKIP_BUILD=1, but there is no earlier build` | Run once without `E2E_SKIP_BUILD`. |
| `E2E: ng build failed` | The app doesn't compile. Fix the first error it prints. |
| `ModuleNotFoundError` from Python when the run starts | The backend dependencies are missing: run `scripts/setup-dev.sh`. |
