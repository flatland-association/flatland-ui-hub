# Widget spec — Track Occupancy (`track-occupancy`)

Part of the Kolb Co-Learning tour ([`colearning-kolb-tour.md`](colearning-kolb-tour.md)).

## 1. Identity
- **Name:** Track Occupancy (Gleisbelegung)
- **`kind`:** context
- **`granularity`:** overview-detail
- **Default zone:** center (a tab of `view-tabs`, beside Streckenspiegel and ZWL)
- **Panel `type`:** `track-occupancy`
- **Catalog id:** new
- **Source(s):** [DB]
- **Grounding reference:** control-room practice: the platform occupancy plan,
  one row per station track, showing who stands there now and who is due next.
- **Source origin:** from-scratch, deliberately. Station tracks come from the
  scene geography (`/hmi/geography`), the timetable from `/hmi/plan`.

## 2. Promise
> See per station which track is occupied now and which train is due next on it,
> so a platform conflict is visible before the trains meet.

## 3. Per-mode behaviour
- **Recommendation (WP 3.1):** occupancy now and next, read-only.
- **Co-Learning (WP 3.3):** the same. Highlights a track when two trains are due on
  it within the conflict window, without saying which should yield.
- **Director (WP 3.4):** the same, as supervision.

Clicking a train selects it (navigation). **Changing a train's track** is the
centre zone's partial manipulation, planned but not in this cut: there is no
per-train target-track override in the backend yet (flagged, not faked).

## 4. System interaction
- **Data in:** `store.geography()` (stations with `track` and `cell`),
  `CurrentDelayService.plan()` (planned cell visits), `CurrentDelayService.minutes()`,
  `store.agents()` (positions), `store.elapsedSteps()`.
- **Actions out:** `store.toggleAgentSelection(handle)`.

| Field / capability | Available now | To build (flagged) |
|--------------------|:-------------:|:------------------:|
| Station tracks and their cells | ✓ (geography) | |
| Who stands on a track now | ✓ (agent positions) | |
| Next planned use, shifted by delay now | ✓ (derived) | |
| Forecast occupancy from the contentions branch | | ✓ (flagged) |
| Change a train's target track | | ✓ (flagged: backend override) |

## 5. Allocation & accountability touchpoints
- **Loop stage:** context
- **Owner per mode:** n/a, it reads.
- **Decision events emitted:** none in this cut.

## 6. Acceptance scenario
> Walensee, both eastbound trains are due on WAL 2. The track shows both, with a
> clash marker once their expected arrivals fall within 3 steps. Success: the
> participant points to the clash in the occupancy view (Q5).

## 7. Effort & changes
- **Effort:** S–M
- **Files:** `features/track-occupancy/*`, `features/view-tabs/center-views.ts`,
  registration seams, i18n `trackOcc.*`.

## 8. Open questions / risks
- "Expected" shifts the plan by the delay now; it is a proxy, not a forecast.
- Pass-through cells count as a use of one step; long dwell only shows from the plan.
