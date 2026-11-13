# Full-shift dispatcher: explain assessments without repeated click theatre

Date: 2026-11-08. Base: `0888764`.

## Problem and evidence

`Full shift -> Watch shift` launches the large Recommendation scenario, not
Director. In the recorded full-shift run, 35 accepted decisions comprise 32
keep-course assessments and three PP changes. Thirty keep assessments beat the
other offered scores; two tie. Different forecast windows can produce new
contention references for the same trains and station. These are reassessments,
not necessarily newly occurring disturbances.

Source: the committed [complete Recommendation export](../examples/dispatcher-agents/shift-v2/synthetic-verified/shift-complete-export.json),
SHA-256 `642fce3191f3b947a37f1e53237628d29e6cc9fd208b6748b5f3268c778a9f58`.
The counts describe that reference run, not every possible future run.

The overlay indefinitely targets the last accepted control and reveals each
new command's card. It makes keep-course assessments look like repeated A
clicks. Compact evidence is hidden behind Details, and comparing keep against
keep produces zero deltas without explaining why other options were rejected.

## Intended behaviour

- Keep the backend's scored choices, IDs, audit records, consent and mode
  semantics. Never force B/C for variety or invent savings.
- In the existing bubble show the assessment's named trains, location and
  concrete choice. For keep, explain whether other offered forecasts are worse,
  tied, unavailable or insufficient for comparison, using the immutable offer.
- Show a compact comparison to the best available alternative and the forecast
  step. Forecasts are labelled as forecasts, never measured causal benefits.
- Treat the latest accepted keep as monitoring the map, without a mouse or
  persistent highlight on A. Pending human approval retains its real target.
- For changes, target only a pending or transient acknowledged action. Keep
  the last-action history visible independently. Presentation age must not
  execute or poll domain commands, and must not restart on each state update.
- Reveal/scroll a control only for a genuinely pending command, at most once
  per command. Completed historical actions must not pull the viewport back.
- Preserve paused/offline/takeover/terminal semantics and neutral Co-Learning.
  No new widgets or panels, no model/planner/scenario changes.

## New files

| File | Purpose |
| --- | --- |
| This plan | Evidence, scope and verification |
| Evidence under `docs/examples/dispatcher-agents/shift-assessments/` | Actual production UI, full-shift export and build identity |

## Modified files

| File | Change |
| --- | --- |
| `frontend/src/app/core/dispatcher-activity.service.ts` and its tests | Separate historical action from active target; derive real offer comparison |
| `frontend/src/app/core/dispatcher-target.directive.ts` | Highlight only active interaction targets |
| `frontend/src/app/features/dispatcher-agent-monitor/dispatcher-agent-monitor.component.{ts,html,scss}` and tests | Compact contextual assessment and truthful map/cursor behaviour |
| `frontend/public/i18n/{en,de,fr}.json` | Localised assessment and forecast text; preserve existing click keys |
| `frontend/e2e/support/pages.ts` | Shared page-object assertions for maintain/change presentation |
| `frontend/e2e/dispatcher-shift.spec.ts` | Real full-shift coverage for keep and actual changes |
| `frontend/e2e/dispatcher.spec.ts` | Event-synchronised finite Director acknowledgement and retained history |
| `docs/dispatcher-agents-results.md` | Verified results and limits |

## Verification

Unit tests cover worse/tied/missing alternatives, nonfinite metrics, policy
labels, retained audit history, no keep cursor/highlight, finite change markers,
no rearmed marker on normal receipts, and consent/ownership lifecycles. Run
style/i18n gates and production build. Extend the existing real full-shift E2E
through page objects; no fixed waits, forced clicks, retries or raised timeouts.
Verify native keep presentation and real PP changes in the production build.
Use the existing E2E skill's narrow run and fast suite; report pre-existing
known failures honestly. Backend selection remains unchanged.

## Verification notes

- `npm run test:dispatcher`: 149 passed, using Chromium headless shell.
- Style lint and translation validation passed: 2491 keys in EN/DE/FR and all
  45 existing click identifiers preserved.
- Production build passed. Existing survey-template and bundle-budget warnings
  remain. Served bundle: `main-MIQ6PXDG.js`, SHA-256
  `71bfdbfc9e466fa29a96f0a8c3c7e7ec64be4f73566575e146e545c92fd04214`.
- Native UI acceptance and the broad fast suite are recorded after completion
  below and in the results document. The full-shift acceptance uses the same
  production bundle on an isolated local server via supported `E2E_BASE_URL`;
  its output/report directories are separate from the simultaneous fast suite.

The full-shift completion check retains its unchanged 270-second budget and all
16-arrival/audit requirements. It timed out again at step 120, after 27 accepted
commands with no stale or rejected commands. The previous formal full-shift
case was already red; its separate successful walkthrough took 263.749 seconds
and is not a passing result for this build. Progress requests in the new trace
wait behind serialised backend forecast pulses. This presentation change makes
no claim to resolve that execution latency. A separate short live-assessment
case checks the new UX without declaring the remaining shift complete.

The broad fast run finished 103 passed / 16 failed. Fifteen match documented
setup/Gallery/Inspector bugs. The additional MARL-loop failure exposed an
existing helper ordering gap: two native Step 50 requests completed before the
override POST returned. Its helper now awaits that real acknowledgement before
stepping. The focused run records the genuine intervention and reaches 3/3
arrivals, but remains failed at the unchanged 60-second training-check gate:
the accepted job stays running without an error or check results for more than
75 seconds. This later completion limit remains unresolved; the original
103/16 broad result is not relabelled.

Final affected production checks: Team consent/PP execution and the existing
Director goal-switch/ownership case passed; full synthetic completion timed out
as described above (2 passed / 1 failed). The separate live-assessment test
passed, including two distinct accepted Keep commands during Play, map anchoring
without an A cursor/highlight, and an explicitly incomplete/unfinished export.
