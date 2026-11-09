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

## Optional typed/dictated commands

The existing speech bubble now has a browser-persisted, default-off command input.
Enable it in Session Settings → Basic and Apply; Cancel preserves the current
preference. It accepts ordinary text input, including dictation inserted by Wispr
Flow. The app neither activates Wispr nor accesses a microphone. Enter/Send is
explicit; typing, IME composition and held-key repeats do not execute commands.

69 parser/service unit cases passed. They cover exact DE/EN/FR aliases, rejection
of negative/combined/unknown text, opt-out and persistence, no execution on typing,
startup/ownership/terminal gating, busy pause, pending-request suppression, and
session/proposal ID+generation binding. Repeated approval is a no-op; conflicting
decline after approval reports blocked. Feedback reports submission and directs
the user to the actual dispatcher status, without inventing acknowledgement.

All four focused production-browser cases passed: settings default-off/cancel/
apply/disable/reload; actual Pause/Resume/Decline/Takeover routes via Send and Enter;
paused approval without implicit Play and exactly one execution; old text unable
to approve a replacement proposal after takeover/delegation. Browser text insertion
exercises the field Wispr can target; the external Wispr application itself was
not automated. Existing mouse controls and human study defaults stay intact.

Production build, style lint and all 2424 EN/DE/FR keys / 45 click ids pass.
No backend, policy, trajectory, scenario-throttle or recovery code changed.
French additions remain draft copy. The existing bundle warning remains.
[Text controls](examples/dispatcher-agents/voice/dispatcher-text-controls.png),
[approval while paused](examples/dispatcher-agents/voice/dispatcher-text-approved-paused.png),
[structured export](examples/dispatcher-agents/voice/dispatcher-text-export.json).

The broad fast run completed **103 passed / 16 failed** in 15.4 minutes. All four
new command cases and all existing Team cases passed. Fifteen failures match the
existing Plan-B/Interview setup, Gallery fixture and empty Inspector bugs (9, 2,
10). The other failure was the existing scripted MARL tour's readiness check:
its first learned-policy step was still loading models for 9.84 seconds while
Start correctly remained disabled. The same test reproduced in isolation before
the harness correction. TourIntro now first waits for the existing global loading
indicator to disappear under the already defined START_TIMEOUT, then retains its
original five-second enabled/disabled checks. No timeout constants, total test
budgets, domain assertions, skips or retries changed. That exact test then passed
alone (4.1 seconds). The full MARL loop and Olten live tour passed in the broad run;
the previously documented intermittent Olten issue remains open. The broad result
above is recorded as run rather than relabelled after the narrow correction.

## Multi-contention shift and decision evidence

This iteration adds two one-click recipes for the same 16-service corridor shift:
watch a synthetic operator or approve/decline a digital partner's proposals. Four
authored train delays replace random malfunctions for this demonstration. The
original three small demos remain available; this is still a deterministic
operator using the existing public HMI strategies and PP/CBS implementation.

The runtime now reaches later visible groups when the first is already answered,
with canonical spatial/train references and one immutable pending command.
Native cards consume the original scored offer, so cursor, affected trains and
forecast figures refer to the actual decision. The compact bubble exposes queue,
forecast comparison and subsequent observations without an additional widget.
Forecast computation and predicted conflict times are distinct. Forecast plan
references and frozen actual arrival deadlines are explicitly named and are not
treated as the same yardstick or as causal evidence of benefit.

Correctness fixes cover normalised equivalent goals, frozen policy/provenance,
rejected controls without side effects, same-step score-cache freshness, installed
plan availability, explicit preset horizons, stale creation continuations and
truthful native acknowledgements. Accepted native choices are logged once in the
parent even if a forecast refresh removes their original card. Co-Learning stays
neutral; Team approval stays session/generation/command-bound and never resumes
paused playback implicitly.

The larger production run also exposed a lost terminal-state message: the server
had 172 steps / 16 arrivals, while the screen remained at 171 / 15 / Paused.
An actual SessionStore + WebSocketService regression reproduced this despite
transport receipt of the final state. The store now consumes the existing ordered
message stream instead of its coalescing latest-value signal. Five focused cases
cover terminal bursts, startup drops, drained ownership/stale frames, error bursts
and subscriber cleanup. No final GET workaround or assertion-budget change was
used. Protected trajectory/recovery method bodies and scenario throttling remain
unchanged.

Final backend regression: **764 passed, 25 existing tier skips**, using
`DIRECTOR_PARALLEL=0`, four xdist workers. The earlier default parallel-planner run
on this Mac produced native Torch/fork traces and one outdated new-recipe setup
assertion; it is retained separately, not presented as a clean run. The supported
local serial-planner run completes without those native errors. Focused reference,
queue, consent and rejected-control cases also pass.

The exact new frontend CI command, `npm run test:dispatcher`, passes **136 cases**:
parser/commands, ownership, startup cancellation, native acknowledgements, displayed
policy availability, retained history, ordered WebSocket state and native menu
lifecycle and actual takeover hit-testing. A fast Settings click during Lyne's opening animation could leave its
popover intercepting the panel; closure now waits for the actual opening event.
Real-Lyne cases verify closure, focus and reopening. Production
build, styles and all **2479 EN/DE/FR keys / 45 click ids** pass. The existing
bundle-budget and Survey template warnings remain; French additions are draft.

The formal production-browser shift case remains **failed at its unchanged
270-second total budget**, with the live UI at step 158 and 11/16 arrivals under
heavy competing host load. The separate Team consent case passed in 25.7 seconds:
one explicit approval, one later-group decline, and no implicit Play. The earlier
Settings failure was reproduced as the native-menu race above; its exact case
passes after the correction (22.2 seconds). An interrupted legacy run is not
counted as a completed suite. A standalone full-shift walkthrough is recorded
separately below; it cannot turn the formal timeout into a passing test result.

The additional **standalone scripted production-UI walkthrough** completed in
**263.749 seconds** (backend-measured elapsed time 260.091 seconds): **16/16
arrivals at step 172**, with **35 accepted commands: 3 PP replans and 32 Keep
course choices**. At most two conflict groups were visible together. It retained
the existing 150-second per-progress bound and the strict five-second finished-UI
assertion, without changing the formal test or its deadline. Passive WebSocket
capture shows state 171/running, then state 172/finished, then stopped playback;
the screen agrees with 16 arrivals, Finished and Scripted Plan. Deadline lateness
is 0 across 16 arrivals; this observation does not establish a causal benefit.

[Compact final screen](examples/dispatcher-agents/shift-v2/synthetic-verified/shift-complete-compact.png),
[expanded evidence](examples/dispatcher-agents/shift-v2/synthetic-verified/shift-complete.png),
[full export](examples/dispatcher-agents/shift-v2/synthetic-verified/shift-complete-export.json),
[walkthrough manifest and build hashes](examples/dispatcher-agents/shift-v2/synthetic-verified/walkthrough-manifest.json),
[passive frame receipt](examples/dispatcher-agents/shift-v2/synthetic-verified/passive-websocket-frames.json).
[Team proposal](examples/dispatcher-agents/shift-v2/team-verified/shift-team-compact.png),
[later-group decline](examples/dispatcher-agents/shift-v2/team-verified/shift-team-declined.png)
and [Team export](examples/dispatcher-agents/shift-v2/team-verified/shift-team-export.json)
show the separate consent integration check. That Team run intentionally ends
after one approval and one decline; it is not a completed Team-shift comparison.

The broad fast suite on the initial `6bcc91c` production build completed
**103 passed / 16 failed in 16.3 minutes**. Fifteen failures retain their existing
classifications: thirteen Plan-B/Interview setup paths (known bug 9), Gallery's
fixture 404 (bug 2), and the absent Inspector disclosure row (bug 10). The full
MARL and Olten live loops passed. The sixteenth failure was a newly confirmed
speech-overlay occlusion: its Details button intercepted the native takeover
target, so no ownership request was sent. This original **103/16** result is
preserved rather than relabelled after the fix.

The bubble now reserves the measured toolbar and scrolls within the remaining
viewport. Two actual-component regressions reproduce the original occlusion and
verify native centre hit-testing in both compact and expanded views, with cursor
alignment unchanged. The exact failed Team takeover/delegation browser case
passes on the corrected production build in **9.9 seconds** using the ordinary
native click, with no force-click, retry or timeout changes.
[Before takeover](examples/dispatcher-agents/shift-v2/takeover-verified/team-awaiting-consent.png),
[after redelegation](examples/dispatcher-agents/shift-v2/takeover-verified/team-redelegated.png),
[actual export](examples/dispatcher-agents/shift-v2/takeover-verified/team-export.json)
and [corrected build hashes](examples/dispatcher-agents/shift-v2/takeover-verified/build-manifest.json).
The earlier completed-shift walkthrough remains evidence for the build named in
its own manifest; it is not claimed as a full-shift run of this later UI fix.

The final affected production-browser set completed **15 passed / 1 failed in
20.1 minutes**. All fourteen fast dispatcher/Team/text-control cases and the
Director Team consent case passed, including the formerly occluded takeover.
The remaining prepared Director case passed both autonomous native goal commits
and human takeover, then its response waiter failed during the human connections
focus change. The retained trace shows an ordinary 54 ms native click and the
actual weights POST returning **HTTP 200 in 11.977 seconds**, with weights
`[2,5,2]` and `replanned:true`. Polling and screencast activity then disappear for
roughly 918 seconds; the configured 150-second waiter records its timeout about
938 seconds after starting. This trace-wide execution gap is not evidence of a
150-second planner response. The existing weights endpoint, Director strategies
and native planner are unchanged. No source repair, retry or timeout increase
was justified by this evidence. The formal **15/1** result remains a failure;
successful network evidence does not turn it into a passing test.

The bounded host power log subsequently confirms the interruption: macOS entered
sleep at **12:40:49 CET** and woke at **12:56:19 CET**, a **930-second** interval
matching the screencast/polling gap. No application or planner change is warranted
for that failure. A single isolated recheck after wake is reported separately;
the interrupted run's formal 15/1 result remains unchanged.

The isolated prepared Director case after wake **passed in 3.9 minutes** (4.2
minutes including runner setup/teardown), with the unchanged test and budgets,
one worker, `DIRECTOR_PARALLEL=0` and `OMP_NUM_THREADS=1`. It verifies both native
automatic goal commits, takeover, retained last action, cursor removal and the
human connections goal `[2,5,2]`. All sixteen affected cases have therefore been
verified on the corrected production build across the 15 passing cases and this
single post-wake recheck; the combined interrupted 15/1 run and earlier broad
103/16 result are still recorded as run. No further code change was required.

## Director card layout and shift sign-off

Strategy cards now wrap into three, two or one columns as their panel narrows.
Axis labels, scores and deltas share bounded grid columns; the Active badge has
its own header row and explanatory action text explicitly uses 11px. The finished
message in EN/DE/FR now mentions cool drinks, sport or family time, with a soft
drink emoji. Existing translation keys and interaction behaviour are preserved.

All **60 existing StrategyOptions tests**, stylelint, **2479 translation keys /
45 click ids** and the production build pass. A standalone visual probe using a
real paused Director forecast verified six EN/DE cases: 900/620/320px widths and
2x whole-document content zoom. Visible labels, scores, deltas and buttons remain
within their cards. The width matrix temporarily positioned the real mounted
component; it does not claim browser-chrome zoom coverage.
[Wide cards](examples/dispatcher-agents/card-layout/en-900px-zoom1.png) and
[narrow German cards](examples/dispatcher-agents/card-layout/de-320px-zoom1.png).

The probe's optional French screenshot was not completed because its language
switch retained content zoom. The native forecast did not render an identical-
plan annotation; its 11px rule was checked in the emitted production CSS rather
than claimed as a native screenshot result. French copy remains draft.

## Large Director feasibility

The measured 16-service Director check fails the intended demo acceptance:
constant stability reaches only **1/16 arrivals**, and a prepared switch to
punctuality reaches **2/16**, both at the 320-step horizon. Captured and cached
start plans also fail without faults; the current initial planning/execution
path is therefore already a blocker. Ordinary steps take approximately 21–26 ms,
but individual planning boundaries pause simulation for **37–75 seconds**.
All four scripted faults affect active trains. The existing Lines/Avoidance
portfolio baselines did not supply a successful alternative in bounded checks.

The [feasibility report](plans/director-large-shift-feasibility.md) records the
eight actual native/replay conditions, timings, source diagnostic, artifacts
and reproducible inputs. It separates dispatcher goal acceptance, committed
route changes and actual arrivals. Application code and the existing demo
launchers were not changed by this check.

## Verified initial Director execution

The [reliability implementation](plans/director-reliable-execution.md) adds
mandatory real-physics admission for initial plans (including caches and
fallbacks) and freshly joined residual candidates, even for weight changes.
Plans that omit services or required calls are rejected explicitly. Model
scores can rank admitted plans; they cannot waive execution validity.

The existing PP solver is unchanged. Its strict adapter retains every call,
retries bounded later off-grid departures when a greedy waypoint chain becomes
trapped, respects directed platforms, and permits waits only where the native
player can represent them. Actual insertion bounds survive model inputs,
snapshots, capture/splice and cache identities.

On the unchanged large corridor, actual native execution now achieves
**16/16 arrivals and 48/48 mandatory calls by step 181 of 320**. One candidate
took **1.058 s to plan and 0.430 s to validate**, with the original env still at
step zero. [Per-service evidence](examples/dispatcher-agents/director-reliability/initial-plan.json).
These timings exclude learned candidate search, startup and the browser. This
fault-free milestone does not establish the four-fault demonstration, reliable
incident recovery or an incident-aware dispatcher. No new demo launcher is
enabled by this backend change.

Additional [fixed-plan controls](examples/dispatcher-agents/director-reliability/fixed-plan-fault-controls.json)
localise the next gap: with all four faults actually active, native execution
without replanning reaches **5/16 arrivals, 36/48 calls**; the existing
resource-order-preserving `PlanPolicy` reaches **16/16, 48/48** on the same PP
trainruns. That executor is not yet integrated into Director. An isolated wait-
counter change did not restore completion and was not applied.

The normal session functions with installed models likewise finish 16/16 and
48/48 at step 181. Preparation was **99.935 s** with learned search first and
**10.879 s** after trying verified PP first for initial scenes over eight
trains; both selected `pp-2`. These individual uncached runs do not measure
browser animation or promise general latency. [Session-path evidence](examples/dispatcher-agents/director-reliability/public-session.json).

The final normal backend gate passes **814 tests**, with 25 tests skipped under
the tier/environment settings; actual slow initial-cache reuse passed separately. A final isolated
session replay after the stale-proof guards again achieves 16/16 and 48/48:
**5.768 s preparation, 1.071 s stepping, end step 181**.
[Final source/version evidence](examples/dispatcher-agents/director-reliability/public-session-final.json).

## Full-shift assessment presentation

`Full shift -> Watch shift` is explicitly labelled Recommendation. The existing
bubble now names the assessed services and location and compares the actual
chosen forecast with its best alternative from the immutable decision offer.
It distinguishes worse, tied and unavailable comparisons; forecast values are
not presented as measured benefits. Selection, command IDs and backend execution
remain unchanged.

Accepted Keep assessments stay anchored to the map without an A cursor or
dispatcher control highlight. Real changes receive a finite acknowledgement;
pending consent retains its real control. Historical outcomes remain readable,
and only a pending command can reveal its control, once per command.

- Dispatcher frontend units: **149 passed**. Stylelint, **2491 translation keys
  in EN/DE/FR**, all **45 click identifiers**, production build and diff checks
  pass. Existing bundle-budget/Survey warnings remain; French additions are draft.
- All **14 existing fast dispatcher cases passed**. The final additional
  production set recorded **2 passed / 1 failed**: large Team approval/decline
  and the existing Director goal-switch/ownership case passed. The Director case
  verifies an actual transient frame within 4 px of the native control and its
  later removal with unchanged history, weights and active goal.
- A **separate live-assessment case passed**, proving two different accepted
  Keep commands during Play, named context and frozen forecast comparison,
  map anchoring without an A cursor/highlight, and pending-only unique reveals.
  Its [capture](examples/dispatcher-agents/shift-assessments/live-keep.png) and
  [export](examples/dispatcher-agents/shift-assessments/live-assessments-export.json)
  are explicitly **incomplete/unfinished**, not a completed shift.
- [Actual approved PP](examples/dispatcher-agents/shift-assessments/team-accepted-pp.png),
  [Team consent export](examples/dispatcher-agents/shift-assessments/team-consent-export.json),
  [settled Director goal/history](examples/dispatcher-agents/shift-assessments/director-settled.png),
  and [build/evidence hashes](examples/dispatcher-agents/shift-assessments/build-manifest.json).

The full synthetic completion case remains **failed at its unchanged 270-second
budget**: last recorded state is step 120, 4/16 arrivals, 27 accepted commands,
zero stale/rejected commands and a running actor. All original 16-arrival,
PP-change and audit requirements remain. The trace shows progress requests
waiting behind serialised backend forecast pulses. This does not isolate an
individual CPU function or establish a new full-shift timing guarantee. The
previous formal full-shift test was already red; the earlier separately measured
263.749-second walkthrough above is not completion evidence for this UI build.
[Raw final response](examples/dispatcher-agents/shift-assessments/full-shift-timeout-state.json)
and [original timeout context](examples/dispatcher-agents/shift-assessments/full-shift-timeout-error.txt).

The broad fast run recorded **103 passed / 16 failed** in 20.6 minutes. Fifteen
match documented bugs: 13 retired Plan-B/Interview setup failures (bug 9), the
Gallery fixture 404 (bug 2), and missing Inspector decision row (bug 10). The
additional MARL loop failed with an empty intervention table. Its trace showed
two Step 50 requests completing before the override response. The existing test
helper now waits for the real override acknowledgement and checks its action
and human ownership. In the focused check, the genuine intervention is recorded
and the run reaches 3/3 arrivals, but the full MARL case **still fails** its
unchanged 60-second training-check gate: the accepted training job remains
running with no error or check results after more than 75 seconds. This new
training completion observation is unresolved, not claimed as a known baseline
failure. Neither failed run is relabelled as passing; no skips, retries or
increased deadlines hide these limits. Backend source is unchanged.


## Small Director: a frozen native plan comparison

The prepared Director demo now compares its actual C/stability plan with one
native A/punctuality candidate at **step one**, before adopting that candidate.
The backend holds simulation time and the dispatcher clock, validates real
execution, and caches the exact native candidate. The existing map shows the
current routes, then the candidate's real divergence; the existing strategy
controls and floating bubble explain it. Adoption uses the frozen token rather
than running a different replan at commit.

This is the **small three-service case**, with no connections or scripted
faults. The checked candidate changes routes for **handles 0 and 2**, with no
additional holds. Its native execution check reaches **3/3 arrivals by step 82**.
Current-plan checkpoint utilities are unavailable and remain null: the UI does
not invent a comparative KPI gain, a lost connection or a sacrifice. Candidate
forecasts are explicitly separate from real execution validation. This does
not establish large-corridor disruption recovery or an incident-aware dispatcher.

Only the browser that explicitly launched the prepared demo orchestrates it.
An observing browser issues no prepare, commit or automatic-resume requests. Pause,
takeover and stale state cancel the automatic workflow; the post-adoption Play
capability is separately revocable, so a delayed resume cannot undo a later
human pause. Takeover marks the run mixed: later delegation restores ordinary
Director autonomy without another guided comparison. A new demo starts a new
comparison. Ordinary Human, Team and Recommendation behaviour is retained.

The comparison bubble uses the existing left gutter, keeping the map and native
A control uncovered. The real pending control is revealed once while simulation
time is held. The final header-only refinement names the actual comparison work
and uses the existing active avatar states; physical simulation hold remains
explicit in the body. It does not describe a calculating dispatcher as paused.

Verification recorded so far:

- **100 targeted frontend tests passed**, including real 1280×720 gutter,
  scroll/cursor geometry, native control restoration and mixed-run ownership.
  The final header/geometry check separately passed **20 tests**. Stylelint,
  **2513 translation keys per language** and **45 preserved click IDs** pass.
- **68 focused backend tests passed**; the final full backend gate passed
  **849 tests, with 25 skipped** under the existing tier/environment settings.
- On production bundle `main-7R4YPSGK.js`, the strengthened native map/adoption
  and late-preparation takeover cases **both passed** (4.3 minutes as reported).
  The positive case finished **3/3 at step 82** and showed the alcohol-free
  shift sign-off. Its stable frames placed speech wholly left of the map and
  the cursor within 0.01 px of the uncovered native A control. This pair
  precedes the final header-only refinement.
- The final header production build is `main-N3UPWKVI.js`, SHA256
  `2aa559c068a3477a10060517a0f888514016adff5a1d48717f44b6816dd5f36d`,
  built in **42.423 s**. Its final strengthened native positive case **passed**
  (3.1 minutes including setup/teardown; case 3.0 minutes). It explicitly checks
  the actual `acting` live state while the genuine commit request is held,
  verifies frozen candidate adoption and finishes **3/3 at step 82**. Stable
  baseline/alternative/committing frames keep a 12px map-to-speech gap; the
  alternative/committing control is uncovered with cursor error below 0.01px.
  The 7R4 pair above remains a separate earlier build run.
- The final N3 broad fast run recorded **101 passed / 18 failed** in **15.5
  minutes**, before the subsequent test-helper opening-readiness barrier. The
  production application bundle is unchanged by that helper adjustment.

The earlier `main-X6LTS6ZV.js` three-case native run remains **2 passed / 1
failed**. The map/adoption/completion case and existing Director ownership
regression passed. The takeover case failed because its assertion expected
cancelled comparison markup after the surface had correctly released ownership;
that expectation was corrected while retaining command, weights, ownership and
no-late-write assertions. The original failed run is not relabelled as passing.

Fifteen broad failures match documented bugs: 13 retired Plan-B/Interview setup
failures (bug 9), the Gallery fixture 404 (bug 2), and the missing Inspector
row (bug 10). Three additional timing/readiness observations are retained
separately: the delayed synthetic/no-takeover case still had disabled Play at
its 5 s assertion while the initial step response took 6.71 s; Designer still
showed Loading while its lazy chunk returned HTTP 200 after 5.55 s; and the
Learning Monitor failed its initial checkbox assertion while learning status
was still loading, before any settings action. The original **101/18** run is
not relabelled as passing.
[Broad raw log](examples/dispatcher-agents/director-comparison/broad-fast-N3UPWKVI.txt),
[synthetic context](examples/dispatcher-agents/director-comparison/broad-delayed-takeover-error-context.txt),
[Designer context](examples/dispatcher-agents/director-comparison/broad-designer-error-context.txt)
and [Learning Monitor context](examples/dispatcher-agents/director-comparison/broad-learning-monitor-error-context.txt).

The focused serial recheck of these exact three cases **passed all three**
(2.1 minutes) on the same N3 application bundle, with original assertion and
test budgets. The delayed synthetic case took 1.5 minutes; unchanged Designer
and Learning Monitor cases took 6.3 s and 15.8 s. Only the synthetic start helper
now waits for the existing `status-loading` indicator to clear with established
`START_TIMEOUT`, before the unchanged enabled/disabled, click and real Play-
acknowledgement checks. No application change is used for this recheck. These
isolated serial results do not replace the original broad **101/18** result or
establish general stability under parallel load.
[Focused raw log](examples/dispatcher-agents/director-comparison/focused-readiness.txt).
MARL and the Olten live tour passed in the broad run; that does not establish a
fix for the earlier separately recorded MARL training-completion failure.

The browser checks hold **genuine prepare/commit requests** to inspect frozen
state and interruption. Their duration is not a measurement of normal backend
latency. A separate, earlier fresh-process probe recorded **4.054 s** through
imports/session creation, then **9.565 s** for initial directive preparation,
**0.584 s** for the first step/checkpoint, **10.623 s** for candidate preparation
and validation, and **0.021 s** for native adoption. These are individual
intervals from one prior process, before later startup/ownership/header changes;
they do not guarantee current browser timing. The feature's 1.5 s current-plan
and 3 s candidate reading stages are presentation intervals, not computation.
[Before native adoption](examples/dispatcher-agents/director-comparison/director-comparison-before-commit.png),
[installed plan](examples/dispatcher-agents/director-comparison/director-comparison-installed.png),
[completed shift](examples/dispatcher-agents/director-comparison/director-comparison-complete.png),
[frozen native comparison](examples/dispatcher-agents/director-comparison/director-comparison-frozen.json),
[actual SVG/map frames](examples/dispatcher-agents/director-comparison/director-comparison-map-frames.json),
[final runtime export](examples/dispatcher-agents/director-comparison/director-comparison-export.json)
and [final native run log](examples/dispatcher-agents/director-comparison/native-release.txt).

[Raw probe](examples/dispatcher-agents/director-comparison/prior-cold-probe-output.txt),
[derived intervals](examples/dispatcher-agents/director-comparison/prior-cold-probe-timings.json),
[7R4 takeover state](examples/dispatcher-agents/director-comparison/cancelled-state-7R4YPSGK.json),
[build/evidence manifest](examples/dispatcher-agents/director-comparison/build-manifest.json)
and [implementation scope](plans/director-dispatcher-map-comparison.md).

Archived text logs and error contexts have trailing spaces removed; the manifest
retains hashes and byte counts for both the original and archived versions.
JSON and image evidence is unchanged.
