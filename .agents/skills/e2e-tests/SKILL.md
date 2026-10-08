---
name: e2e-tests
description: Add, fix or debug the Playwright end-to-end (E2E) tests of the Flatland Dispatcher (frontend/e2e). Use when someone adds or changes a tour, study condition, layout preset, interaction mode, panel / widget, hash screen or start-screen / flow control and needs E2E coverage for it; when writing, extending, fixing or debugging E2E or Playwright tests; and when someone says "a test broke after my change", "the e2e suite fails", "npm run e2e is red" or "a Playwright test fails". Covers adding coverage through the generated setup matrix and page objects, and deciding whether a failure is an app regression or an outdated test.
---

# E2E tests

Two workflows: **A. add a test for new code**, **B. fix a failing test**.

The how-to lives in [`docs/reference/e2e-testing.md`](../../../docs/reference/e2e-testing.md).
This skill only says what to do in which order and links there for the
details. Read its [Rules for tests](../../../docs/reference/e2e-testing.md#rules-for-tests)
before you write or change a test.

All commands run in `frontend/`. Nothing needs to be running: the suite builds
the frontend and starts one backend per worker.

## Hard rules

- Find elements by `data-testid` only, through a page object in
  `e2e/support/pages.ts`. Import `test` and `expect` from `./support/fixtures`.
- Adding a `data-testid` is the only app change a test may need.
- Never weaken an assertion, add `waitForTimeout`, add retries or raise a
  timeout to get green.
- Never leave a setup out of the matrix (no `.filter()` in `matrix.ts`). A setup
  broken by a known app bug keeps its test and **fails red**: no `test.fail()`,
  no skip. The bug is listed in the plan's Known bugs with its fix location,
  and a `KNOWN BUG <n>` comment in the failing test points to the row ([details](../../../docs/reference/e2e-testing.md#add-a-test)).
- Don't run the suite repeatedly to "prove" stability. One passing run is the bar.

## A. Add a test for new code

1. **Find what the change touches.** Which setups (door, tour, condition,
   layout, mode, network) and which panels or screens. List the existing tests
   with `npx playwright test --list` and look for the setup names. Use the
   [Add a test](../../../docs/reference/e2e-testing.md#add-a-test) table: a new
   tour, study condition, layout preset or backend preset needs no suite change,
   because the matrix is generated from the app's data.
2. **Add `data-testid`s** to any new control or panel the flow touches, by the
   naming rule `<area>-<element>[-<id>]`
   ([Rules for tests](../../../docs/reference/e2e-testing.md#rules-for-tests)).
   A mode-restricted panel in the default layout also needs its type in
   `SYSTEM_LAYOUT_SLOTS` (`e2e/support/panel-expectations.ts`).
3. **Extend the matrix or a page object**, not a one-off spec:
   `e2e/support/matrix.ts` for new cases, `e2e/support/pages.ts` for new
   controls, `e2e/support/setup-check.ts` for a check every setup should make
   ([Folder layout](../../../docs/reference/e2e-testing.md#folder-layout)).
   A test that opens in Director gets the `@slow` tag.
4. **Run narrow, then wide:** `npx playwright test -g "<setup name>"`, then
   `npm run e2e:fast`. See [Done](#done).

## B. Fix a failing test

1. **Check the [Known bugs](../../../docs/plans/e2e-playwright.md#known-bugs)
   first.** If the failure is a listed open bug (it is one of the row's tests
   and matches its "How to recognise it") and your task is not to fix that bug,
   stop here: report that it is known bug `<n>` and leave the test red. Don't
   mark it, skip it or change it.
2. **Run it alone:** `npx playwright test -g "<setup name>"`. The setup name is
   the start of the failure message. If only test files changed since the last
   run, add `E2E_SKIP_BUILD=1`.
3. **Read, in this order**
   ([Read a failure](../../../docs/reference/e2e-testing.md#read-a-failure)):
   - the error message, which names the setup and what was wrong
   - the second error `Backend errors during this test …`, if there is one
   - `test-results/<test folder>/backend.log`, `failed-responses.json` and
     `error-context.md` (the page as text)
   - the trace (`npx playwright show-trace test-results/<test folder>/trace.zip`)
     only if those don't explain it
4. **Compare with Known bugs again**, now with what you read. A failure that
   matches a row's "How to recognise it" is that bug: handle it as in step 1.
   If your task is to fix it, the fix goes where the row says; then remove the
   `KNOWN BUG <n>` comment in the test and move the row to "Fixed".
5. **Rule out CPU contention.** A Director test that fails in a full run with
   **no** backend error is CPU contention, not a regression: rerun it alone or
   with `E2E_WORKERS=2`
   ([Known bug or regression?](../../../docs/reference/e2e-testing.md#known-bug-or-regression)).
6. **Decide: the app regressed, or the test is outdated.** Judge the behaviour
   the test saw against the spec, not against the test:
   [`panel-mode-matrix.md`](../../../docs/reference/panel-mode-matrix.md) for
   which panels each mode shows, and the
   [interaction-modes brief](../../../docs/reference/interaction-modes-brief.md)
   for what each mode must do. Check `git log` and the diff for whether the
   change was meant.
   - The spec still says what the test expects → **the app regressed.** Fix the
     app code and leave the test alone.
   - The behaviour changed on purpose, and the spec docs say so (or the task
     asked for it) → **the test is outdated.** Update the test, and say in your
     summary and the PR which intended change made it outdated, citing the doc.
   - Neither is clear → stop and ask (below).
7. Run it alone again, then finish as in [Done](#done).

## Done

1. The narrow run passes: `npx playwright test -g "<setup name>"`.
2. `npm run e2e:fast` passes (the same exception for open Known bugs).
3. `npm run e2e` passes before the PR: every test passes except the tests of
   open Known bugs, which fail red with their cause named. In a dev container
   or Codespace use `E2E_WORKERS=2 npm run e2e`.
4. The CI checks pass: `npm run lint:styles`, `npm run i18n:check`,
   `npx ng build --configuration production`, and `cd backend && pytest -q` if
   backend code changed.

## Stop and ask the human when

- The right behaviour is unclear: the docs don't settle whether the app or the
  test is right, or the docs contradict each other.
- The fix needs an app change outside your task.
- The only way to green seems to break a hard rule above.
