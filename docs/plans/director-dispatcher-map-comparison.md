# Prepared Director: compare an actual native plan before adoption

Date: 2026-11-09. Base: `edcc861`. Scope: existing small prepared Director demo,
the existing map, native strategy controls and floating dispatcher bubble.

## User experience and scope

The initial C/stability plan runs to the opening at step one. Before the second
directive, hold the simulation and logical clock at a real decision checkpoint.
Prepare one native A/punctuality candidate with the existing residual planner
and execution validator. Show the current plan, then the genuinely different
candidate on the existing map. Explain actual route/hold counts and available
forecast differences. Adopt that same checked candidate exactly once, confirm
native uptake, and resume through the existing Play path.

Only this opt-in opening defers policy construction until the dispatcher's
initial C directive is installed. It avoids computing and discarding a neutral
plan before the actual initial plan; ordinary session construction is unchanged.

The guided comparison is a one-shot opening for the fully synthetic run. Human
takeover permanently marks the run as mixed and revokes its old comparison and
resume capabilities. After explicit delegation and Play, ordinary Director
autonomy continues without opening another comparison. Replaying the guided
comparison requires starting a fresh prepared demo.

Only the prepared Director recipe opts in; its switch is brought forward to
logical tick two, giving a short, real opening-step comparison. Existing human
sessions, ordinary dispatcher profiles, Team consent and Recommendation retain
their existing contracts. This does not implement large-Director incident
recovery, a new planner, two full-episode replays, or a time-distance overlay.

The measured current public step-one options have real A reroutes for handles
0 and 2. The initial public forecast is better on both punctuality and stability,
and contains no connections. This is evidence for drawable geometry, not an
execution proof or justification for inventing a sacrifice or saved connection.
The exact candidate still needs native execution validation before presentation.

## Architecture and contract

- Add an explicit default-off prepared-comparison setting to DispatcherConfig.
  A pending switched directive with this setting creates one comparison hold;
  repeated reads/steps must not advance the logical clock or simulation.
- The backend owns the hold and stops its Play loop without a spin. A browser
  observer cannot create/release commands merely by reading snapshots.
- A dedicated prepare endpoint binds the actual pending command/session,
  generation, simulation step, current weights, control revision, complete
  schedules and native player snapshot. Reuse native residual preparation and
  real-physics validation; cache the native candidate, not merely its numbers.
- Expose `comparison` on dispatcher snapshots with `phase`, `session_id`,
  `command_id`, `generation`, `step`, opaque `token`, `current`, `alternative`,
  `validation` and optional `reason`. `current` supplies weights and actual
  paths; utilities/reported stay null without a same-checkpoint evaluation.
  `alternative` uses the existing
  DirectorStrategy shape (id, weights, plan, paths, divergence).
- Prepare body: `{command_id, generation}`. Commit body adds `token`. A fresh
  valid token adopts the exact prepared native candidate through the existing
  execution/mission gate. Repeated commit returns the original result without
  another command. Invalid/stale/unavailable candidates cannot change weights.
- An unavailable/identical/undrawable candidate gets an explicit explanation,
  no fictional preview or commit. Changed schedules and drawable native
  divergence are required; changed-count alone does not mean rerouting.
- Reset, ownership, mode/session changes and explicit playback interruption
  cancel automatic comparison. Late prepare/timer/commit responses cannot
  revive a cancelled comparison or resume playback after a human interruption.
- A frontend domain coordinator orchestrates only the browser that explicitly
  launched this prepared demo. Other viewers remain read-only. It uses timed,
  readable presentation stages after actual plan readiness, then the guarded
  commit and existing Play API. Display/age/portrait timers remain read-only.
- The existing Play request accepts an optional `comparison_token` for that
  automatic resume. The backend checks a separate, revocable post-adoption
  capability (session, generation, step, player/plan and controls) before any
  Play side effect. Explicit pause, takeover or other controls revoke it even
  after commit. A dispatched but delayed resume therefore cannot undo a later
  human pause. Commit idempotence remains separate from this one-time resume.
- Reuse map preview paths/divergence and native strategy tiles. Suppress their
  normal all-three-options load while this bounded comparison owns the surface.
  Preparation shows factual busy/progress; current and candidate remain labelled
  forecasts, and adoption is shown only after confirmed native installation.
- Suppress ordinary option loading already in the initial `ready` actor state.
  For this recipe only, finish opening at its configured positive step even
  before a train moves, then issue normal Play. This avoids stepping into the
  comparison hold while the generic opening loop still waits for movement.
  Explicit recipe options take precedence over the reusable Build form draft.
- The bubble uses concise EN/DE/FR strings. No extra widget/panel or physical
  mouse automation. All existing do-not-touch methods remain untouched.

## New files

| File | Purpose |
| --- | --- |
| This plan | Scope, evidence, contracts and acceptance |
| `backend/app/core/director_comparison.py` | Frozen comparison state/candidate orchestration |
| `backend/tests/test_director_comparison.py` | Real gate, stale/cancellation/idempotence/exact-candidate coverage |
| `frontend/src/app/core/director-comparison.service.ts` and tests | Explicit-launch-only presentation/commit lifecycle |
| Evidence under `docs/examples/dispatcher-agents/director-comparison/` | Actual production captures/export/build provenance |

## Modified files

| File | Change |
| --- | --- |
| `backend/app/core/dispatcher.py` | Opt-in recipe, pending directive hold and lifecycle/snapshot integration |
| `backend/app/api/dispatcher.py` | Scoped prepare/commit routes and middleware permissions |
| `backend/app/api/websockets.py`, `sessions.py` | Hold stops playback/batched stepping; native prepared-plan seams |
| `backend/app/policies/goal_directed_policy.py` | Reuse/split existing native residual preparation/adoption if needed |
| `frontend/src/app/core/{dispatcher,models,api.service,session.store}.ts` | Typed comparison contract and explicit local launch intent |
| `frontend/src/app/app.component.ts` | Keep the prepared comparison opt-in out of the reusable Build form draft |
| `frontend/src/app/features/strategy-options/*` | Present frozen native option with existing map/controls |
| `frontend/src/app/features/dispatcher-agent-monitor/*` | Existing bubble comparison stages and actual explanation |
| `frontend/src/app/features/flatland-map/flatland-map.component.html` | Test IDs/attributes on existing real Director paths and branch/hold marks only |
| `frontend/public/i18n/{en,de,fr}.json` | Source/localised copy, preserving existing click IDs |
| Relevant existing backend/frontend tests | Preserve ordinary profiles/modes and ownership behaviour |
| `frontend/e2e/support/pages.ts`, Director E2E spec | Real scoped comparison, geometry/adoption and interruption |
| `docs/dispatcher-agents{,-results}.md` | Measured behaviour and remaining limits |

## Acceptance and checks

1. On the native small prepared recipe, capture current and alternative paths
   at one unchanged step and show actual reroute/hold marks on the existing map.
2. No command or weights change occurs during comparison. On commit the exact
   displayed candidate is installed once; accepted and effective events and
   resulting paths/weights are verified independently of the visual cursor.
3. Human takeover, reset, stale step/plan, invalid token, missing/identical plan
   and duplicate requests cannot produce a late write or automatic resume.
4. Ordinary Human/Team/Recommendation profiles and read-only viewers retain
   their behaviour. Native pause remains authoritative.
5. Run affected unit/backend gates, style/i18n/production build; use the local
   e2e-tests skill, a bounded native production Director browser check and the
   fast suite. Preserve unrelated known failures and budgets. Record timing
   separately from readability intervals and archive failed evidence honestly.
