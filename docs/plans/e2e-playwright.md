# End-to-end tests with Playwright

Status: all four stages done, 2026-10-07, except two open gates: **G4.1**'s second tool (Codex or Copilot) is not checked, because it would run on the maintainer's own account, and **G2.8** waits for the PR description. `npm run e2e` passes in the sense of the rule below: 85 tests pass and the 5 tests of open known bug 7 fail red, with their cause named ([Known bugs](#known-bugs)). Known bugs 5, 7 and 8 stay open; their fixes are not part of this work. Bugs 1, 2, 3, 4 and 6 were fixed.

This plan is written for the coding agent that implements it. Work through the
four stages in order. A stage is done only when every gate in it passes; do not
start the next stage before that. Report each gate's result (command and
outcome) in the PR description.

## Why

Most changes here are made by AI coding agents. Today an agent can verify its
work only with `ng build`, the Karma unit specs, or a human clicking through the
app. None of these shows whether the whole flow (start screen → setup → running
simulation in the right mode) still works. An end-to-end (E2E) suite that drives
a real browser closes that gap: an agent runs it, reads what broke, and fixes it
without a human in the loop.

## Read first

| What | Where |
| --- | --- |
| Repo rules (colours, i18n, do-not-touch list, branching) | [`AGENTS.md`](../../AGENTS.md), [`frontend/AGENTS.md`](../../frontend/AGENTS.md) |
| Mode semantics, per-panel behaviour per mode | [`docs/reference/interaction-modes-brief.md`](../reference/interaction-modes-brief.md), [`docs/reference/panel-mode-matrix.md`](../reference/panel-mode-matrix.md) |
| Architecture | [`docs/reference/architecture.md`](../reference/architecture.md) |
| Setup guides that must stay correct | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) §2, [`docs/start-contributing.md`](../start-contributing.md) §1 and §5, [`scripts/setup-dev.sh`](../../scripts/setup-dev.sh) |
| Existing skill, as the format to copy | [`.agents/skills/create-widget/SKILL.md`](../../.agents/skills/create-widget/SKILL.md) |
| Playwright docs | <https://playwright.dev/docs/intro>, `webServer`: <https://playwright.dev/docs/test-webserver>, locators: <https://playwright.dev/docs/locators>, trace viewer: <https://playwright.dev/docs/trace-viewer> |

## Facts about the app the tests depend on

Checked in the code on 2026-10-06, corrected on 2026-10-07 after Stage 2. Re-check before relying on them.

**Stack**
- Angular 22, standalone components and signals, in `frontend/`.
- SBB Lyne web components (`@sbb-esta/lyne-elements`) render in open shadow DOM. Playwright locators pierce open shadow DOM by default, so no special selectors are needed. `getByRole` still does not find Lyne buttons, because Lyne sets their role through `ElementInternals` (Decisions log); the suite uses `data-testid` only.
- Backend: FastAPI + Flatland in `backend/`, started with `uvicorn app.main:app --port 8000`.
- `npm run start` serves the frontend on `:4200` and proxies `/session`, `/policies`, `/health`, `/operator` and the `/ws` WebSocket to `:8000` (`frontend/proxy.conf.json`).
- `./start-demo.sh` builds the frontend and serves everything from `:8000`.
- On any port other than 4200 the app calls the backend on its own origin (`core/backend-origin.ts`). The E2E suite relies on this: each worker's backend serves the build itself, on `:8100` and up (Decisions log).

**Start screen**
- Lives in `frontend/src/app/app.component.{ts,html}`.
- It has three "doors" (`welcomeDoor`: `introduction` | `build` | `experiments`) and exactly one Start button (`startFromWelcome()`).

**Introduction door (tours)**
- Tours are defined in `TOURS` in `frontend/src/app/core/demo/tours.ts`.
- Tours with `door: 'experiments'` show in the Experiments door instead.
- Each tour has `modes`, `surveyAfterEachMode` and a variant: `scripted` or `live` with an optional seed.

**Build door**
- Choose the network: the guided demo (`guided-demo`, fixed seed 42), `random` (width, height, number of agents, max steps), backend scenario presets (`GET /session/scenario-presets`), or infrastructure scenes saved in the browser.
- Choose the layout: the system default (`system-default-runtime-layout`) or one from `LAYOUT_PRESETS` in `frontend/src/app/core/layout/layout-presets.ts`.
- There is no mode picker on the start screen. Every session starts in Recommendation; the mode (`InteractionMode` in `core/events/event-types.ts`: `recommendation` | `co-learning` | `director`) is switched on the mode tabs (`mode-tab-<id>`) once the session runs.

**Experiments door**
- Study conditions come from `STUDY_CONDITIONS` in `core/demo/study-conditions.ts`. There are four (User Study 2 and 3, recommendation and co-learning).
- Some conditions have a fixed scenario. The others pick from presets with `has_plan`.
- The person can tick disturbances and enters a participant id.

**Deep links**
- These already exist (see `applyWelcomeDeepLink()`):
  - `#/tour/<tourId>[/live[/<seed>]][/start]`
  - `#/experiment/<layoutId>[/<scenarioId>][/start]`
- A trailing `/start` presses Start once the presets have loaded.
- The Build door has no deep link.

**Language**
- EN, DE and FR, stored in `localStorage` under `flatland.lang` (`core/i18n/language.service.ts`).
- Visible labels change with the language, so tests must not find elements by text.

**Other screens reachable by hash**
- `#/widgets`, `#/algorithms`, `#/scenarios`, `#/contribute`, `#/infrastructure-builder` and `#/designer` (layout designer).

**Timing**
- Director planning can take about a minute (see the `corridor-director` tour description). Since bug 6's fix the first plan runs off the event loop; on `pf-ch-corridor` it took about 25 s.

**Test hooks**
- Stage 2 added `data-testid` attributes to every control the flows touch, and `panel-<type>` to the mode-restricted panels (preset layouts get it from `panel-shell`).
- CI (`.github/workflows/ci.yml`) runs no frontend tests and not the E2E suite; it runs locally only.

## Rules for this work

- Branch off `explore_db`, and open the PR against `explore_db`. Commits use `type(scope): summary`, e.g. `test(e2e): …`.
- Every existing CI check must stay green after every stage:
  ```bash
  cd frontend && npm run lint:styles && npm run i18n:check && npx ng build --configuration production
  cd backend && pytest -q
  ```
- **Don't change app behaviour to make a test pass.** The only app-code changes allowed are:
  - adding `data-testid` attributes
  - test-only switches that are off by default, each one written down as a decision in this file (see "Decisions log")
- `data-testid` values are stable English ids, never translated, and never shown to users.
  - Naming: `<area>-<element>[-<id>]`, e.g. `welcome-door-build`, `welcome-start`, `tour-option-olten-zug-weg`.
  - On a Lyne component, put the attribute on the host element.
- Leave the do-not-touch list in `AGENTS.md` alone (`_recordTrajectory`, scenario-refresh throttling, `_recoverPolicyAndRetry*`).
- No hardcoded colours, and no new user-facing text outside `frontend/public/i18n/*.json`.
- Use only free, open-source tooling. Don't add Playwright's paid or cloud services.
- **Known open app bugs fail red.** A test broken by an app bug that this work does not fix keeps failing, with a message that names the cause. It is never marked `test.fail()`, skipped or filtered out. The bug gets a row in [Known bugs](#known-bugs) with the file:line of its fix location, a comment-only `KNOWN BUG <n> (docs/plans/e2e-playwright.md#known-bugs): …` at that place in the app code, and a `KNOWN BUG <n>` comment in the failing test that points to it (user decision 2026-10-07, Decisions log).
- **"`npm run e2e` passes"** in the gates below means: all tests pass except the tests of open Known bugs, which fail red with their cause named.

---

## Stage 1: Playwright installed and running for everyone

**Goal:** someone who sets up the repo from the guides gets a working Playwright, and one trivial test proves it. App code is not touched.

### Tasks
1. In `frontend/`, add `@playwright/test` as a dev dependency, pinned to an exact version.
2. Add `frontend/playwright.config.ts`:
   - `testDir: './e2e'`, `baseURL` from `E2E_BASE_URL`, defaulting to `http://localhost:4200`.
   - `webServer` with two entries: the backend (`uvicorn app.main:app --port 8000`, run from `backend/` with the `backend/.venv` interpreter when it exists) and the frontend (`npm run start`).
     - Both use `reuseExistingServer: !process.env.CI`, so a developer's already-running servers are reused.
     - The backend entry waits on `http://localhost:8000/health`.
     - *Superseded in Stage 2:* the shared `webServer` (:8000 + :4200) is gone. `globalSetup` builds the frontend into `frontend/dist/e2e`, and every worker starts its own backend on `:8100 + <worker index>` that serves that build. `E2E_BASE_URL` now means "run against an app that already runs" and defaults to nothing. See the Decisions log and [`e2e-testing.md`](../reference/e2e-testing.md#how-a-run-works).
   - Chromium project only for now.
   - `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'`, reporters `list` and `html` (with `open: 'never'`).
   - Output folders are gitignored (`frontend/test-results/`, `frontend/playwright-report/`, `frontend/blob-report/`).
3. Add npm scripts to `frontend/package.json`:
   - `e2e`: run all tests headless
   - `e2e:headed`: with a visible browser
   - `e2e:ui`: Playwright UI mode
   - `e2e:report`: open the last HTML report
   - `e2e:install`: install the Chromium browser
4. In `scripts/setup-dev.sh`, after `npm ci`, install the Playwright Chromium browser:
   - On Linux, include the system dependencies (`--with-deps`). This covers the dev container and the Copilot sandbox, which both call this script.
   - Allow skipping with `SETUP_NO_PLAYWRIGHT=1`, and document that flag in the script header.
   - Keep the script idempotent.
5. Add one smoke test, `frontend/e2e/smoke.spec.ts`:
   - It loads `/` and asserts that the start screen renders: the page has the Start button, found by role, and the browser console shows no errors.
   - Text-free locators aren't possible yet without test ids. A role locator is fine here, and Stage 2 replaces it.
   - *As built:* a role locator did not work, because `getByRole` does not see Lyne buttons. Stage 1 used the class `sbb-button.welcome-start`, and Stage 2 replaced it with `data-testid="welcome-start"` (Decisions log).
6. Update the setup guides:
   - The **Commands** block in `AGENTS.md` and the **Commands** block in `frontend/AGENTS.md`
   - `CONTRIBUTING.md` §2 and `docs/start-contributing.md` §1 (what setup now installs) and §5 (how to run the E2E suite)
   - The "Done. Next:" message in `setup-dev.sh`

### Gates
- [x] **G1.1** A fresh clone, after `scripts/setup-dev.sh`, then `cd frontend && npm run e2e`, passes with both servers started by Playwright. Run it once with no servers running beforehand. *(Since Stage 2: the suite builds the frontend and starts one backend per worker.)*
  Met 2026-10-07, re-run after the known-bug rule: fresh clone of 2801f91, `scripts/setup-dev.sh` (33 s), `npm run e2e` with nothing running: 85 passed, 5 failed red (bug 7), 6.3 min.
- [x] **G1.2** With backend and frontend already running, `npm run e2e` reuses them and passes. *(Since Stage 2: `E2E_BASE_URL=http://localhost:4200 npm run e2e` runs against them.)*
  Met 2026-10-07: full run 90/90 in 5.7 min (G3.4 row). After the "Runs" change, re-checked with four setups (smoke, a Build-door, a tour and an experiment) against `uvicorn` on :8000 and `npm run start` on :4200: 4 passed.
- [x] **G1.3** `SETUP_NO_PLAYWRIGHT=1 scripts/setup-dev.sh` completes without downloading a browser.
  Met 2026-10-07, re-run in the fresh clone: "skipping the Playwright browser (SETUP_NO_PLAYWRIGHT=1)".
- [x] **G1.4** The dev container (`.devcontainer/devcontainer.json`, which runs `setup-dev.sh`) builds, and `npm run e2e` passes inside it.
  Met 2026-10-07 (G3.1, `E2E_WORKERS=2`, 90/90 under the earlier checks). Not re-run after the Director and "Runs" check changes; nothing in the container or setup changed since.
- [x] **G1.5** `git status` after a test run shows no untracked report or result folders.
  Met 2026-10-07: clean in the fresh clone after the full run (failed tests included); in the working checkout only the unrelated `backend/package*.json`.
- [x] **G1.6** `git diff --stat` shows no changes under `frontend/src/`.
  Met for Stage 1 with one recorded exception (the icon fix, Decisions log). Later stages are covered by G2.6.
- [x] **G1.7** All existing CI checks are green.
  Met 2026-10-07 (see G4.5).

---

## Stage 2: tests for every selectable setup

**Goal:** by the end of this stage, a passing `npm run e2e` means every setup a user can pick in the frontend starts and runs as expected. A failing run points to the setup that broke.

### 2.1 Test hooks
Add `data-testid` to every control a flow touches:
- start-screen doors, the Start button, the tour list, the tour variant and seed fields, the network/layout/mode choices, the study-condition and scenario choices, the disturbance checkboxes, the participant field, the language switch
- the run controls (play/pause, step counter, WebSocket status in the status bar)
- the tour briefing/intro "Start scenario" and "Exit" buttons
- the top-level container of each panel that the panel-mode matrix says is mode-specific

Put the shared setup in `frontend/e2e/support/`:
- page objects, meaning one class per screen that wraps its locators and actions (`WelcomePage`, `WorkingScreen`, `TourIntro`)
- fixtures, such as setting the language through `localStorage` `flatland.lang` before the page loads (`page.addInitScript`)

### 2.2 The setup matrix
Generate the matrix from the app's own source of truth, so a new tour or condition is picked up automatically and can't be silently missed:
- `TOURS` (both doors)
- `STUDY_CONDITIONS`
- `InteractionMode`
- `LAYOUT_PRESETS`

If importing those modules into Playwright pulls in Angular, extract the plain data into a separate module first. That counts as a pure refactor, so it keeps behaviour identical and keeps the build green. If that isn't feasible, keep a hand-written `e2e/setups.ts` plus a **coverage guard test** that fails when a tour id, condition id or mode exists in the app but not in the matrix.

The matrix must cover:

| Area | Cases |
| --- | --- |
| Introduction door | every tour with `door` unset or `'tour'`, in the scripted variant; plus one live variant with a fixed seed |
| Experiments door, tour kind | every tour with `door: 'experiments'` |
| Experiments door, condition kind | every entry in `STUDY_CONDITIONS`. For conditions without a fixed scenario, every preset with `has_plan`. Run once with no disturbances and once with all disturbances ticked. |
| Build door | each interaction mode × {guided demo, random, each backend scenario preset} with the default layout. Plus each `LAYOUT_PRESETS` entry once, with the guided demo. |
| Languages | the start screen and one full flow per door in each of EN, DE, FR |
| Hash screens | each of `#/widgets`, `#/algorithms`, `#/scenarios`, `#/contribute`, `#/infrastructure-builder` and `#/designer`: loads with no console errors |

### 2.3 What each setup test asserts
1. **Reach it by clicking.** Each door is driven through the start screen with clicks at least once, as a user would. Other cases may use the existing deep links (`#/tour/<id>/start`, `#/experiment/<layoutId>/<scenarioId>/start`) for speed.
2. **Started.** The session is created: `POST /session` returns 2xx, and the WebSocket status shows connected.
3. **Right mode.** The panels that `panel-mode-matrix.md` lists for that mode are visible, and the ones it excludes are not.
4. **Runs.** After pressing play, the step counter increases within a timeout.
5. **Clean.** No console errors, and no failed requests to `/session`, `/policies` or `/operator`.
6. **Tour-specific.** For tours, the first mode's intro appears, "Start scenario" leads into the run, and tours with `surveyAfterEachMode: true` reach the survey. Reaching the survey may sit behind the `@slow` tag.

Tag tests that need more than about 30 seconds (Director planning, full tours) with `@slow`. `npm run e2e` runs everything. Add `npm run e2e:fast`, which runs `--grep-invert @slow`.

### 2.4 Repeatability
- Use fixed seeds everywhere a seed is selectable: the guided demo is seed 42, and live tours take a seed in the deep link.
- Don't assert on simulation numbers that depend on timing. Assert on states (started, mode, panel visible, counter increased).
- If a test needs the app to be faster or still (tempo, smooth motion), first look for an existing setting in the UI or the code (`core/play-speed.ts`, the smooth-motion switch). Only if there is none, add a test-only switch, and record it in the Decisions log.

### Gates
- [x] **G2.1** `npm run e2e` passes locally with the real backend: all tests pass except the tests of open Known bugs, which fail red with their cause named.
  Met 2026-10-07, twice: 85 passed, and the 5 bug-7 Director setups failed red (6.1 min in the checkout, 6.3 min in the fresh clone).
- **G2.2** removed 2026-10-06 by user decision: repeated runs are not required.
- [x] **G2.3** The coverage guard (or the generated matrix) contains every id in `TOURS`, `STUDY_CONDITIONS` and `InteractionMode`. Show this by temporarily adding a dummy tour id and confirming that a test fails, then reverting.
  Met 2026-10-07 (G3.4 row); re-checked in the audit: a dummy member in the `InteractionMode` union failed `INTERACTION_MODES vs the InteractionMode union`. Reverted.
- [x] **G2.4** Mutation check: break three things one at a time and confirm the suite fails with a message that names the setup. The three are: hide one mode-specific panel, break the Start handler for one door, and point the WebSocket URL to a wrong path. Revert each change.
  Met 2026-10-07; re-checked in the audit: `build · co-learning · guided-demo · default layout: panel "co-learning-reflection" must show in co-learning`; `build · recommendation · guided-demo · default layout: Start created no session — no POST /session within 60 s`; `…: WebSocket status`. All reverted.
- [x] **G2.5** No test locates an element by visible text. Show this with `grep -rnE "getByText|hasText|text=" frontend/e2e`, which returns nothing, or only justified exceptions with a comment.
  Met 2026-10-07: the grep returns nothing.
- [x] **G2.6** The only `frontend/src/` changes are `data-testid` attributes, plus any switches recorded in the Decisions log.
  Met 2026-10-07 with recorded exceptions: the icon fix, the bug-2 fix (9ae2129) and the comment-only `KNOWN BUG` markers (Decisions log). Checked with `git diff origin/explore_db...HEAD -- frontend/src`.
- [x] **G2.7** All existing CI checks are green.
  Met 2026-10-07 (see G4.5).
- [ ] **G2.8** The PR description records how long `npm run e2e` and `npm run e2e:fast` take on the developer's machine.
  **Open:** there is no PR for this branch yet. The times are in the Decisions log and `e2e-testing.md` (2026-10-07: 6.3 min and 2.0 min), ready for the PR description.

---

## Stage 3: documentation and verification

**Goal:** the suite is documented well enough that a person, or an agent with no context, can run, read and extend it. Everything claimed in stages 1 and 2 is re-verified from scratch.

### Tasks
1. Write `docs/reference/e2e-testing.md`, covering:
   - what the suite covers (the matrix, in a table)
   - how to run all, fast, one file, one test (`-g`), headed and UI mode
   - how to read a failure (`npm run e2e:report`, `npx playwright show-trace <trace.zip>`, and the `error-context` files in `test-results/` for agents that can't open a GUI)
   - the folder layout, page objects and fixtures
   - the `data-testid` naming rule
   - the `@slow` tag
   - how to add a test for a new tour, condition, layout or panel
   - known limits (Chromium only, real backend required, no visual regression)
2. Link that page from `docs/README.md`, `CONTRIBUTING.md` (add "E2E suite passes" to §4 Definition of done), `docs/start-contributing.md` §5, `AGENTS.md` (Commands, and one line under "How to work here") and `frontend/AGENTS.md`.
3. Make sure every doc that lists the CI checks either says that E2E runs locally only, or is updated if CI is added later.

### Gates
- [x] **G3.1** A clean-room run, in a fresh clone in the dev container, following only `docs/start-contributing.md` and `docs/reference/e2e-testing.md`: setup and `npm run e2e` pass. Record any step that needed knowledge not in the docs, and fix the docs.
- [x] **G3.2** Every command in `e2e-testing.md` was run and works as written.
  Re-checked 2026-10-07 after the doc changes: `npm run e2e`, `npm run e2e:fast`, one file, `-g`, `e2e:headed`, `--list`, `E2E_SKIP_BUILD=1` and `E2E_BASE_URL` work. `e2e:ui`, `e2e:report` and `show-trace` open a GUI and were not re-run.
- [x] **G3.3** Every relative link in the changed docs resolves. Check them with a script or by hand, and list the result.
  Re-checked 2026-10-07 with a script over the plan, `e2e-testing.md`, both skills, `AGENTS.md`, `frontend/AGENTS.md`, `CONTRIBUTING.md`, `start-contributing.md`, `docs/README.md` and the PR template: 183 links, none broken (anchors included).
- [x] **G3.4** Re-run gates G1.1–G1.7, G2.1 and G2.3–G2.7, and record the results.
- [x] **G3.5** A fresh agent session, given only "add an E2E test for tour X following the docs" (use an existing tour and delete its test first), produces a passing test without further help.
  Passed 2026-10-07: `colearning-walkthrough-survey` was filtered out of `INTRO_TOUR_CASES`. The fresh agent found the generated matrix from `e2e-testing.md`, removed the filter instead of writing a one-off spec, ran `-g` (1 passed) and `npm run e2e:fast` (76 passed, coverage guard green). Its three doc gaps were fixed in `e2e-testing.md`: how to handle a broken setup, what the tour check covers, and the expected failure in the counts.

---

## Stage 4: make it easy for the next developer and their agent

**Goal:** a developer who adds a feature, or breaks a test, gets agent support that writes the right test or diagnoses the failure. They should not need to learn the suite first.

### Tasks
1. Create the skill `.agents/skills/e2e-tests/SKILL.md`, in the same format as `create-widget`: YAML front matter with `name` and a `description` that triggers on writing, adding, fixing or debugging E2E/Playwright tests and on "a test broke after my change". It has two workflows:
   - **Add a test for new code.**
     1. Find which setups and panels the change touches.
     2. Add `data-testid`s by the naming rule.
     3. Extend the matrix or page objects rather than writing one-off tests.
     4. Run the narrowest command first (`-g`), then `npm run e2e:fast`.
   - **Fix a failing test.**
     1. Run the failing test alone.
     2. Read the `error-context` file and the trace.
     3. Decide whether the app regressed or the test is outdated, and justify the decision against `panel-mode-matrix.md` and the interaction-modes brief.
     4. Fix the app if it regressed. Update the test only if the behaviour change is intended, and say so in the PR.
     5. Never weaken an assertion, add a blind wait (`waitForTimeout`) or add retries to make a test pass.
2. Extend `create-widget/SKILL.md` with a final step: "add or extend the E2E test for the panel's mode visibility" (link the new skill).
3. Add the skill to the tool table in `docs/start-contributing.md` (§2), and mention it in `AGENTS.md` under **Skills**.
4. Optional, decide and record in the Decisions log: a `.claude/agents/` subagent definition for Claude Code users, if the skill alone isn't enough. It must only point to the skill, so the logic lives in one place.

### Gates
- [~] **G4.1** In a fresh agent session, the prompt "I added a new panel, add the E2E coverage for it" loads the `e2e-tests` skill without being told to. Check this in Claude Code, plus one other tool from the table in `docs/start-contributing.md`.
  Claude Code passed 2026-10-07: a fresh agent asked how to cover a new Co-Learning-only panel loaded the skill (workflow A) unprompted and gave correct steps. The fresh agents in G4.2 and G4.3 also loaded it unprompted. **Open:** the second tool was not checked, because it runs on the maintainer's own account.
- [x] **G4.2** Fix workflow, regression case: break a panel's mode visibility on a scratch branch. An agent given only "the E2E suite fails, fix it" restores the app code rather than editing the test.
  Passed 2026-10-07 (with the skill before workflow B gained its first step, "check Known bugs first"; not re-run since): the `co-learning-reflection` gate was changed to `interactionMode() !== 'director'` and committed as a "refactor". The agent loaded the skill, saw 18 Recommendation failures, judged them against `panel-mode-matrix.md`, and restored the `panelAvailable` gate without touching the tests. The net diff against the start was empty, and the full suite was green.
- [x] **G4.3** Fix workflow, intended-change case: on a scratch branch, make an intended, documented behaviour change. The agent updates the test and states why in its summary.
  Passed 2026-10-07 (with the skill before workflow B gained its first step; not re-run since): `ai-activity` was taken out of the Director default layout, with the matching `panel-mode-matrix.md` note. The agent loaded the skill, recognised the documented intent, removed `ai-activity` from `SYSTEM_LAYOUT_SLOTS` (with no app change and no weakened assertion), cited the matrix row, and got the full suite green.
- [x] **G4.4** `create-widget` now ends with the E2E step, and the link to the new skill resolves.
  Passed 2026-10-07: Step 9 "E2E coverage" links `../e2e-tests/SKILL.md`, which resolves (link check over every changed file).
- [x] **G4.5** All existing CI checks are green, and `npm run e2e` passes (all tests except the tests of open Known bugs, which fail red with their cause named).
  Passed 2026-10-07: `lint:styles`, `i18n:check` and the production build green; `npm run e2e` 90 passed in 2.3 min (one run). Backend untouched, so no `pytest`.
  Re-checked 2026-10-07 after the known-bug rule: `lint:styles`, `i18n:check` and the production build green; `pytest -q` 523 passed (27 min; the backend got comment-only `KNOWN BUG` markers); `npm run e2e` 85 passed and the 5 bug-7 setups failed red.

---

## Out of scope

- Running the E2E suite in GitHub Actions (follow-up ticket; keep the config CI-ready with `process.env.CI`)
- Firefox/WebKit projects, real devices, visual regression (screenshot comparison)
- Faking the backend or WebSocket (all tests here use the real backend)
- Moving the Karma unit specs into CI

## Known bugs

App bugs the suite has found. A test of an open bug **fails red** until the bug
is fixed: it is not marked `test.fail()`, skipped or filtered (user decision
2026-10-07). Each open bug lists the file:line where its fix belongs; a
comment-only `KNOWN BUG <n>` marks that place in the app code, and another one
in the failing test points to it. Once the bug is fixed, its tests turn green:
remove both comments and move the entry to "Fixed". A test that fails because
of the backend ends with a
second error, `Backend errors during this test (the likely cause of the failure):`,
listing each failed request as `backend <status> on <METHOD> <path>: <backend
error>` (`e2e/support/fixtures.ts`); the worker backend's output for that test is
attached as `backend.log`.

### Open

| # | Symptom | Test that shows it | How to recognise it in a failure | Fix location |
| --- | --- | --- | --- | --- |
| 5 | Start pressed before `GET /session/scenario-presets` has answered: a tour or experiment on a preset network silently does not start on it. The preset list is still empty, so the preset id is looked up as a saved scene, `store.error` is set, and the selection falls back to the guided demo. A user rarely clicks that fast. | **None, on purpose.** `WelcomePage.goto()` (`frontend/e2e/support/pages.ts`) waits for the presets before any click, because that is the normal user path; deep links (`…/start`) wait for the presets themselves. A test that clicked before the presets arrive would test this race and not the flows, and would depend on timing. | Only if that wait is removed: preset tours and experiments do not run on their preset network, so the start, panel or mode checks fail with no backend error. | `frontend/src/app/app.component.ts:1311`, `resolveWelcomeSessionOpts()` (comment at :1306): wait for the presets there, or keep Start disabled until they are loaded. |
| 7 | The Director plans nothing on the larger networks: `director_plan` raises (`ValueError: 52 trains exceeds MAX_TRAINS=16` on the four Olten presets, `721 nodes exceeds MAX_NODES=224` on `ecml2026-scene1-level0`), `GoalDirectedPolicy._plan` swallows it, and the model-free fallback `plan_all_lines` returns None, so the plan source is `unroutable` and there is no player: every train holds for the whole run. Measured through the API, 40 steps on `olten` under `goal_directed`: no train departed (`deadlock_avoidance`: 2 done, 1 moving); on the ECML scene all 6 stay `READY_TO_DEPART`. `/director/strategies` then answers "No committed plan yet — step under 'goal_directed' first". `director-mode.md` §7 (invariant 9) promises a fallback where only a train the planner could not route holds. | `e2e/build.spec.ts` › `build · director · {olten, olten-dense, olten-disrupted, olten-partially-closed, ecml2026-scene1-level0} · default layout`. They fail red (pointer comment at the top of `build.spec.ts` and at the check in `WorkingScreen.expectDirectorPlan`, `e2e/support/pages.ts`). | Usually `…: the Director's plan source; "unroutable" means the planner found no plan and every train holds (known bug 7, …)` with `Expected: not "unroutable"`, after 2–60 s, and no backend error (the exception is swallowed, not logged). Sometimes, when play started during the opening auto-advance (bug 8), instead `…: the Director commits a plan after start (GET /session/<id>/director has none after 150 s; on the Olten and ECML networks this is known bug 7 with bug 8, …)`: seen 2026-10-07 on `ecml2026-scene1-level0` in a fresh-clone run (2.6 min). Its backend log shows the auto-advance running its full 300 steps under `deadlock_avoidance` while the play loop ran under `goal_directed` from step 3 with `act_many=0.0ms` (no player, so no train driven by the Director). Why `/director` then reports no plan at all was not traced. | `backend/app/policies/goal_directed_policy.py:644`, `GoalDirectedPolicy._plan()` (comment at :638): the `except Exception: pass` above it and the all-or-nothing `plan_all_lines` fallback. |
| 8 | The opening auto-advance (`SessionStore._autoAdvanceToOpeningState`) is not one stable state. Every WebSocket `state` message sets `store.loading` to false, so "Loading…" (`status-loading`) disappears between its steps; and its steps keep the policy from its start, so after a switch to Director the rest of the opening runs under the previous policy, and it keeps stepping after play has started. Seen in a trace of `build · director · guided-demo`: `POST /policy` (`goal_directed`) at 45.138 s, then `POST /step` at 45.211, 45.294 and 45.371 s answered in 17–31 ms without planning, with `POST /play` (45.305 s) in between, so the play loop and the auto-advance ran at once. | No test fails on bug 8 alone. The "Runs" check (`WorkingScreen.playAndExpectSteps`, `e2e/support/pages.ts`) no longer trusts "Loading…" or the counter alone: it needs the backend's play loop running and a counter rise beyond every step the page itself requested (Decisions log, 2026-10-07). In two full runs on 2026-10-07 no setup failed on that check. Bug 8 does take part in bug 7's second failure mode (row 7). | Before that check: a setup whose counter rose although play did nothing, or a Director test that passed in about 2 s. With it: `…: the play loop must step the session — …` would name a run where only the auto-advance stepped. | `frontend/src/app/core/session.store.ts:1352` (the WebSocket handler's `loading.set(false)`, comment at :1348) and `:1546` (the policy read once in `_autoAdvanceToOpeningState()`, comment at :1543). |

### Fixed

| # | Symptom | Fix |
| --- | --- | --- |
| 1 | Concurrent sessions shared Flatland's default `GlobalObsForRailEnv()` instance; stepping an older session gave HTTP 500 `IndexError` on `POST /session/<id>/step`. | `fix(backend): give every env its own observation builder`; `e2e/concurrent-sessions.spec.ts` now passes unmarked. |
| 2 | The Widget Gallery seeds `SessionStore` with its fixture session `gallery-fixture-session` (`core/gallery-fixture.service.ts`); the store's geography effect then asked the real backend for it and got 404, logged as a console error. Expanding gallery rows sent 13 more such requests (notifications, impact, contentions, plan, scenarios, recommendations, proposals, scenario-policies and four Director endpoints). | `fix(frontend): send no backend requests for the gallery's fixture session` (9ae2129): `galleryFixtureInterceptor` (`core/gallery-fixture.interceptor.ts`) answers every request for the fixture session in the browser with the backend's own 404, so callers keep their no-session path. `e2e/hash-screens.spec.ts` › `#/widgets loads cleanly` now passes unmarked. |
| 3 | Intermittent HTTP 500 on `GET /session/<id>/hmi/contention-strategies` (`AssertionError` on `agent.current_configuration is not None`) and "Contentions forecast failed": a forecast thread forked the live env in the middle of a step on the event loop. | `fix(backend): never snapshot a live env in the middle of a step` (`app/core/env_lock.py`). |
| 4 | A deleted session's forecasts (140–200 s each on Olten) and its play loop kept running and starved later tests. | `fix(backend): stop a deleted session's play loop and forecasts` (`app/core/cancellation.py`). |
| 6 | The Director's first plan ran inside `GoalDirectedPolicy.reset`, which `POST /session/<id>/step` and the play loop called on the server's event loop: while it planned (about 25 s on `pf-ch-corridor`), that backend answered no other request (`GET /health` took 23.4 s during a 25.4 s first Director step). | `fix(backend): run the Director's first plan off the event loop` (0cbe209): `registry.ensure_first_plan` runs it on a worker thread, on a copy of the env taken under `env_lock`; a deleted session's plan is discarded. Test: `backend/tests/test_director_first_plan_off_loop.py`. |

## Decisions log

Record every decision this plan leaves open, with the date and reason:
- the exact Playwright version
- how the matrix reads app data
- any test-only switch
- the Stage 4 subagent

| Date | Decision | Why |
| --- | --- | --- |
| 2026-10-06 | `@playwright/test` pinned to exactly `1.63.0`. | The latest release on that day. An exact pin keeps the downloaded Chromium build the same on every machine. |
| 2026-10-06 | The backend `webServer` runs `<python> -m uvicorn app.main:app --port 8000` from `backend/`, where `<python>` is `backend/.venv/bin/python` (or `.venv/Scripts/python.exe` on Windows) if it exists, else `python3` from `PATH`. | The same interpreter `setup-dev.sh` installs into: `backend/.venv` by default, an active virtualenv or the system Python with `SETUP_NO_VENV=1` (dev container, Copilot sandbox). `-m uvicorn` avoids depending on a `uvicorn` script on `PATH`. |
| 2026-10-06 | No `--reload` on the backend `webServer`, and a 180 s start timeout for both servers. | The suite doesn't edit backend code, and the first `ng serve` compile plus the Flatland import can take over a minute on a cold machine. |
| 2026-10-06 | The smoke test finds the Start button with `sbb-button.welcome-start` (an existing class), not `getByRole('button')`. | Lyne sets the button role through `ElementInternals`, which Playwright's role engine does not see, so `getByRole` finds nothing. Stage 2 replaces the class with a `data-testid`. |
| 2026-10-06 | Allowed exception to G1.6: one app-code line, the Scenario Gallery menu icon in `features/config-shell/config-shell.component.ts`, changed from `map-small` to `globe-small`. | `map-small` does not exist in the SBB icon set, so every start screen logged a 403 console error from `icons.app.sbb.ch` (introduced in b2f60b7). The smoke test caught it; fixing the icon was chosen over excusing the error in the test. |
| 2026-10-06 | `setup-dev.sh` passes `--with-deps` only when `uname -s` is `Linux`. | The plan asks for system libraries on Linux (dev container, Copilot sandbox). On macOS and Windows Playwright needs none. |
| 2026-10-06 | The matrix imports the app's data modules directly (`e2e/support/app-data.ts`): `TOURS`, `STUDY_CONDITIONS`, `LAYOUT_PRESETS`, `PANEL_MODE_AVAILABILITY` and `INTERACTION_MODES`. No extraction refactor was needed. `e2e/support/matrix.ts` builds every case list from them. | These files import only types from Angular-side code, which the TypeScript transform drops, so Playwright loads them without Angular. A new tour, condition, layout or mode gets tests without editing the suite. |
| 2026-10-06 | Coverage guard (`e2e/coverage.spec.ts`): checks the case lists against `TOURS`, `STUDY_CONDITIONS`, `LAYOUT_PRESETS` and the backend presets. It also parses the `InteractionMode` union from `event-types.ts` and compares it with `INTERACTION_MODES`. | A type has no runtime value. Parsing the declaration catches a mode added to the union but not to the mode tabs. |
| 2026-10-06 | Backend scenario presets come from `app.core.scenario_presets.list_presets()`, the function behind `GET /session/scenario-presets`. It runs once per run through the backend interpreter, and the result is cached in the environment variable `E2E_SCENARIO_PRESETS`. | Playwright loads test files before it starts the servers, so the list cannot come over HTTP. The worker processes inherit the variable, so Python runs once. |
| 2026-10-06 | Build door: the start screen has no mode picker (the "Facts" section above is stale on this). A Build-door test starts the session and then clicks the mode tab (`mode-tab-<id>`). A session always starts in Recommendation. | This is the only way a user picks a mode in that door. |
| 2026-10-06 | Each `LAYOUT_PRESETS` entry runs in its intended mode: the mode of the study condition or tour that uses it, or else the first mode that offers every mode-restricted panel it places. | Presets bypass `panel-mode-availability` (the documented "Known gap" in `layout-presets.ts`), so a co-learning preset in Recommendation would show excluded panels by design, not because of a regression. |
| 2026-10-06 | Panel check (`e2e/support/panel-expectations.ts`): every type in `PANEL_MODE_AVAILABILITY` that the mode excludes must have no element (`panel-<type>`). Must be visible: for a preset, its mode-restricted panels plus the Director bar; for the default layout, a hand-kept list of its mode-restricted slots. `strategy-reflection`, `co-learning-effect` and `shift-review` are only checked for absence. | The default layout is markup, not data, so its slot list is the one hand-kept piece. Those three render an empty host until a strategy is committed or the shift ends, so being visible right after the start is not part of their contract. |
| 2026-10-06 | No test-only switches. The default tempo (level 2, one step every 2 s) moves the step counter within seconds, and tests assert only on states. | Plan §2.4: look for an existing setting first. None was needed. |
| 2026-10-06 | Timeouts: 90 s per test, and `@slow` tests call `test.slow()` (×3). `POST /session` must answer within 60 s. The session must settle (auto-advance) within 90 s. The step counter must rise within 30 s, or 150 s in Director. The WebSocket must connect within 30 s. `retries: 0`. No `waitForTimeout`. | A cold corridor load takes about 30 s, and Director plans for about a minute before its first step. Every wait is on a state, never on a fixed delay. |
| 2026-10-06 | `@slow` means the setup opens in Director: the 11 Build-door Director cases, the Director preset layout and the two Director tours, 14 tests in all. `npm run e2e:fast` runs `--grep-invert @slow`. | Director planning is the only thing that pushes a test past about 30 s. |
| 2026-10-06 | `workers: 1` by default (`E2E_WORKERS=<n>` overrides), with `fullyParallel: true`. | Parallel runs hit a backend bug (see the next row), and all workers share one backend process anyway: with 4 workers, single steps timed out behind other sessions' Director planning. Once the bug is fixed, raising the default is a one-line change. |
| 2026-10-06 | Known bugs, kept as `test.fail()` with a `// KNOWN BUG` comment and not fixed here: (1) concurrent sessions share Flatland's default `GlobalObsForRailEnv()` instance, so stepping an older session returns HTTP 500 `IndexError` (`e2e/concurrent-sessions.spec.ts`); (2) `#/widgets` requests `/session/gallery-fixture-session/hmi/geography` and gets a 404 console error (`e2e/hash-screens.spec.ts`). Seen once and not marked, because it is intermittent: (3) `GET /session/<id>/hmi/contention-strategies` returned HTTP 500 (`AssertionError: agent.current_configuration is not None` in `TrajectoryBranchRunner.run_branch`, `contention_strategies.py:170`) while the session was playing (`build · layout preset-recommendation-study3`). `Contentions forecast failed: AssertionError()` showed the same cause on another endpoint. | Plan rule: don't change app behaviour to make a test pass, and don't weaken the test. |
| 2026-10-06 | `WelcomePage.goto()` waits for `GET /session/scenario-presets` before the test clicks. | If Start is pressed before that list arrives, a tour or experiment on a preset network silently does not start: the network falls back to the guided demo and `store.error` is set. A user rarely clicks that fast. This is reported as an app finding, not hidden. Deep links wait for the list themselves. |
| 2026-10-06 | Stability gate G2.2 (`--repeat-each=3`) dropped by the user. A single passing run is the bar; flaky tests are fixed when they show up. `retries` stays 0. | User decision. |
| 2026-10-06 | Each test pauses and deletes the sessions it created (`page` fixture in `e2e/support/fixtures.ts`; `try/finally` in `concurrent-sessions.spec.ts`). | Playback runs on the server and outlives the page. In the aborted `--repeat-each=3` run, dozens of earlier sessions were still playing, and one step counter then stayed at 0 for 30 s (`olten-partially-closed`). |
| 2026-10-06 | Open finding, not hidden by longer timeouts: the backend keeps computing scenarios and recommendations for a session after it is paused and deleted. A 52-train Olten session costs 140–200 s per job. On the final full run (after cleanup was added) this starved `build · director · guided-demo · default layout`: the session never settled within 90 s. 89 passed and 1 failed. The earlier cold run passed (90/90, 2 as expected failures). | Should be fixed in the backend: cancel a session's background jobs on `DELETE /session/<id>`. |
| 2026-10-06 | Measured on the developer's machine (Apple Silicon, servers started by Playwright from cold): `npm run e2e` 538 s (90 tests), `npm run e2e:fast` 272 s (76 tests). | G2.8. |
| 2026-10-06 | Bugs 1, 3 and 4 fixed in the backend, each in its own `fix(backend)` commit with its backend test (see [Known bugs](#known-bugs)). `test.fail()` removed from `concurrent-sessions.spec.ts`. Bug 3's cause was confirmed before the fix: with a thread stepping a live env, 12 of 2226 forks failed with that assertion; with the lock, none. | User decision: fix at the root, one commit per bug. |
| 2026-10-06 | Replaced the shared `webServer` (:8000 + :4200) with one backend per worker. `globalSetup` (`e2e/support/global-setup.ts`) runs `ng build --configuration development --output-path dist/e2e` once (5 s with Angular's cache), and the worker fixture `backend` (`e2e/support/backend.ts`) starts `uvicorn app.main:app` on `127.0.0.1:<8100 + parallelIndex>` with `FRONTEND_DIST` pointing at that build. The `baseURL` fixture points the page and `request` at it. `E2E_SKIP_BUILD=1` reuses the last build; `E2E_BASE_URL=<url>` runs against an app that already runs (no build, no backends), which replaces the old "reuse running servers" (G1.2). | Leftover work from one test can no longer slow another worker's tests, and each backend's log belongs to one worker, so a failure can quote it. The app picks its backend from the page's own origin on any port other than 4200 (`core/backend-origin.ts`), so no app change was needed for that. |
| 2026-10-06 | Test-only switch: the backend setting `FRONTEND_DIST` (env var, `app/config.py`) sets the folder `app/main.py` serves the built frontend from. Empty by default, which keeps `backend/static` (start-demo.sh, Dockerfile). | Writing the E2E build into `backend/static` would overwrite a demo build, and with `backend/static` present `tests/test_smoke.py::test_root` fails (`/` serves the app instead of the JSON). |
| 2026-10-06 | Backend restarted per worker, not per spec file. `E2E_RESTART_PER_FILE=1` switches the per-file restart on. | Measured with 4 workers: a restart itself takes under 1 s, but the restarted backend plans the Director from cold. Per file: 240 s and 1 failure (`build · director · pf-ch-corridor`: no step within 150 s); per worker: 175 s, all green. Bug 4's fix already stops a deleted session's work, which was the reason to isolate. |
| 2026-10-06 | Default `workers: 4` (`E2E_WORKERS=<n>` overrides), and the `@slow` (Director) tests in their own project `chromium-director` with `workers: 1`, so they run one at a time next to the other workers. Measured on the developer's machine (Apple Silicon, 8 cores, 16 GB): peak RSS of one backend process 1.1–1.85 GB, of all backends together 3.0 GB, of Chromium 2.1–2.3 GB. 6 workers, Director unrestricted: 400 s, 5 Director tests failed. 4 workers, Director unrestricted: one run 175 s green, the next 250 s with both `pf-ch-corridor` Director tests failing (no step within 150 s, no backend error) because they planned at the same time. 4 workers with the Director project: 286 s, 90/90. | CPU, not RAM, is the limit: each Director strategy request forks 3 planner processes, and two 16-train corridor plans at once starve each other past the 150 s step window. Serialising only the Director tests keeps that window honest without longer timeouts. The old "workers: 1" row is superseded. |
| 2026-10-06 | Failures name their backend cause (`e2e/support/fixtures.ts`): the `page` fixture records every 5xx response and 4xx on `/session`, `/policies` and `/operator`, with FastAPI's `detail`. The auto fixture `backendCheck` then, only when a test failed unexpectedly, attaches the worker backend's output for that test (`backend.log`) and the failed responses (`failed-responses.json`), and adds an error that lists them. A bare 500 ("Internal Server Error") is paired in order with the Python tracebacks in the log. Recording stops when the test body ends, because the page keeps polling while cleanup deletes its sessions. The guard's failed-request lines also carry the backend `detail`. | Plan §2.3 point 5 and the user's request: a failure must name the request, status and backend error, not just the timeout it caused. Checked by injecting two errors: a 500 on `/session/scenario-presets` (message: `backend 500 on GET /session/scenario-presets: RuntimeError: injected …`) and bug 1 again (`backend logged: IndexError: list index out of range`). For `request`-only tests the request and status come from the test's own assertion; the backend exception comes from the log. |
| 2026-10-06 | Measured after the per-worker backends (G2.8; same machine, build included, nothing running beforehand): `npm run e2e` 286 s (90 tests), `npm run e2e:fast` 91 s (76 tests). | G2.8; supersedes the 538 s / 272 s row. |
| 2026-10-06 | Bug 6 fixed in the backend (0cbe209), consistent with bugs 3 and 4: the first plan searches on a copy taken under `env_lock` (the lock is never held while planning, so a step of the same session on the event loop does not wait 25 s), a per-env plan lock makes `/step`, the play loop and the weights endpoint plan an env once, and a session deleted while it plans has its plan discarded. The search itself is not interrupted (it has no cancellation check), so a deleted session's first plan still finishes on its thread. Other policies are still built on the event loop, as before. | User decision: fix at the root, one commit per bug. The backend test fails without the fix (`GET /health` and `DELETE` blocked until the held plan was released). |
| 2026-10-06 | `chromium-director` raised from `workers: 1` to `workers: 2`; not merged into `chromium`. Measured (same machine, 4 workers, build included): Director project with 1 worker 210 s, 90/90; Director tests sharing all 4 workers 186 s, 1 failure (`build · director · pf-ch-corridor`: session never settled within 90 s, no backend error; `pf-ch-corridor-stops` was planning on another worker at the same time); Director project with 2 workers 184 s and 184 s, 90/90 both runs. `npm run e2e:fast` 63 s (76 tests). | Bug 6 only blocked a worker's own backend, so it was not what serialised the Director tests: CPU is. With 2 workers both corridor Director tests can still plan at once; in one green run they took 60 s and 66 s against the 90 s settle window. If they fail with no backend error, go back to `workers: 1`. |
| 2026-10-07 | Stage 3: `docs/reference/e2e-testing.md` is the one page for running, reading and extending the suite. "E2E suite passes" is in `CONTRIBUTING.md` §4 and the PR template, both marked local only, because CI still doesn't run it. | Plan Stage 3 tasks 1–3. Every doc that lists the CI checks now says the E2E suite is local only. |
| 2026-10-07 | `backend.log` and `failed-responses.json` are written as files to the failed test's `test-results/<test folder>/` and attached by path; the error names the log's path. | Found in G3.1: as inline attachments, the terminal showed a ~300-character preview and the HTML report embedded them in `index.html`, so an agent without a GUI could not read the backend log. Checked by injecting a 500 on `GET /session/scenario-presets`: both files there, error `backend 500 on GET /session/scenario-presets: RuntimeError: injected e2e check`. |
| 2026-10-07 | In a dev container or Codespace, run `E2E_WORKERS=2 npm run e2e` (documented in `start-contributing.md` and `e2e-testing.md`). The default stays 4. | Measured in the dev container on Docker Desktop (Apple Silicon host, 8 vCPUs, 7.65 GB for the container): 4 workers 90/90 in 5.4 min with memory peaking at 7.1 GB; 2 workers 90/90 in 5.4 min, peak 5.3 GB. An earlier 4-worker run with a backend `pytest` busy on the host lost `build · director · pf-ch-corridor` (never settled within 90 s, no backend error): the CPU contention described above. |
| 2026-10-07 | Open, for the user: the default of 4 workers no longer saves time on the 8-core Mac. Same machine, same day, host idle: `npm run e2e` 3.7 min, `E2E_WORKERS=1 npm run e2e` 3.8 min, `npm run e2e:fast` 79 s. | The Director tests set the pace (the corridor ones take 1–1.5 min each). A lower default would cut memory and the CPU contention behind the corridor failures, at almost no cost in time. Not changed here: the default is a user decision. |
| 2026-10-07 | Stage 3 re-verification (G3.4), all on 2026-10-07. G1.1: fresh clone from GitHub, `scripts/setup-dev.sh`, `npm run e2e` with nothing running: 90/90, 3.8 min (backend `pytest` running alongside). G1.2: backend on :8000 and `npm run start` on :4200, then `E2E_BASE_URL=http://localhost:4200 E2E_WORKERS=1 npm run e2e`: 90/90, 5.7 min. G1.3: `SETUP_NO_PLAYWRIGHT=1 scripts/setup-dev.sh` printed "skipping the Playwright browser" (35 s). G1.4 and G3.1: dev container, 90/90 (see the row above). G1.5: `git status` clean after a run. G1.6/G2.6: the only `frontend/src/` change besides `data-testid` is the recorded icon fix. G1.7/G2.7: lint, i18n check and production build green, `pytest -q` 523 passed (30 min, slowed by the E2E runs alongside). G2.1: 90/90, 3.7 min. G2.3: a dummy tour appended to `TOURS` got its own test (`tour e2e-dummy-tour · scripted`) with no suite change; a dummy member added only to the `InteractionMode` union failed the coverage guard (`INTERACTION_MODES vs the InteractionMode union`). G2.4: hiding `co-learning-reflection` failed with `build · co-learning · guided-demo · default layout: panel "co-learning-reflection" must show in co-learning`; a dead Build-door Start failed with `…: Start created no session — no POST /session within 60 s`; a wrong WebSocket path failed with `…: WebSocket status`. G2.5: the grep returns nothing. All breakages reverted. | Plan Stage 3, G3.4. No new app bugs found. |
| 2026-10-07 | The default stays at 4 workers (`E2E_WORKERS=<n>` overrides). Closes the "Open, for the user" row on the worker default. | User decision. |
| 2026-10-07 | Stage 4: the skill `.agents/skills/e2e-tests/SKILL.md` holds only the order of work (add a test; fix a failing test; done; when to stop and ask) and links to `e2e-testing.md` for every detail. It asks for no repeated runs. | One source for the how-to: the skill can't drift from the reference page. Repeated runs were dropped with G2.2. |
| 2026-10-07 | No `.claude/agents/` subagent for E2E work. | Claude Code finds the skill through the `.claude/skills` symlink and lists it by its description in a fresh session, which is what G4.1 checks. A subagent would only point to the skill, and it would hide the test output and `test-results/` files from the main session that has to judge regression vs intended change. Revisit only if G4.1 shows the skill does not load on its own. |
| 2026-10-07 | Director setups check the plan, not only the step counter: after start, `WorkingScreen.expectDirectorPlan` (`e2e/support/pages.ts`) polls `GET /session/<id>/director` until `plan` is set (within the old 150 s Director window), fails if its `source` is `unroutable`, and only then expects the counter to rise (30 s). Five Director Build-door setups are marked `test.fail()` for bug 7. | Investigated after a full run where every Director test took about 2 s. Measured with the Director project alone (`npx playwright test --project chromium-director`, every run starting fresh backends): two runs in a row with the old check gave, per test, 1.4–2.1 s for 9 of 14 and 6–60 s for the rest, and *which* tests were fast changed between runs (`pf-ch-corridor` 1.6 s, then 51.2 s). Planner instrumentation (a scratch `sitecustomize`, not committed) and traces showed two causes. (1) Bug 8: the test read the counter during the opening auto-advance, whose next step raised it while the Director was still planning (`random`: plan started, test over 76 ms later; that plan took 48 s). (2) Bug 7: on Olten and the ECML scene the plan was `unroutable` in 0.1 s and the counter rose with every train holding. Not a cache: the step-0 cache (`step0_cache.py`) missed on every lookup in these runs, bug 6's `ensure_first_plan` replanned each new env, the backends start fresh each run, and the checkpoints and torch were present (`source: search` on the other networks). With the new check, three runs: guided demo 15 s, random 20 s, corridor 37–60 s, the bug-7 five fail as expected in about 2 s. Once, `olten-partially-closed` instead saw no plan within 150 s (an expected failure either way); alone and in the next full Director run it failed in 2–5 s. |
| 2026-10-07 | **User decision, overrides the `test.fail()` convention:** "Don't mark them as expected failures. They are not; it's just not the job of this PR to fix them. You can mark where the fix is in the code, but make sure the tests fail as intended. This PR is only about setting up Playwright tests." So: no `test.fail()` for app bugs (the bug-7 mark and `DIRECTOR_UNROUTABLE` removed); tests of open known bugs fail red with their cause named, are not skipped or filtered; each open bug lists the file:line of its fix location; comment-only `KNOWN BUG <n>` markers sit at that place in the app code and in the failing test; no more app fixes in this PR (5, 7 and 8 stay open). Gates that say "`npm run e2e` passes" now mean: all tests pass except the tests of open Known bugs. Supersedes the `test.fail()` parts of the 2026-10-06 Known-bugs row and the 2026-10-07 Director-check row. | User decision. |
| 2026-10-07 | "Runs" (`WorkingScreen.playAndExpectSteps`) now proves a step of the play loop, not only a rising counter (bug 8): after the session settles and play is pressed, it waits for `GET /session/<id>/play_status` to report the play loop running, reads the server's step from `GET /session/<id>/state`, and then needs the counter to rise above that step plus every step the page itself asked for from then on (`POST /session/<id>/step`, counted from the requests still in flight at that moment and all later ones; each asks for `n_steps`). A step the page requested can only be counted too often, never missed, so the check can only be stricter than needed. No `waitForTimeout`, timeouts unchanged (30 s for the step, 150 s for a Director plan). | The user asked that "Runs" prove a step after play. "Loading…" clears between the opening auto-advance's steps, and the auto-advance keeps stepping after play, so reading the counter after play is not enough on its own. Checked by a play loop that never steps (backend mutation, reverted): all 13 Build-door and experiment setups tried, and all 11 tour runs, failed with `…: the play loop must step the session — …`. With the real backend, two full runs had no failure on this check: the hardening exposed no new bug. |
| 2026-10-07 | Audit of every gate after the user decision (results in the gates above). Corrected: the counts note and the "Known bug or regression?" and "Add a test" sections of `e2e-testing.md` (known bugs fail red); the run times (`npm run e2e` 3–4 → 6–6.5 min since the Director plan check, `e2e:fast` 1.5 → 2 min; the dev-container and one-worker times marked as measured before that check); the claim that the terminal previews `backend.log` (it prints the file paths); "written only when a test fails unexpectedly" (now: when it fails); the "Runs" description; "keep it green" in `AGENTS.md`, `CONTRIBUTING.md` §4 and the PR template; the `e2e-tests` skill (workflow B starts with Known bugs; a listed open bug outside the task is reported and left red); `create-widget` Step 9; bug 5's symptom (the preset id is looked up as a saved scene) and why no test exercises it. Recorded as allowed exceptions to G2.6: the bug-2 frontend fix (9ae2129, fixed in this PR like bugs 1, 3, 4 and 6) and the comment-only `KNOWN BUG` markers. | Plan: every gate verified against the tree, not the checkboxes. |
