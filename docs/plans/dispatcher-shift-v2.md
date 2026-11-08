# Dispatcher shift: multiple contentions and visible evidence

## Scope and authorisation

The user accepted the review's next iteration: correct the identified defects,
handle more than the first contention, and provide a complete prepared shift
with understandable reasons and observed results. Keep existing short demos.
Work on `codex/dispatcher-agents`; no new widget, LLM, planner or interaction mode.

Staffing remains orthogonal to Recommendation, Co-Learning and Director. Preserve
explicit, immutable Team consent, human takeover, opt-in text input, neutral
Co-Learning, existing study defaults and all protected recovery/trajectory seams.

## Behaviour

### Correctness

- Native strategy Apply reflects ownership and confirms only acknowledged
  application. A rejected request cannot display Applied. Dispatcher consent
  remains explicit in its existing bubble; unavailable native writes explain
  the required handover rather than issuing a known-rejected mutation.
- Session creation has an invalidation token. End session and replacement start
  invalidate old callbacks (including errors, opening work and WebSocket setup).
- Domain state consumes every ordered WebSocket message. A final state followed
  immediately by playback/episode notices cannot disappear through signal
  coalescing. Retain existing session/generation/startup and control guards.
- Equivalent normalised Director objectives do not count as goal changes.
- Measured-run policy and code/model provenance are captured for the run and
  sealed with its measurements, separate from later human operation.
- Invalid control requests must not pause the simulation before validation.
- Accepted native choices are logged once by their parent after acknowledgement,
  even if refreshing the cards removes the original view. Capture decision
  context before awaiting; rejected/stale sessions do not produce a record.
- The toolbar follows server-confirmed availability when an installed plan
  changes the active policy, without widening a deployment allowlist.

### Contention queue

Reuse the public forecast's urgency order. A canonical identity combines sorted
train handles and unique sorted spatial window cells, excluding time, score and
list order. Expose the identity additively on public groups/options. Extend
native strategy preview/apply with an optional contention reference; omitted
references preserve the current human endpoint behaviour.

The runtime observes every visible group, selects the first unanswered group,
and computes existing scored alternatives only for that selected group. A
previously handled first group cannot starve later groups. Keep one pending
immutable command. A pending command remains bound to its original group and
offered action/order; generation, ownership, group and option revalidation remain
mandatory. Changed spatial membership creates a new reference. Disappearing
groups are observed outcomes, not proof that an intervention caused resolution.

Queue data may report waiting/handled/current groups and affected handles. Neutral
Co-Learning may show situation counts without preferred options or ranked advice.
No new optimisation algorithm: scheduling follows the existing forecast ordering;
PP/CBS and trajectory rollouts remain the existing implementations.

### Reasons and effects in the existing bubble

Record structured decision evidence: selected and Keep-course forecast metrics,
forecast step/horizon, affected handles/location and chosen action. Display useful
differences, including equal predictions and possible trade-offs, without
inventing certainty, emotions, causal benefit or hidden model reasoning.
Distinguish the forecast's computation step from the predicted conflict step.
Name each yardstick: forecasts may use a controller plan while actual metrics
retain the original timetable/deadlines. Do not imply those are the same reference.

Keep execution acknowledgement distinct from subsequent observations. Reuse
normal observations and actual arrivals/delay to update effect evidence; do not
add expensive simulation branches for narration. A disappeared forecast, changed
forecast or later measured arrival is labelled as an observation. Paused, busy,
offline, human-owned and finished states remain truthful and independent.

Use a compact bubble with expandable details. Queue/evidence goes into that
bubble. Preserve visible consent controls, optional command input and reduced
motion. Native cursor anchors should cover custom priority/Director controls or
truthfully fall back without pretending to click a different control.

Add monotonic server elapsed milliseconds to event evidence alongside logical and
simulation clocks. This supports real response-time analysis; do not reinterpret
logical ticks as human latency. No raw dictated text is collected.

### Prepared shift

Add two recipes for the same authored shift: watch the synthetic dispatcher or
work as a human/partner team. Use the existing 16-service corridor with
intermediate calls, a fixed seed and an explicit multi-event train-delay fixture.
Choose times/handles from actual runs. Disable random malfunctions for the
authored condition. Preserve existing Recommendation/Director/Team recipes.

One additional start-screen card offers the two staffing choices, without layout
or network entry. No additional working-screen widget. A shift ends according to
the actual environment result; do not equate reaching the time horizon with all
trains arriving. The existing end-of-shift humour remains terminal-only.

> **Integration note (explore_db, 2026-11-08):** the start screen has no cards.
> The two staffing choices are the tours `dispatcher-shift` and
> `dispatcher-shift-team` in the group *Dispatcher demos* (`watch`), with
> `dispatcherDemo: 'shift'` / `'shift-team'` (docs/plans/tour-picker-groups.md).
> The `dispatcher.shift.*` card keys were dropped; the tour texts are
> `tours.dispatcher-shift*.{name,description}`.

## New files

| File | Purpose |
| --- | --- |
| This plan | Behaviour, limits and acceptance criteria |
| backend/app/core/contention_identity.py | Pure shared identity, no solver |
| backend/app/fixtures/pf_ch/disturbances_shift/corridor-shift-incidents.json | Authored, reproducible corridor shift |
| backend/tests/test_dispatcher_shift.py | Queue, consent, rejected controls and evidence regressions |
| backend/tests/test_dispatcher_batch_summary.py | Condition/outcome preservation and unattended Team rejection |
| frontend/src/app/core/dispatcher-activity.service.spec.ts | Latest action survives bounded history/reconnect |
| frontend/src/app/core/session.store.ws.spec.ts | Actual transport/store terminal bursts, guards and lifecycle cleanup |
| frontend/src/app/core/combined-actions/contention-strategies.service.spec.ts | Command-bound native offer and stale request protection |
| frontend/src/app/features/combined-actions/combined-actions.component.spec.ts | Parent-owned, exactly-once native acknowledgements |
| frontend/src/app/features/combined-actions/components/action-card/action-card.component.spec.ts | Deferred success/failure, ownership and view replacement |
| frontend/e2e/dispatcher-shift.spec.ts | Complete production shift and actual Team consent |
| backend/examples/dispatcher-shift.json | Equivalent reproducible unattended recipe |
| frontend/karma.conf.cjs | Portable loopback unit-test configuration |

## Modified files

| File/service | Change |
| --- | --- |
| backend/app/core/dispatcher.py | Queue, evidence, measurement fixes and new recipes |
| backend/app/core/contention_strategies.py; api/hmi.py | Optional group reference, existing solver reuse |
| backend/app/api/dispatcher.py | Validate before early stop effects |
| backend/app/dispatcher_batch.py | Retain condition/outcome in comparisons; reject unattended Team runs |
| backend/app/core/scenario_presets.py | Register new disturbance set on existing corridor |
| frontend SessionStore and native strategy card/service | Creation cancellation and acknowledged application |
| frontend toolbar TS/HTML and existing toolbar tests | Actual installed-policy availability and selection |
| frontend ConfigShell TS/HTML, app Settings binding and existing ConfigShell tests | Queue menu closure during Lyne opening so Settings remains usable |
| frontend dispatcher DTO/activity/overlay | Compact queue, forecast and observed effect presentation |
| frontend app component/API | Additional prepared-shift launcher |
| EN/DE/FR and click-id inventory | User-facing copy; French draft |
| Existing test page objects and regression suites | New controls and actual backend/browser checks |
| docs/dispatcher-agents*.md | Usage and candid measured results |
| frontend/package.json; CI workflow | Focused control/lifecycle unit gate using real headless Chrome |

## Validation

Meaningful regressions cover an answered first group with a new second group,
stable identity under reordering, stale original group after approval, neutral
Co-Learning, failed native Apply, End session during a delayed create, equivalent
goal vectors, frozen provenance and invalid controls without side effects.

Use the e2e-tests skill: test IDs via page objects, narrow then broad, no blind
waits/retries/weakened assertions/timeouts. Run relevant frontend units, backend
suite, production build, styles/i18n, focused real-browser queue/shift and consent
checks followed by the broad fast suite. Known baseline failures remain recorded
as failures. Verify the visible production build and save complete shift export
and screenshots, distinguishing operational outcomes from integration checks.

Consortium grounding: existing ecosystem summary and D3.1 section 3/7, D3.2 A3S
service contract support structured decision records and forecast comparisons.
This iteration adapts existing public HMI evidence; it does not port new AI
algorithms or claim validated human-performance improvements.
