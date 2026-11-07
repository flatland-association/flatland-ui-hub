# Dispatcher demonstration — 6 November 2026

Executed against `explore_db` base `3e6a739`, with backend
source digest `05f84b0c22fb…` (full digest in every export), Flatland 4.3.0 and
seed 42. These are measured runs.

## Recommendation comparison

All three used `pf-ch-wn-wal-long-approach` and the same authored
`strategy-e1-breakdown-weesen` event. Every run finished with all three trains arrived.

| Profile | Planned / executed | Response ticks per execution | Simulation steps | Summed arrival delay |
|---|---|---|---|---|
| Baseline | 1 / 1 | 0 | 81 | 24 |
| Delayed, delay 3 | 1 / 1 | 3 | 81 | 24 |
| Priority, train order 0, 2, 1 | 10 / 10 | 0 | 77 | 34 |

Arrival-delay units are simulation steps, summed over three actual arrivals
against the original timetable. Baseline and Delayed selected the same PP
alternative. The three-pulse response delay held the Recommendation environment;
it therefore added no operational train delay. Priority produced a different
course without improving this delay measure.

Baseline and Delayed each ran through the real browser UI and the browserless
runner, with equal complete metric dictionaries. Two additional readers did not
advance the logical clock. During a pending delayed decision, Pause froze both
clocks; takeover cancelled it, left zero executed commands and labelled the run
`mixed`. Train rings were checked in the viewport for planned, executed and
cancelled commands, with monitor details closed to leave room for the map.

The separate Director Goal-Switch condition had no scripted disturbance. It
finished in 82 steps, with three arrivals and summed arrival delay 42. Both
directives were accepted **and evidenced in committed controller plans**: initial
weights `[1,1,1]`, then `[5,1,1]` at logical tick 5. That is one effective
replacement, excluding the initial directive. This different condition is a
functional demonstration, not a performance comparison with Recommendation.

## Evidence

- [Baseline UI](examples/dispatcher-agents/baseline-ui-export.json),
  [Baseline batch](examples/dispatcher-agents/baseline-batch-export.json),
  [Delayed UI](examples/dispatcher-agents/delayed-ui-export.json),
  [Delayed batch](examples/dispatcher-agents/delayed-batch-export.json).
- [Priority](examples/dispatcher-agents/01-priority.json),
  [Goal-Switch](examples/dispatcher-agents/02-goal-switch.json),
  [paired batch comparison](examples/dispatcher-agents/comparison.json).
- Actual browser captures: [pending details](examples/dispatcher-agents/pending-details.png),
  [planned train marker](examples/dispatcher-agents/planned-action.png),
  [takeover](examples/dispatcher-agents/human-takeover.png).

## Checks and remaining limits

- Backend full suite: **692 passed, 25 skipped**. After the final lifecycle and
  batch-error additions, `pytest tests/test_dispatcher.py --run-slow -n 0 -q`:
  **31 passed**, including deterministic repeated runs, HTTP/batch event parity,
  actual reset/delete/stop invalidation and committed Director plan weights.
  Isolated negative tests explicitly inject invalid references and a runtime error.
- Final Chromium Dispatcher suite: **3 passed** — Baseline, Delayed and takeover,
  including real exports and viewport checks. Priority and Goal-Switch were
  exercised through the backend/CLI, not a Director browser acceptance test.
- Production build, style lint, translation check (EN/DE/FR), focused Ruff and
  `git diff --check`: passed. The existing bundle-budget and survey-template
  build warnings remain.
- Broader `npm run e2e:fast`: **93 passed, 15 failed**. One Plan-B mode selector
  and twelve guided-study setups fail on hidden/retired controls; the Widget
  Gallery raises its documented fixture 404; the tour Inspector has no decision
  row. Four representative failures reproduced on pristine base `3e6a739`:
  Plan-B Build, study with/without disturbances, and Inspector disclosure.
  See [known bugs 2, 9 and 10](reference/e2e-testing.md#known-bugs).
  Those tests remain red; no skips, retries or increased timeouts were added.

Reproduction commands, compatibility, metric denominators and extension seams
are in the [guide](dispatcher-agents.md). Co-Learning is unsupported; Director
requires its installed models and a solvable scenario. Runtime ownership is
within the existing single backend process. The timeline is not a full replay,
and the runs establish no psychological or scientific validity.


## Prepared demo follow-up

Two start-screen cards now launch the complete Recommendation and Director
conditions without form edits. The backend recipe digest is `82c1f9f80543…`.
Recommendation accepted the actual PP strategy after three logical response ticks.
Director accepted two directives and confirmed one replacement in the running
controller plan (`[1,1,1]` → `[5,1,1]` at tick 8).

The speech bubble uses pending, result and effective-plan events. It stays visible
while the operator waits, can be collapsed, and does not advance the runtime.
Director maintains a confirmed directive between commands; it does not pretend to
choose an A/B/C tile. The prepared Director uses the existing three-zone layout
so that the map stays visible. Both cards fit in the laptop viewport.

Verification: **32 Dispatcher backend tests passed** including slow real runs;
**five Dispatcher browser flows passed**, followed by both final prepared-demo
checks. Production build, translations and style lint passed. The demo exports
below are deliberately paused after the demonstrated action: their technical and
simulation results remain incomplete, not completed performance measurements.

- [Launch cards](examples/dispatcher-agents/prepared-demos/launchers.png)
- [Recommendation planned](examples/dispatcher-agents/prepared-demos/recommendation-planned.png),
  [accepted](examples/dispatcher-agents/prepared-demos/recommendation-demo-confirmed.png),
  [raw export](examples/dispatcher-agents/prepared-demos/recommendation-demo-export.json)
- [Director confirmed in plan](examples/dispatcher-agents/prepared-demos/director-demo-confirmed.png),
  [raw export](examples/dispatcher-agents/prepared-demos/director-demo-export.json)


The follow-up broad `e2e:fast` run (four workers) recorded **92 passed / 17 failed**:
15 previously documented failures, a prepared-demo startup check that ran before
its opening steps completed, and the Olten live-tour playback check. The startup
helper now waits for the actual automatic Play acknowledgement, using the existing
startup bound; its original playback assertion remains unchanged. Both prepared
checks then passed. Both also passed against the production build, with the
Director's train visible alongside its confirmed goal change.

The additional Olten live-tour failure reproduced in the focused feature-branch
check; a pristine-base check passed once. Its cause is unresolved (known bug 11),
so the broader UI suite is **not green**. No tour assertion, skip or retry was
changed to hide it. This remains separate from the two verified prepared demos.


## Native-control speech overlay follow-up

The monitor widget and persistent monitor bar have been removed. The existing
Study 3 measures and Director three-zone layouts supply the real Apply/Commit
controls. A speech overlay and read-only visual cursor follow their geometry;
the cursor neither moves the user's mouse nor issues duplicate commands.
The native action changes to Applied after acceptance. Director uses the shared
human presets C `[2,2,5]` → A `[5,2,2]` at tick 12, and its selected card follows
confirmed controller events. Ownership and optional event-log access are in the
existing toolbar; saved human layouts are unchanged.

Verification of this revision:

- Dispatcher backend: **32 passed**, including slow cases.
- Existing human Director-strategy API tests: **11 passed**, including slow cases.
- Dispatcher browser cases: **5 passed**, including native cursor/control
  alignment, selected C→A cards, pause/takeover and full UI/batch metric equality.
- Final production build: **both prepared demos passed**. The Director test also
  takes over, checks the cursor is gone, applies native B through the human
  endpoint and verifies mixed ownership with no further agent commands.
- Production build, style lint, EN/DE/FR coverage and `data-log` IDs passed.

These new exports are snapshots paused after the demonstrated action. Their
simulation results are incomplete; they are interaction evidence, not completed
performance comparisons. Earlier completed-run evidence above remains historical.

- [Recommendation planned](examples/dispatcher-agents/surface-overlay/recommendation-planned.png),
  [accepted at the native button](examples/dispatcher-agents/surface-overlay/recommendation-confirmed.png),
  [export](examples/dispatcher-agents/surface-overlay/recommendation-export.json).
- [Director A confirmed at the native button](examples/dispatcher-agents/surface-overlay/director-confirmed.png),
  [export before human takeover](examples/dispatcher-agents/surface-overlay/director-export.json).


The overlay follow-up broad `e2e:fast` run finished with **94 passed / 15 failed**
in 10.1 minutes. All four fast dispatcher cases passed. The failures are the
previously documented Plan-B/guided-study setup cases (bug 9), Widget Gallery
fixture requests (bug 2), and empty three-modes Inspector (bug 10). No assertions,
retries, skips or timeout budgets were changed to hide them. The Olten live tour
passed in this run; bug 11 remains open because its cause has not been fixed.
See [known bugs](reference/e2e-testing.md#known-bugs).

Both new production snapshots record backend code digest `07687761e26c…`; full
digests are in the exports. Ruff lint passed for the dispatcher runtime, API and
shared presets. The optional formatting check flags the existing dispatcher
runtime/API files; the shared preset module is formatted.


## Dispatcher portrait and live-state revision

The same speech bubble now includes a small SVG dispatcher/headset portrait.
Current lifecycle, actual simulation step and received-state age are separate
from the retained command outcome. Native Director progress/counts and elapsed
wait are reused without additional polling. No stress value, fictional percentage
or animation drives execution. One brief update pulse follows actual state
messages; reduced-motion disables it. Observation alone has no action cursor.

Six focused browser cases passed, including all prior UI/batch parity and C→A
checks. Three production-build cases passed: both prepared demos and a full
live-state lifecycle (advancing state, acknowledged pause with frozen step while
age increases, real WebSocket disconnect, reconnect and resumed playback).
The last command text remains unchanged during takeover and disconnection.
Production captures: [running](examples/dispatcher-agents/avatar/running.png),
[paused Recommendation](examples/dispatcher-agents/avatar/recommendation-paused.png),
[paused Director](examples/dispatcher-agents/avatar/director-paused.png),
[offline](examples/dispatcher-agents/avatar/offline.png).

The first broad run, alongside production planning, recorded 93 passed and 17
failed: the 15 existing failures, a baseline overall timeout under CPU load, and
a delayed takeover check that missed the one-second pending window at the
interactive default of three pulses/second. Backend events show the command was
planned at logical 19 and executed at 22 before the check paused. Pending-decision
checks now explicitly select the native one-pulse/second tempo, retaining delay=3
and every cancellation/metric assertion. The completion case restores its original
tempo before resume. Both delayed cases then passed narrowly in the production
build. No assertion, retry, skip or timeout budget was weakened.

Production build, style lint, TypeScript and EN/DE/FR key/data-log checks passed.
French copy remains a draft for native review. Backend/controller code is unchanged
from the previous revision; existing completed-run performance evidence remains
historical. The local view is deployed as static assets without restarting or
resetting running backend sessions.


After the controlled-tempo correction, the final broad `e2e:fast` run with two
workers finished with **95 passed / 15 failed** in 13.5 minutes. All five fast
dispatcher cases passed, including baseline/delayed UI-to-batch metric equality,
pending takeover cancellation and the live-state disconnect/reconnect lifecycle.
Only the existing guided Plan-B/Interview setup (bug 9), Gallery fixture (bug 2)
and empty Inspector (bug 10) cases failed. The baseline completed in 41.7 seconds
without concurrent production planning; no timeout budget changed. The Olten live
tour passed; its previously documented intermittent issue remains open.


## Human + digital shift partner

A third staffing condition, `human_dispatcher_team`, keeps the three existing
interaction modes distinct. Recommendation waits for real human consent on the
immutable proposal; approved work waits while paused. Director consent concerns
objectives; Co-Learning is neutral and human-owned. This remains a deterministic
operator prototype that uses the existing recommendation/controller machinery.
There is no language-model conversation or generated human reflection.

The existing speech bubble contains consent controls, Team identity and honest
pending/draining status. It adds no widget or layout slot. Playback/busy state
comes from the backend, including another browser's commands and reconnects.
A worker transaction keeps model work off the ASGI loop and drains before an
ownership acknowledgement; progress/status reads stay available. Terminal run
measurements remain sealed after errors, stop and reset.

Production-build focused browser verification: **10 passed**, covering the three
Team decisions, externally controlled play/pause/reconnect, neutral Co-Learning,
the previous prepared Recommendation/lifecycle cases, and original UI/batch parity
and delayed takeover. The first pass exposed a clipped third launcher, consent
masking paused status, and clicks on a still-disabled custom Play host. Desktop
cards now occupy one row, pause has independent precedence, and page objects wait
for the actual enabled control. No assertion, timeout, skip or retry was weakened.

Backend full suite: **729 passed, 25 skipped** (existing slow/training tier skips).
Focused original dispatcher/Team tests also include slow real Director plan uptake
and deterministic UI/batch parity. New failure-path tests cover controller/env
exceptions, frozen error evidence, idempotent/session-bound consent, stale and
opposing replies, no unapproved execution, takeover cancellation and neutral
Co-Learning. Worker tests cover repeated cancellation, cancellation before startup,
progress reads and no ownership acknowledgement before the last in-flight write.
Three focused WebSocket unit cases passed against the actual service; old socket
callbacks cannot overwrite its replacement. The default local Karma launcher did
not capture; the same tests passed with the installed headless shell on loopback.

Production build, style lint, all **2411 EN/DE/FR keys** and **45 click ids** pass.
The pre-existing bundle budget warning remains; French additions are draft copy.
Trajectory recording/recovery method bodies remain unchanged.

Production captures: [awaiting real consent](examples/dispatcher-agents/team/team-awaiting-consent.png),
[approved and executed](examples/dispatcher-agents/team/team-approved.png),
[declined](examples/dispatcher-agents/team/team-declined.png),
[fresh delegation](examples/dispatcher-agents/team/team-redelegated.png).
Corresponding JSON exports are in the same directory.


The new Team Director production case also passed: actual Build configuration,
paused consent, exactly one directive execution, matching `directive_effective`,
real `goal_directed` controller and committed native C weights `[2,2,5]`.
The original prepared Director case passed separately. Initial numeric-entry
failure was test readiness: Lyne content stays inert during opening, so Playwright
numeric fill emitted no input event. The page object now waits for the actual
non-inert content, verifies focus and each value; no product reset existed.
Four combined component/real-Lyne-host and WebSocket tests passed.
[Awaiting Director consent](examples/dispatcher-agents/team/team-director-awaiting-consent.png),
[confirmed native C](examples/dispatcher-agents/team/team-director-confirmed.png),
[real Director export](examples/dispatcher-agents/team/team-director-export.json).


The broad fast run completed **97 passed / 18 failed** in 15.6 minutes. Sixteen
are the existing Plan-B/Interview setup (bug 9), Gallery fixture (bug 2), empty
Inspector (bug 10) and intermittent Olten live tour (bug 11) cases. Two additional
failures were resolved and then rechecked without reducing their assertions:
Team proposal presentation now waits for the real backend consent precondition
before its unchanged UI assertion; MARL Start could target the preceding session
while its replacement POST was pending. Explicit creation/opening barriers now
block Start and ignore stale startup updates until the new session is ready.
The actual MARL browser test remains unchanged apart from control readiness.

With the final production build, **all 7 scoped browser cases passed**: all five
fast Team cases, the complete MARL watch/intervene/train/drive loop and Team
Director consent/native C confirmation. **13 focused frontend unit cases passed**,
including nine intro-start guards/autostart cases. The full backend suite passed
with **729 tests and 25 existing tier skips**; two added actual-worker/loop cases
preserve terminal evidence after later human playback failure. The production
build, styles and translation/click-id checks pass. The broad result above is
recorded as run, not relabelled green after the targeted corrections. The known
baseline issues remain open. No timeout constants, test budgets or retries changed.
