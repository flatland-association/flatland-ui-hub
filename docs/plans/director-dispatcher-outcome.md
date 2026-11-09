# Director demo: show the observed outcome

Date: 2026-11-09. Base: `c012ddd`. Scope: the existing prepared three-train
Director demo and its existing floating dispatcher bubble.

## Experience

After the checked candidate has been adopted and live execution advances, the
dispatcher says it is observing the outcome. Actual arrival updates show the
current count, including zero, without a simulated click or a presentation timer.
At the end, compare the execution check's expected arrivals with actual arrivals.
Show remaining arrival delay using its existing simulation-step unit and reference.
Only a genuinely complete, uninterrupted outcome receives the existing
alcohol-free shift sign-off, displayed after the outcome summary.

Partial completion, stopping, errors, manual intervention and unavailable
measurements must remain explicit. `finished` alone is not success. The saved
demo currently ends at step 82 with 3/3 arrivals and 42 summed arrival-delay
steps against the authored plan. These values are observations, not hardcoded UI.

No new widget, planner, backend field, polling, command, automatic playback or
large-incident claim is introduced. No saved-time or conflict-clearance claim is
derived from arrivals; the model's 97% utility is not an on-time-arrival rate.

## Data and lifecycle

- Add a read-only `outcome` projection to `DirectorComparisonService`, independent
  of its short-lived map-preview `snapshot`. Only a synthetic Director recipe
  with comparison enabled and an actually committed, accepted comparison for the
  current session qualifies. Failed/cancelled/pre-commit comparisons do not.
- Bind measured observations to `comparison.command_id` through the existing
  `effects` entry (`observed_since_command`, `causal_claim: false`). Never fall
  back to the latest unrelated effect. Reuse actor metrics for total services.
- Retain the outcome through terminal generation invalidation; a terminal
  snapshot may legitimately have a newer actor generation than its comparison.
  Session changes/reset/uncommitted comparisons release it. Validate integer
  counts, denominators and measurement steps; missing/invalid data is unavailable.
- The accepted candidate's validation supplies expected arrival counts; the
  matching effect supplies actual counts, step and delay. The initial step-one
  observation is not a completed outcome. Actual progress is event-driven.
- Preserve human ownership and stopped/error/offline/paused lifecycle feedback.
  A mixed run or intervening command keeps its measured progress but explicitly
  limits attribution; it does not receive an unqualified autonomous-success
  celebration. An observing browser only displays data.
- The compact result remains outside Details in the existing bubble. Reuse its
  left gutter so it leaves the map and native controls visible. Keep toolbar
  clearance, existing acknowledgement behavior and ordinary modes unchanged.
- Place the final sign-off below the real outcome. A partial terminal run gets
  a truthful result header instead of the generic celebratory finished message.
- Keep the existing workspace/map on automatic episode completion for this
  committed prepared synthetic Director comparison. The existing generic shift
  review would replace the map (observed in the first production check). An
  explicit End shift still opens that review; ordinary sessions and guided
  experiments retain their existing review lifecycle.
- Retaining the workspace must not trigger its ordinary pause-time three-option
  refresh at episode completion. Suppress that automatic refresh for a terminal
  prepared outcome; ordinary pause refresh and explicit Recompute stay intact.
- EN/DE/FR strings use existing i18n conventions, Swiss German and draft French.
  All existing click identifiers remain intact.

## New files

| File | Purpose |
| --- | --- |
| This plan | Bounded scope, data contract and acceptance |
| `docs/examples/dispatcher-agents/director-outcome/` | Actual production captures, measurements and build provenance |

## Modified files

| File | Change |
| --- | --- |
| `frontend/src/app/core/director-comparison.service.ts` and spec | Read-only typed outcome projection and lifecycle/data tests; existing command workflow unchanged |
| `frontend/src/app/features/dispatcher-agent-monitor/*` | Compact outcome, lifecycle-aware header, sign-off order and map clearance; component checks |
| `frontend/src/app/core/session.store.ts` and spec | Scope automatic shift-review replacement so a committed prepared Director result keeps its map; explicit End shift and ordinary sessions unchanged |
| `frontend/src/app/features/strategy-options/*` | Skip automatic three-option refresh after the retained prepared outcome ends; keep ordinary pause/manual planning unchanged |
| `frontend/public/i18n/{en,de,fr}.json` | Outcome messages and measured result labels |
| `frontend/e2e/dispatcher-comparison.spec.ts`, `e2e/support/pages.ts` | Extend real existing positive run with linked live/final outcome checks; preserve native proof and cancellation assertions |
| `docs/dispatcher-agents.md`, `docs/dispatcher-agents-results.md` | Behavior and actual verification results |

## Acceptance and verification

1. Before adoption there is no observed outcome. After actual adoption, progress
   and final measurements refer to its exact command, never a different one.
2. Actual intermediate counts and the real final 3/3 result are visible with
   Details closed. The terminal result precedes the existing shift sign-off.
3. Unit checks cover zero/intermediate/all arrivals, partial finished, missing or
   malformed measurements, missing expected data, manual/intervening commands,
   paused/offline state, terminal generation changes and session/reset changes.
   Outcome observation issues no API requests or controls.
4. Keep real map/control geometry, exact adoption, one-use resume and takeover
   assertions. No mocks invent native results. No sleeps, skips, retries or
   timeout increases. Follow the repository E2E skill: narrow then fast suite;
   preserve and report unrelated known failures. Readiness corrections already
   committed at the base remain intact.
5. Run affected frontend units, style/i18n and production build, inspect actual
   production screenshots, and record results honestly. Backend is unchanged;
   another backend gate is unnecessary. Publish the finished authorized branch
   and make the new build available locally without interrupting active runs.
