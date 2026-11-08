# Synthetic dispatcher: measured results

Measured on 6 November 2026 on `explore_db` after the merge of `main` (`1695456`),
with Flatland 4.3.0 and seed 42. Reproduce with the batch commands in the
[guide](dispatcher-agents.md#batch-and-exports).

These are technical demonstrations. They establish neither scientific validity
nor correspondence to human behaviour, and the three Recommendation runs below
are not a performance comparison with the Director run.

## Runs

All runs use `pf-ch-wn-wal-long-approach` and finished with all three trains
arrived. Recommendation runs share the authored `strategy-e1-breakdown-weesen`
event; the Director run has no scripted disturbance.

| Mode | Profile | Planned / executed | Response ticks | Simulation steps | Summed arrival delay |
|---|---|---|---|---|---|
| Recommendation | Baseline | 1 / 1 | 0 | 81 | 24 |
| Recommendation | Delayed, delay 3 | 1 / 1 | 3 | 81 | 24 |
| Recommendation | Priority, train order 0, 2, 1 | 10 / 10 | 0 each | 77 | 34 |
| Director | Goal-Switch, `[1,1,1]` → `[5,1,1]` at tick 5 | 2 / 2 | 0 each | 82 | 42 |

Arrival delay is in simulation steps, against the original timetable.

- Baseline and Delayed select the same PP alternative. The delay holds the
  Recommendation environment, so it adds no operational train delay.
- Priority takes a different course without improving this delay measure.
- Goal-Switch: both directives appear in committed controller plans, which is one
  effective goal change (the initial directive does not count).

## Evidence

- [Comparison](examples/dispatcher-agents/comparison.json),
  [Baseline](examples/dispatcher-agents/baseline.json),
  [Delayed](examples/dispatcher-agents/delayed.json).
- [Variants](examples/dispatcher-agents/variants-comparison.json),
  [Priority](examples/dispatcher-agents/priority.json),
  [Goal-Switch](examples/dispatcher-agents/goal-switch.json).
- Prepared demos in the running app: [tour list](examples/dispatcher-agents/launchers.png),
  [Recommendation planned](examples/dispatcher-agents/recommendation-planned.png) and
  [accepted](examples/dispatcher-agents/recommendation-confirmed.png),
  [Director confirmed in plan](examples/dispatcher-agents/director-confirmed.png).

Earlier revisions and their exports are in the git history (`bca2685`).

## Checks

| Check | Result |
|---|---|
| `dispatcher.spec.ts` | 7 passed, including UI-to-batch metric equality, pause, takeover and disconnect |
| `tests/test_dispatcher.py --run-slow` | 33 passed |
| Effect on other sessions during a Director run (Walensee) | longest answer 0.11 s, as with a human session |

## Limits

- Co-Learning is unsupported for the synthetic dispatcher alone; the Team runs it
  as neutral observation. Director needs the installed models and a scenario
  the planner can solve.
- Requests to the same session wait while it plans, so a takeover takes effect
  when the running plan is done.
- Runtime ownership lives in the single backend process. The timeline is not a
  full replay.
- French copy is a draft pending native review.


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

The exact new frontend CI command, `npm run test:dispatcher`, passes **134 cases**:
parser/commands, ownership, startup cancellation, native acknowledgements, displayed
policy availability, retained history, ordered WebSocket state and native menu
lifecycle. A fast Settings click during Lyne's opening animation could leave its
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
