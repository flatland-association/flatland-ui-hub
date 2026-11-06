# Synthetic dispatcher MVP

## 1. Identity

Dispatcher activity overlay over the existing native interface. No registered
widget, widget kind, layout slot or default zone. This revision replaces the
former `dispatcher-agent-monitor` Context widget at the user's request.
Grounding: the requested reproducible test strategies and AI4REALNET D3.1's
allocation and audit trail. Source: from-scratch, deliberately; this is operator
automation around existing commands, not a new dispatching algorithm.

## 2. Promise

Observe a synthetic operator's actual decisions and processing results, pause
the existing simulation, or explicitly take over its role.

## 3. Per-mode behaviour

Recommendation: accept the preferred existing contention strategy; optionally
delay or choose the existing PP alternative for an explicit train order.
Director: set explicit goal weights, optionally delay them, emphasise a supported
objective, or replace the weights at a planned logical time.
Co-learning: unsupported; neutral choices and human reflection are not automated.

## 4. System interaction

| Capability | Existing | Addition |
|---|---|---|
| Flatland steps, disturbances, trajectories | `step_env`, Play, `/step` | hooks before/after the same step |
| Ranked alternatives and PP order | `contention_strategies`, `apply_strategy` | reference-bound operator decision |
| Director directives and plans | Director weights endpoint | scheduled validated commands |
| Session records and exports | study session folder | synthetic metadata and event timeline |
| Ownership, pending decisions, logical clock | | session-owned runtime and read-only overlay |

The backend owns execution. Observing it, opening the event log, or opening another
browser never advances its clock. One pulse observes, plans, validates, executes
if due, then advances Flatland. Recommendation delay holds the environment at
the open decision while logical decision pulses advance; it represents response
latency, not an operational train delay. Explicit pause advances neither clock.
Director delay uses the same pulses while its autonomous controller continues.
For deterministic synthetic runs, the existing Director replanner commits
synchronously at logical boundaries, including automatic malfunction replans.
Human sessions retain their asynchronous planning schedule. Algorithm and
validation are shared; computational duration never determines the commit tick.

## 5. Allocation and accountability

Exactly one owner: human or synthetic dispatcher, separate from the train policy.
Manual interventions require explicit takeover. A generation invalidates pending
commands on takeover, stop, reset, mode change and end. Parameters are frozen for
the run. Events record source, observation, rule, command and result; human
takeover marks the run mixed. Synthetic runs never answer questionnaires.

## 6. Acceptance

### Avatar and current-state feedback revision

Add a small SVG dispatcher/headset portrait to the existing speech bubble; no
new widget, panel or layout. Current lifecycle and simulation step are prominent;
the last planned/accepted/confirmed action remains a separate labelled history.
Project observing, preparing, planned response, awaiting confirmation, explicit
pause, human ownership, completion, failures, disconnected and stale updates from
actual store/server signals. A timestamp measures received state freshness only;
it is never evidence that computation is advancing. A short update pulse runs
only on received state changes and respects reduced motion. No stress estimate,
fabricated percentage, thinking animation, mouse path or new execution loop.
Existing native control markers, validated commands and clocks remain unchanged.

New files: none planned. Modified files: `dispatcher-activity.service.ts` (read-only
live projection/freshness), `websocket.service.ts` (timestamp for received states),
the existing overlay TypeScript/template/SCSS (SVG avatar/current-state/history),
the native `strategy-options.component.ts` (reuse its existing planning progress),
EN/DE/FR translations, existing dispatcher E2E/page objects, usage and results.
Complete the prior monitor removal in `panel-mode-availability.ts` and
`layout-designer.component.ts`; the built UI already omits those entries.

Verify both prepared demos in the browser, real step updates, explicit pause,
human takeover and connection transitions. Preserve existing native cursor
alignment, C→A controller proof and UI/batch parity assertions. Completion and
errors take precedence over history; read-only feedback never advances a clock.
Pending-decision browser checks explicitly choose the supported one-pulse/second
tempo via the native slider, preserving `delay=3` and every cancellation/metric
assertion; restore normal interactive tempo before the completion check. At the
interactive default (three pulses/second) an API poll can miss the one-second
pending window under concurrent load. This is a controlled test setup, with no
change to application defaults, dispatcher rules or logical clocks.


Latest interaction revision: the requested presentation is a connected speech
overlay over the existing interface, not an additional widget. Remove the monitor
from the widget registry, palette and plugin host. Ownership/takeover and optional
event-log access live in the existing toolbar. Semantic anchors register actual
Apply/Commit controls; cursor and speech follow their current geometry and never
issue a second command. The demonstration reveals its current action card without
moving keyboard focus. Missing controls fall back to the map without a fake click.
Recommendation reuses the existing Study 3 measures layout. Director uses exactly
the human C/A weight presets (shared constant), and its selected card follows
confirmed controller events. Verify cursor/control alignment, C→A selection,
absence of the monitor widget, pause/takeover and UI/batch command parity.

Prepared demonstrations (November 2026): two launch cards on the start screen
select the existing small network, layout, operator, mode and profile and start
playback after session readiness. Recommendation uses the authored breakdown,
delayed response and an opening before the event. Director replaces explicit
weights at tick 12: native C `[2,2,5]` → A `[5,2,2]`. Recommendation uses the
existing `preset-recommendation-study3`; Director reuses `preset-director-three-zones`
so its map stays visible alongside the choices. Existing map focus makes the
relevant section readable.
The connected overlay provides a speech-bubble summary from pending/results/effective
events, including strategy or actual weights, logical time and acceptance status.
The last action remains visible while waiting; cancellation and errors win over
old success. No simulated thoughts, mouse paths or animation drive execution.
Both launches must pass in Chromium without editing any configuration, with
correct backend modes, real accepted commands and verified Director plan uptake.
Explicit Pause/takeover cancels a queued automatic start too.

Start a real short preset through Build your own with baseline or delayed response.
Compare the exported decisions and logical response times; repeat deterministically.
Pause with a pending decision, then take over: the command must never execute.
For Director goal switch verify controller weights and a committed plan, separately
from command acceptance. Inspect without assuming a psychological model.

## 7. Changes

New files: `backend/app/core/dispatcher.py` (runtime and adapters),
`backend/app/api/dispatcher.py` (observation, ownership, export),
`backend/app/dispatcher_batch.py` (browser-free driver), dispatcher tests and
examples; frontend dispatcher types, configuration and monitor components.

Modified files: session creation/models, `/step`, Play, state serialisation and
lifecycle; existing command gating; study metadata; Angular store and start flow;
widget host, palette, availability, catalog, translations and mode matrix.

Prepared-demo additions modify the dispatcher registry/API, frontend DTO/API,
start screen/store, existing monitor, translations, page objects and setup matrix.
The subsequent overlay revision removes that Context widget's registration and
reuses the existing native Apply/Commit controls. A read-only activity projection,
semantic target directive/registry and geometry observers locate visible controls;
existing toolbar buttons expose ownership and the optional event log. Native
A/B/C presets move unchanged to a shared backend constant. Human command paths,
policy algorithms and stored layouts stay intact.

## 8. Risks and boundaries

Single backend process, matching the existing in-memory session architecture.
No LLM calls, training, stress estimates, DOM automation or psychological claims.
Only public operator payloads enter decisions. Internal evaluator data is separate.
Scripted disturbances give controlled comparisons; random malfunctions may consume
randomness differently across courses. The timeline supplements existing Flatland
trajectory replay and is not itself a simulation snapshot/fork format.
