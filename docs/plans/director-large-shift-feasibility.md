# Feasibility: a large Director shift with a dispatcher agent

Date: 2026-11-08. Base: `b862a09`. Scope: measured feasibility, not a new public demo launcher.

## Intended experience

Show sixteen corridor services recovering from disruptions while a digital
dispatcher uses high-level punctuality, connections and stability directives.
Use the existing map, timetable, native strategy controls and floating speech
bubble. Distinguish the dispatcher's goal choice from the controller's route
planning and from subsequent measured traffic outcomes.

## Questions and acceptance criteria

| Question | Evidence required |
| --- | --- |
| Can the existing Director complete the shift? | All 16 trains actually arrive; reaching the 320-step horizon is not success. |
| Do the disruptions really affect traffic? | Record each event, the affected train's state/position and its actual malfunction counter at injection. An event on an already arrived train is not a live disruption. |
| Does the agent's goal change matter? | Record accepted/effective weights separately from changed routes/holds and actual arrivals, waiting and connections. |
| Is it fluid enough to present? | Measure initial preparation and every planning/step gap separately. Target regular live updates around one second, no unexplained inactivity beyond three seconds, and explicit activity throughout longer computation. |
| Is it still controllable? | Measure event-loop responsiveness separately from paused simulation time; identify whether pause/ownership must wait for a computation boundary. |
| Is there a demonstrated benefit? | Compare the same seed, initial goal and authored faults with constant stability versus a prepared change to punctuality. Report equal or worse outcomes honestly. |

The initial controlled conditions use `pf-ch-corridor-stops`, seed 42, random
malfunctions disabled and `corridor-shift-incidents`: simultaneous train delays
at step 25, then further delays at 75 and 110. The candidate changes from the
existing C goal `[2,2,5]` to A `[5,2,2]` at logical tick 26. This is an explicitly
prepared schedule, not a claim of incident-aware agent reasoning. The current
agent observes only goal weights in Director; the native controller independently
detects malfunctions and replans.

The four existing events last 10–14 steps. They must earn the description of a
major disruption through their measured impact; a severity label is insufficient.
Current-state forecast forks do not include later session-scripted events, so
actual paired episodes are needed for the full-shift comparison.

## Method

Use unchanged public session creation, stepping and export paths with installed
models. Run native planning serially (`DIRECTOR_PARALLEL=0`,
`OMP_NUM_THREADS=1`) in an isolated process. Log operation durations, initial
plans, residual replans, actual injection states and actual train outcomes.
Keep explicit per-operation and total watchdogs; archive partial/failed runs as
such. Separate cold import/font setup from planner time and distinguish cold
model start from a subsequent warm condition.

Only one heavy planner experiment runs at a time. Existing user sessions and
machine power settings are left alone. No new optimisation algorithm or model
training is part of this check.

## New files

| File | Purpose |
| --- | --- |
| This plan | Scope, criteria, method and measured conclusion |
| `backend/examples/dispatcher-director-feasibility.json` | Reproducible constant-goal and prepared goal-switch conditions |
| Selected files under `docs/examples/dispatcher-agents/director-feasibility/` | Real timing/episode evidence, including bounded failures where applicable |
| Temporary instrumented scripts under `/private/tmp/director-feasibility-20261108/` | Measurement only; no production behaviour changes |

## Modified files

| File | Change |
| --- | --- |
| `docs/dispatcher-agents-results.md` | Link the measured feasibility conclusion and its limitations |

Production planner, dispatcher selection, launch controls, mode semantics,
trajectory/recovery methods and scenario refresh throttling are not modified by
the initial experiment. Any subsequent corrective prototype needs its own
explicit changes and before/after evidence.

## Results

**Decision: the current 16-train Director execution is not ready for the
requested smooth, successful disruption-management demonstration.** The
experiment completed without changing application code or training models.

### Actual traffic outcomes

All runs used the same corridor, seed and 320-step horizon. The two native cases
used the existing public session/step API functions and installed checkpoints.
The cheap replay controls used existing schedules and actual StationAwareRailEnv
physics, with model loading and optimiser calls guarded against execution.

| Executed condition | Arrived | Result |
| --- | ---: | --- |
| Native Director, constant stability `[2,2,5]`, four faults | 1/16 | Horizon reached; remaining trains blocked |
| Native Director, stability then punctuality `[5,2,2]` at tick 26, four faults | 2/16 | Horizon reached; remaining trains blocked |
| Captured stability start plan replay, no faults | 1/16 | Start plan already fails |
| Same captured plan replay, four faults | 1/16 | Matches every native baseline train state over all 320 steps |
| Exact existing balanced `[1,1,1]` cached start plan replay, no faults | 1/16 | No viable cached-start shortcut established |
| Same balanced cached plan replay, four faults | 1/16 | Same failure |
| Existing `plan_all_lines` baseline replay, no faults | 1/16 | Not a viable portfolio fallback |
| Existing `plan_avoiding_overlaps` baseline replay, no faults | 0/16 | Not a viable portfolio fallback |

The native start schedules and all train states through step 25 match between
the constant-goal and goal-switch conditions. All four authored faults affect
trains that are still active, so the negative result is not an incident firing
after its train arrived. A zero arrival-delay total in the native export covers
only the one or two arrived trains and is not a successful service outcome.

### Fluidity

| Measurement | Observed |
| --- | --- |
| Ordinary API-step median | 21–26 ms |
| Actual initial stability planning | 38–43 s; first API step 38–45 s |
| Residual replanning | Approximately 37–43 s |
| Largest simulation-step pause | 75.34 s at the first fault/goal change |
| Asyncio heartbeat peak delay during the threaded native cases | 116–136 ms |

The 75-second step contains a goal replan followed immediately by a malfunction
replan, approximately 37.7 and 37.5 seconds. The event loop remains comparatively
responsive while simulation movement pauses at the synchronous planning
boundary. This is not a browser frame-rate or takeover-latency measurement.
An initial 61-second import/font-cache cold start was recorded separately and
excluded from planner/step timing; the subsequent process imported in about
2.5 seconds. Neither the 120-second single-operation nor the 600-second combined
native-experiment watchdog was exceeded.

### Failure localisation

In the fault-free replay, h12 enters `[0,71]` eastbound at step 30 and waits;
h1 approaches westbound and reaches `[0,72]` at step 41. They then block on
adjacent cells. The stored plans already predict the opposing conflict: h1's
route is `87 -> 84 -> 79 -> 71`, while h12's is
`71(wait 10) -> 79(wait 5) -> 84 -> 87`. Their nominal occupancy of cell 72
coincides even before the simulator's common one-step insertion offset.

A bounded source diagnostic found no obvious reversed direction or duplicate
earliest-departure application explaining that first block. The existing
`has_planned_overlap` check returns true for all four examined initial plans:
captured stability, balanced cache, Lines and Avoidance. The native search
prefers conflict-free candidates but permits conflicting candidates when none
are conflict-free (`branching.py:357`, `search.py:213`). The final portfolio
selection has no hard actual-execution acceptance gate (`search.py:673`).
A hard check would reject these plans honestly; the cheap baseline probes did
not establish a valid alternative that it could simply select.

The goal change is genuinely accepted by the controller and changes committed
route-node sequences for h6 and h14. That does not establish successful
execution. Native `changed:16` includes changed plan tails/waiting and must not
be narrated as sixteen reroutings.

### Consequences for the intended demo

1. Establish an executable initial Director plan and disruption recovery on this
   corridor, using the existing planner/physics checks and upstream solver
   interfaces. Require all 16 arrivals before presenting it as a success case.
2. Then address the 37–75 second in-run pauses: consider recipe-specific initial
   precomputation, coalescing planning reasons and the existing background
   replanner, with truthful accepted/planning/applied states. None of these alone
   repairs an invalid starting plan.
3. Extend the agent's observation/selection with actual incident and KPI context.
   Its present two-phase schedule cannot demonstrate incident-aware reasoning.
   Explain real controller outcomes in the existing bubble/map, including a
   justified decision to continue a current plan.

The earlier 2–4 day presentation estimate assumed a working Director plan. That
assumption failed this check. The planner/execution defect must be isolated and
resolved before a reliable complete-demo estimate is available. No new large
Director launcher was enabled by this feasibility experiment.

### Evidence and reproduction

[Native findings](../examples/dispatcher-agents/director-feasibility/findings.json),
[operation timings](../examples/dispatcher-agents/director-feasibility/summary.json),
[captured-plan controls](../examples/dispatcher-agents/director-feasibility/replay-diagnostic.json),
[balanced-cache controls](../examples/dispatcher-agents/director-feasibility/positive-control.json),
[bounded portfolio checks](../examples/dispatcher-agents/director-feasibility/bounded-portfolio-baselines.json),
[initial plan nodes](../examples/dispatcher-agents/director-feasibility/captured-initial-plan-nodes.json),
[runtime/model provenance](../examples/dispatcher-agents/director-feasibility/provenance.json)
and [artifact hashes](../examples/dispatcher-agents/director-feasibility/manifest.json).

The public native conditions can be repeated from `backend/` with the existing
CLI; its failure exit status is expected while arrivals remain incomplete:

```bash
DIRECTOR_PARALLEL=0 OMP_NUM_THREADS=1 python -m app.dispatcher_batch \
  examples/dispatcher-director-feasibility.json \
  --output /tmp/director-feasibility-repeat --max-pulses 320
```

The instrumented temporary scripts additionally capture per-operation time and
replay diagnostics. No successful traffic outcome, fluid live demo or scientific
agent-performance improvement is claimed by these failed conditions.
