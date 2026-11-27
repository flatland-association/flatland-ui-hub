# Director: verified execution before objective optimisation

Date: 2026-11-08. Base: `1aa0c9c`. Follow-up to
[`director-large-shift-feasibility.md`](director-large-shift-feasibility.md).

## Scope and acceptance

The first milestone is a genuinely executable initial plan on
`pf-ch-corridor-stops`: all sixteen services arrive within the scenario horizon,
serve every mandatory intermediate stop in order and respect earliest departure
times and permitted destinations. A horizon timeout is a failure. No large
Director demo launcher is enabled until this milestone is demonstrated.

Every initial-plan path (learned search, cache, model-free fallback) must pass
the same real-physics, side-effect-free execution check. Residual plan adoption
must check the freshly reanchored, combined player state even for a directive
change that intentionally bypasses the improvement gate. Failure records an
explicit rejection; it must never silently retry an unverified fallback.
Immediately before adoption, compare the live step, reset generation, weights
and committed player/schedule identities with the proof's source. A stale
proof is not applicable. Keep a changed directive pending for the next action
boundary, and never cache a stale initial proof as permanently unroutable.

Reuse AI4REALNET's already vendored Prioritized Planning implementation. Add an
opt-in strict adapter that never trades away required stops. Existing
Recommendation behaviour remains unchanged. CBS is not currently vendored and
is outside this implementation. No new optimisation algorithm or model
training is authorised or needed for this first integration. Bounded priority
variants reuse the existing `replan_orders` procedure. Convert a PP result to
native schedules only when it is faithfully representable; real execution
validation remains mandatory. If no valid plan can be established, return an
explicit no-plan result, not an invented success.

### Large initial-plan construction order

The first public sixteen-train check spent almost its entire 120-second
operation budget in the original learned greedy search before reaching PP.
For an initial state (`_elapsed_steps == 0`) above `TRAINED_MAX_TRAINS` (eight,
the learned search's original training scope), construct strict PP candidates
first, validate their actual execution and rank only accepted candidates with
the existing weighted evaluator. A successful PP portfolio returns immediately
with PP provenance and no trace borrowed from a search that did not run.
If PP supplies no accepted candidate, retain the existing native search and
baseline path, without repeating the same PP construction after it fails.
Scenes with eight or fewer trains retain their existing construction order.
This is a measured performance routing decision using the same solvers and
execution gate, not a new optimiser or interaction mode.

Later milestones (not silently claimed by this change): incident recovery,
objective trade-offs, coalesced/background planning, ownership cancellation and
the fully narrated large demonstration. A valid initial plan alone does not
establish recovery from the four authored faults or future unknown incidents.

## New files

| File | Purpose |
| --- | --- |
| `backend/app/planners/plan_validation.py` | Clone and execute a candidate; check arrivals and mandatory mission constraints without changing the live session |
| `backend/app/planners/director_pp.py` | Strict use of the existing PP planner and faithful native-schedule conversion where possible |
| `backend/tests/test_plan_validation.py` | Actual execution and mission failure regressions |
| `backend/tests/test_director_pp.py` | Strict PP and native conversion checks |
| `backend/tests/test_director_schedule_timing.py` | Off-grid insertion timing, model features and capture/splice preservation |
| `backend/tests/test_director_execution_gate.py` | Cache/fallback rejection, objective-change admission and insertion replay |
| `docs/examples/dispatcher-agents/director-reliability/` | Actual native and session-path execution evidence |
| This plan | Scope, integration decisions, acceptance and measured limitations |

## Modified files

| File | Change |
| --- | --- |
| `backend/app/planners/replan.py` | Opt-in strict stop/target handling; preserve default Recommendation semantics |
| `backend/app/policies/goal_based_policies/search.py` | Admit only execution-verified final portfolio entries; explicit failure when none qualify |
| `backend/app/policies/goal_based_policies/schedule.py` | Native off-grid insertion bounds, without occupying the origin early |
| `backend/app/policies/goal_based_policies/dataset.py` | Propagate insertion bounds to edge timing and existing model features |
| `backend/app/policies/goal_based_policies/branching.py` | Preserve insertion bounds in search prefixes and planned arrival times |
| `backend/app/policies/goal_based_policies/replan.py` | Preserve bounds in captured pending/running schedules and joined tails |
| `backend/app/policies/goal_directed_policy.py` | Gate cache/fallback/initial and freshly spliced residual adoption; retain rejection evidence |
| `backend/app/api/sessions.py` | Do not report a no-plan or rejected residual adoption as replanned |
| `backend/app/core/dispatcher.py` | Keep unoptimised model-free PP fallback distinct from an effective objective directive |
| `backend/app/policies/goal_based_policies/step0_cache.py` | Invalidate old unchecked initial-plan caches if their contract changes |
| Relevant existing Director tests | Assert the new execution contract and preserve valid mode behaviour |
| `docs/dispatcher-agents-results.md` | Report measured first-milestone results and remaining limitations |

## Verification

Use serial, bounded experiments without neural planning to test strict PP on
the measured sixteen-service corridor. Check real stop completion, not only
arrival counts. Add tests for rejection of known bad plans, acceptance of a
genuinely valid small plan, live-state immutability, cached invalid plans and
weight-change adoption. Run the affected backend suites and then the normal
backend gate. Keep previous negative feasibility evidence intact. Record any
unmet milestone honestly rather than altering the timetable or skipping stops.

No mode semantics, trajectory compression, frontend recovery methods, scenario
refresh throttling or user sessions are modified.

## Explicit adapter decision: retain a whole mandatory mission

The strict existing PP adapter chains independent waypoint legs greedily. On
this corridor an early arrival at a first stop can leave no reservable onward
leg, even though delaying the off-grid departure makes the entire mission
feasible. The legacy adapter responds by skipping stops. A bounded temporary
probe instead retried the same complete mission from a later off-grid departure
using the unchanged upstream cooperative A*: 16/16 arrivals and 48/48 calls,
ending at step 181, with no early-departure or destination violations.

Integrate that adapter repair explicitly: strict mode may retry the whole
mission at up to 32 later departure instants, bounded by the real episode
horizon; an on-grid train must never be treated as waiting off-grid. This is
additional adapter control flow, not a new PP/CBS implementation. The upstream
solver stays unchanged and every result still needs actual execution proof.
The bound is a search budget, not a guarantee that all feasible plans are found.

Native schedules gain an optional absolute `ScheduleEntry.not_before` for
off-grid insertion only (default zero). The native player, snapshot replay and
PP converter retain it. Ordinary node waits keep their current meaning; waits
inside a reduced-graph edge remain unrepresentable and are rejected. New
training/scoring semantics are not claimed: model scores remain estimates,
while actual mission validity is checked independently.

For native Director candidates the strict graph adapter also filters wait
successors outside native decision/stop nodes. Move successors and the
upstream cooperative A* remain unchanged. This makes the physical PP plan
representable without moving a reserved wait to another occupied cell. A
bounded probe of this constraint retained all sixteen arrivals and 48 calls
at step 181. Mandatory directed stops use a temporary exact-heading goal
adapter, since the upstream solver normally matches only goal cells.

Additional modified file: `backend/app/policies/goal_based_policies/schedule.py`
(off-grid insertion bound and truthful future paths). Add native execution
regressions for delayed insertion and the full sixteen-service mission.

## Measured first milestone

The unchanged sixteen-service timetable now completes under the actual native
`SchedulePlayer`: **16/16 arrivals, 48/48 mandatory calls, end step 181/320**.
The natural-priority strict PP candidate took 1.058 s to construct and 0.430 s
to validate on this host. This is one priority order, not the entire learned
Director preparation time or a browser animation measurement. The source env
remained at step zero. No authored or random malfunctions were present.

[Recorded native execution](../examples/dispatcher-agents/director-reliability/initial-plan.json)
includes every service's obligations, actual arrival and candidate insertion
bounds, plus the relevant source hashes. The previous 1/16 and 2/16 negative
feasibility results remain intact as before-change evidence. Full disruption
recovery and incident-aware agent reasoning are still separate acceptance
milestones.

The normal session creation/weights/step functions, with installed learned
models and stability weights `[2,2,5]`, also complete the unchanged episode:
16/16 arrivals, 48/48 calls, step 181. In two measured uncached runs, the
learned-first preparation took 99.935 s and the PP-first preparation took
10.879 s, selecting `pp-2` in both cases. Subsequent complete episode stepping
took 1.432 s and 2.235 s respectively. These are individual host measurements,
not a latency guarantee or a browser animation test.

[Learned-first session path](../examples/dispatcher-agents/director-reliability/public-session-learned-first.json)
and [PP-first session path](../examples/dispatcher-agents/director-reliability/public-session.json)
record the actual service outcomes and admission reports. Future authored
incidents are not included in initial validation.

## Remaining fault-execution gap

A cheap fixed-plan control injects the same four authored faults into active
trains, without neural planning or any replan. The verified native schedule
then reaches only **5/16 arrivals and 36/48 calls** at step 320. The existing
`PlanPolicy`, executing the same original PP trainruns with absolute timing and
resource-order preservation, reaches **16/16 and 48/48 at step 181**. This is a
diagnostic control, not a native Director recovery feature.

[Fixed-plan controls](../examples/dispatcher-agents/director-reliability/fixed-plan-fault-controls.json)
record actual states/counters at all injections. A separate temporary check
removing the native player's premature wait-counter reset still reaches only
5/16, so that isolated change is not an established fix and was not applied.
The next stage should reuse the proven `PlanPolicy` execution mechanisms with
proper native progress/replay integration, rather than declaring the initial
plan proof to be a guarantee under subsequent faults.

## Final validation

The final source passed the normal complete backend gate with **814 passed,
25 skipped** (`pytest -q -n 2`, slow/training tiers disabled), after adding
stale-proof, generation, directive and plan-replacement regressions. The actual
slow initial-cache reuse test also passed separately. Ruff passes for all new
Python modules/tests; legacy lint findings were not reformatted wholesale.

A final isolated replay through the normal session functions after those
guards again completed **16/16 services and 48/48 calls at step 181**. Initial
planning took **5.768 s**, and complete episode stepping **1.071 s** on this
run. [Final session evidence](../examples/dispatcher-agents/director-reliability/public-session-final.json)
records source hashes and dependency versions. The earlier 10.879 s result is
retained separately; these host-dependent measurements are not guarantees.

No new frontend presentation, model training or complete four-fault Director
recovery is claimed. Existing small demos keep their current launch recipes.
