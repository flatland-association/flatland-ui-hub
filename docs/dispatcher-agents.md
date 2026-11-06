# Synthetic dispatchers

These are deterministic test strategies for the operator role. They do not model
human psychology and do not replace the algorithm driving the trains.

| Profile | Recommendation | Director | Parameters |
|---|---|---|---|
| Cooperative Baseline | Accept the existing preferred contention strategy | Set and maintain explicit weights | Initial weights in Director |
| Delayed Response | Same choice, after logical delay, with reference revalidation | Delay the initial directive while the controller continues | Delay; initial weights in Director |
| Priority-Based | Existing PP alternative for explicit train order | Existing punctuality / connections / stability objective | Train handles or objective |
| Goal-Switch | Unsupported | Replace the global directive; verify committed plan weights | Initial/replacement weights; switch time, minimum 2 |

Co-Learning is unsupported. Director needs the installed objective-aware controller models, an enabled `goal_directed` policy and
a scenario the existing planner can solve. Unavailable plans produce an explicit
technical error, never an effective-goal event. Priority falls back to the
preferred strategy when the configured order cannot be assessed or PP supplies
no corresponding alternative; the decision records that fallback.

[Measured demonstration and exports](dispatcher-agents-results.md).

## UI

For a prepared demonstration, use either **Recommendation demo** or **Director
demo** on the start screen. One click selects the small Walensee network, appropriate
layout, mode, operator and profile and starts playback when the session is ready.
Recommendation uses the existing Study 3 measures layout, opens shortly before
the authored breakdown and accepts the preferred strategy after three decision
ticks. Director uses the existing three-zone layout. It selects the native C
(stability) preset `[2,2,5]`, then A (punctuality) `[5,2,2]` at tick 12. These
presets are shared with the human controls; it uses the existing objective-aware
planner.

A speech bubble floats over the existing interface, connected to the actual
Apply/Commit control. Its visual cursor marks that control; it never moves the
user's mouse or issues a second command. The existing action card opens and
scrolls into view for the current decision, without moving keyboard focus. The
native Director selection follows confirmed controller plans; Recommendation
shows its accepted native action as applied. Missing or hidden controls fall
back to the map without inventing a click. Waiting preserves the last action;
cancellation, errors and human ownership take precedence.

A small SVG dispatcher/headset portrait in that same bubble shows the current
lifecycle separately from the latest command. Observing, preparing alternatives,
a scheduled response, awaiting plan confirmation, pause, human ownership, finish,
stop, errors, disconnection and stale state updates have explicit labels. The
simulation step and age of the last actual received state remain visible. An
open socket alone is not a progress signal; reconnect waits for a current state.
When the native Director options are loading, the bubble reuses their existing
planning progress/count and elapsed wait, without another polling loop. There is
no stress estimate or fictional percentage. French additions are draft copy
pending native review.

The portrait gives one brief pulse after a new server state; reduced-motion
preferences disable it. The age timer changes presentation only. Pure observation
has no command cursor. The last actual action survives pause, takeover and loss of
updates, and remains distinguished from current activity.

The overlay reads structured runtime events. Backend commands use the same
validated domain operations as the human controls; this is not DOM automation.
Neither cursor nor speech presentation advances the execution clock. Collapse
the speech to inspect the underlying interface.

Start the app as described in the main README. In **Build your own**, select a
network, a layout and **Operator → Synthetic dispatcher**. Select the mode,
profile and its parameters. The resolved operator condition appears before Start.
Default remains Human; experiment conditions and tours do not enable agents.

For the small demonstration, press **Load synthetic test setup**. This explicitly
selects the existing long-approach scenario and its authored E1 breakdown at Weesen;
human start configurations and tour definitions stay unchanged. Run once with Baseline
and again with Delayed Response, delay 3. Use the existing Play / Pause controls.

Ownership, takeover and the optional **Event log** button live in the existing
toolbar. There is no additional monitor widget, persistent monitor panel, palette
entry or saved-layout slot. The on-demand log shows observations, pending command,
due logical time, rule, results and chronological events, with JSON export.
Train rings distinguish planned (dashed), executed (solid) and
cancelled/rejected/stale (dotted) actions. Saved human layouts remain unchanged.

**Human takes over** stops playback and cancels pending work immediately. Merely
inspecting the interface does not take over. Manual domain commands while the
agent owns the role return `dispatcher_owns_role`; **Delegate to dispatcher** is
explicit and observes afresh. Reset, restart, mode change, stop and end invalidate
the generation. Profile parameters require a new session. Synthetic runs have no
agent-generated questionnaire answers; mixed runs are labelled separately.

## Clocks and execution

A pulse observes → plans → validates the original reference → executes if due →
advances Flatland. One pending command per role. Time alone does not invalidate
a recommendation; a changed alternative or situation does. Duplicate delivery
returns the original result. No DOM, image recognition, animation or browser
timer takes part. Multiple readers never create additional execution loops.

Recommendation holds Flatland at an open decision while response pulses advance.
The delay therefore measures interaction latency, **not operational train delay**.
Director continues its autonomous controller during a delayed response. Explicit
Pause advances neither clock; pressing Step explicitly advances one pulse.

The existing Director replanner runs synchronously at logical boundaries for
synthetic sessions, including automatic malfunction replans. Both UI and batch
use that schedule; human sessions keep their existing asynchronous schedule.
Command acceptance and `directive_effective` are separate events; the latter
requires matching weights in an actual committed controller plan.

## Batch and exports

From `backend/`, with the normal development dependencies installed:

```bash
ONLINE_LEARNING_AUTOSTART=0 python -m app.dispatcher_batch \
  examples/dispatcher-comparison.json --output /tmp/dispatcher-comparison
ONLINE_LEARNING_AUTOSTART=0 python -m app.dispatcher_batch \
  examples/dispatcher-variants.json --output /tmp/dispatcher-variants
pytest -q tests/test_dispatcher.py
pytest -q --run-slow tests/test_dispatcher.py
```

Batch uses the same session creation, `/step` implementation, agent runtime,
validations, disturbances and Flatland recorder as the UI. Configurations are
validated `SessionCreateRequest` objects; each gets an isolated session. Add
`"interaction_mode":"director"` and e.g.
`"dispatcher":{"profile":"goal-switch","switch_at":5}` for the goal-change
example. No external LLM service or training is required.

**Export synthetic run** downloads the complete operator timeline. The backend
stores the same `dispatcher.json` alongside the existing study-session records.
It includes creation config, seed, disturbances, source/model/scenario/profile
versions, operator type, command origins, technical result, simulation result and
abort reason. `STUDY_TRAJECTORIES_ENABLED=1` additionally records the existing
Flatland trajectory for replay; the operator timeline is not a full replay.

`comparison.json` lists every batch run, including rejected configurations and errors.
Batch continues with subsequent configurations and exits nonzero if any run is incomplete. There is no aggregate
that treats failed runs as zero performance. A pulse limit means incomplete;
reaching the simulation horizon does not assert a deadlock.

Metric definitions:

- Opportunities: distinct visible contention identities or configured directive
  phases observed. Planned: emitted commands; retries/cancellations remain visible.
- Executed/stale/rejected/cancelled/unsupported: terminal results per command ID.
- Response ticks: execution pulse minus observation pulse, executed commands only;
  mean denominator is their count. No response yields unavailable, not zero.
- Effective directives: accepted directives evidenced in a controller plan;
  effective goal changes count the replacement phase, excluding the initial one.
- Arrivals: actual DONE transitions. Arrival delay is non-negative actual arrival
  minus the original scenario timetable, only trains with both values; the export
  gives that denominator. No timetable/arrival reference means unavailable.

Scripted disturbances fix future events independently of profile behaviour.
Random malfunctions are seeded, but different controller courses can consume
randomness differently; equal seeds alone are not a controlled causal comparison.
Ignore session IDs when comparing deterministic event timelines. These technical
tests establish neither scientific validity nor correspondence to human behaviour.

## Extension points

Add a profile to `core/dispatcher.py`'s `PROFILES` and immutable `DispatcherConfig`,
then extend `choose(observation)` using only the public operator payload. The UI
reads compatibility from that registry; add its parameter form and EN/DE/FR text.
The French strings are drafts awaiting native review.

A mode adapter supplies `observe`, selection and a command implementation that
calls the existing human domain function. Keep reference validation, generation,
ownership and deduplication in `execute`. Add gating tests and a real scenario.

A future LLM adapter can replace selection behind this same seam: validate a
structured command, bound calls/timeouts, record fallback and reject unknown IDs.
Its generated explanation is not evidence of hidden reasoning, and live LLM runs
must be labelled nondeterministic. No provider connection is part of this MVP.
