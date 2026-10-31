# Widget spec — Staged Dispositions (`staged-dispositions`)

Part of the Kolb Co-Learning tour ([`colearning-kolb-tour.md`](colearning-kolb-tour.md)).

## 1. Identity
- **Name:** Staged Dispositions (Vorgemerkt)
- **`kind`:** control
- **`granularity`:** detail
- **Default zone:** right
- **Panel `type`:** `staged-dispositions`
- **Catalog id:** new
- **Source(s):** [DB], Kolb (experiential learning)
- **Grounding reference:** control-room practice: a disposition is prepared,
  checked and then released, rather than taking effect on the first click. Kolb:
  stating an expectation before acting turns the outcome into an observation
  (reflective observation) instead of a surprise.
- **Source origin:** from-scratch, deliberately. The release goes through
  `TrainActionService`, the single doorway for train actions.

## 2. Promise
> Prepare a hold or release for a train, say what you expect, release it, and
> later see what actually happened against that expectation.

## 3. Per-mode behaviour
- **Recommendation (WP 3.1):** staging and release; the expectation is optional.
- **Co-Learning (WP 3.3):** the expectation (less / same / more delay) is
  **required** before release. After release the entry shows expected vs actual.
- **Director (WP 3.4):** not offered: the AI acts there, the human sets directives.

## 4. System interaction
- **Data in:** `store.selectedHandle()`, `store.agents()`, `CurrentDelayService.minutes()`,
  `store.elapsedSteps()`, `store.interactionMode()`.
- **New:** `StagedDispositionService` (root): `entries` signal with
  `{ id, handle, action: 'hold' | 'proceed', expectation, stagedAt, releasedAt, delayAtRelease }`.
  Reset on a new session.
- **Actions out:** `TrainActionService.set(handle, 4, 'staged')` (hold) or
  `.clear(handle, 'staged')` (proceed). New `ActionOrigin` value `'staged'`, so the
  decision log records where the decision came from.

| Field / capability | Available now | To build (flagged) |
|--------------------|:-------------:|:------------------:|
| Hold / release one train | ✓ (`TrainActionService`) | |
| Expectation before release | ✓ (frontend, this widget) | |
| Expected vs actual (delay at release vs now / at arrival) | ✓ (derived) | |
| Intercept other panels' decisions into the queue | | ✓ (flagged: changes the decision flow) |
| Persist expectations with the run | | ✓ (flagged: backend endpoint) |

## 5. Allocation & accountability touchpoints
- **Loop stage:** decision
- **Owner per mode:** human (Recommendation, Co-Learning).
- **Decision events emitted:** the release writes the normal decision-log entry
  via `setOverride` / `clearOverride`, origin `staged`.

## 6. Acceptance scenario
> Co-Learning. The participant selects the follower, stages "hold", picks
> "more delay" as expectation and releases. The decision log has one entry with
> origin `staged`; ten steps later the entry shows expected "more" and actual
> "+4′". Success: every release in Co-Learning carries an expectation (Q3 / Q5).

## 7. Effort & changes
- **Effort:** M
- **Files:** `features/staged-dispositions/*`, `core/dispatch/staged-disposition.service.ts`,
  `core/dispatch/train-action.service.ts` (origin), registration seams, i18n `staged.*`,
  `core/demo/tour-guide.service.ts` (the tour's `expect` step).

## 8. Open questions / risks
- The other decision surfaces (proposal-compare, map pills) still act at once. Routing
  them through the queue is the next step and needs a decision on the flow.
- Expectations live in the browser for this cut.
