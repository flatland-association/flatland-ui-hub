# End-to-end tests with Playwright

Status: plan, 2026-10-06. Not started.

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

Checked in the code on 2026-10-06. Re-check before relying on them.

**Stack**
- Angular 22, standalone components and signals, in `frontend/`.
- SBB Lyne web components (`@sbb-esta/lyne-elements`) render in open shadow DOM. Playwright locators pierce open shadow DOM by default, so no special selectors are needed.
- Backend: FastAPI + Flatland in `backend/`, started with `uvicorn app.main:app --port 8000`.
- `npm run start` serves the frontend on `:4200` and proxies `/session`, `/policies`, `/health`, `/operator` and the `/ws` WebSocket to `:8000` (`frontend/proxy.conf.json`).
- `./start-demo.sh` builds the frontend and serves everything from `:8000`.

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
- Choose the interaction mode (`InteractionMode` in `core/events/event-types.ts`: `recommendation` | `co-learning` | `director`).

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
- Director planning can take about a minute (see the `corridor-director` tour description).

**Existing test hooks**
- No `data-testid` attributes exist yet.
- CI (`.github/workflows/ci.yml`) runs no frontend tests.

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
6. Update the setup guides:
   - The **Commands** block in `AGENTS.md` and the **Commands** block in `frontend/AGENTS.md`
   - `CONTRIBUTING.md` §2 and `docs/start-contributing.md` §1 (what setup now installs) and §5 (how to run the E2E suite)
   - The "Done. Next:" message in `setup-dev.sh`

### Gates
- [ ] **G1.1** A fresh clone, after `scripts/setup-dev.sh`, then `cd frontend && npm run e2e`, passes with both servers started by Playwright. Run it once with no servers running beforehand.
- [ ] **G1.2** With backend and frontend already running, `npm run e2e` reuses them and passes.
- [ ] **G1.3** `SETUP_NO_PLAYWRIGHT=1 scripts/setup-dev.sh` completes without downloading a browser.
- [ ] **G1.4** The dev container (`.devcontainer/devcontainer.json`, which runs `setup-dev.sh`) builds, and `npm run e2e` passes inside it.
- [ ] **G1.5** `git status` after a test run shows no untracked report or result folders.
- [ ] **G1.6** `git diff --stat` shows no changes under `frontend/src/`.
- [ ] **G1.7** All existing CI checks are green.

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
- [ ] **G2.1** `npm run e2e` passes locally with the real backend.
- [ ] **G2.2** `npx playwright test --repeat-each=3` passes. Zero flaky failures is the bar; retries are not allowed to hide them.
- [ ] **G2.3** The coverage guard (or the generated matrix) contains every id in `TOURS`, `STUDY_CONDITIONS` and `InteractionMode`. Show this by temporarily adding a dummy tour id and confirming that a test fails, then reverting.
- [ ] **G2.4** Mutation check: break three things one at a time and confirm the suite fails with a message that names the setup. The three are: hide one mode-specific panel, break the Start handler for one door, and point the WebSocket URL to a wrong path. Revert each change.
- [ ] **G2.5** No test locates an element by visible text. Show this with `grep -rnE "getByText|hasText|text=" frontend/e2e`, which returns nothing, or only justified exceptions with a comment.
- [ ] **G2.6** The only `frontend/src/` changes are `data-testid` attributes, plus any switches recorded in the Decisions log.
- [ ] **G2.7** All existing CI checks are green.
- [ ] **G2.8** The PR description records how long `npm run e2e` and `npm run e2e:fast` take on the developer's machine.

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
- [ ] **G3.1** A clean-room run, in a fresh clone in the dev container, following only `docs/start-contributing.md` and `docs/reference/e2e-testing.md`: setup and `npm run e2e` pass. Record any step that needed knowledge not in the docs, and fix the docs.
- [ ] **G3.2** Every command in `e2e-testing.md` was run and works as written.
- [ ] **G3.3** Every relative link in the changed docs resolves. Check them with a script or by hand, and list the result.
- [ ] **G3.4** Re-run gates G1.1–G1.7 and G2.1–G2.7, and record the results.
- [ ] **G3.5** A fresh agent session, given only "add an E2E test for tour X following the docs" (use an existing tour and delete its test first), produces a passing test without further help.

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
     5. Show G2.2-style stability with `--repeat-each=3`.
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
- [ ] **G4.1** In a fresh agent session, the prompt "I added a new panel, add the E2E coverage for it" loads the `e2e-tests` skill without being told to. Check this in Claude Code, plus one other tool from the table in `docs/start-contributing.md`.
- [ ] **G4.2** Fix workflow, regression case: break a panel's mode visibility on a scratch branch. An agent given only "the E2E suite fails, fix it" restores the app code rather than editing the test.
- [ ] **G4.3** Fix workflow, intended-change case: on a scratch branch, make an intended, documented behaviour change. The agent updates the test and states why in its summary.
- [ ] **G4.4** `create-widget` now ends with the E2E step, and the link to the new skill resolves.
- [ ] **G4.5** All existing CI checks are green, and `npm run e2e` passes.

---

## Out of scope

- Running the E2E suite in GitHub Actions (follow-up ticket; keep the config CI-ready with `process.env.CI`)
- Firefox/WebKit projects, real devices, visual regression (screenshot comparison)
- Faking the backend or WebSocket (all tests here use the real backend)
- Moving the Karma unit specs into CI

## Decisions log

Record every decision this plan leaves open, with the date and reason:
- the exact Playwright version
- how the matrix reads app data
- any test-only switch
- the Stage 4 subagent

| Date | Decision | Why |
| --- | --- | --- |
| | | |
