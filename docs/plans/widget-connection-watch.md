# Widget spec — Connection Watch (`connection-watch`)

Part of the Kolb Co-Learning tour ([`colearning-kolb-tour.md`](colearning-kolb-tour.md)).

## 1. Identity
- **Name:** Connection Watch (Anschlüsse)
- **`kind`:** context
- **`granularity`:** overview
- **Default zone:** right
- **Panel `type`:** `connection-watch`
- **Catalog id:** new
- **Source(s):** [DB]
- **Grounding reference:** control-room practice: connection monitoring, where a
  feeder train's arrival is checked against the departure it should reach, with
  the remaining transfer reserve.
- **Source origin:** from-scratch, deliberately.

## 2. Promise
> See which connections are at risk and how much reserve is left, before deciding
> to hold or release a train.

## 3. Per-mode behaviour
- **Recommendation (WP 3.1):** connections with reserve and status.
- **Co-Learning (WP 3.3):** the same, neutral: no "hold" advice. The reserve is
  the fact a rule in the Kolb tour's AC phase refers to.
- **Director (WP 3.4):** not offered; connections are an objective there, not a list.

## 4. System interaction
- **Data in:** `CurrentDelayService.plan()` and `.minutes()`, `store.agents()`
  (`initial_position`, `target`, `stops`), `store.stationLabelForCell()`.
- **Derivation (first cut):** a connection is a pair where train A's planned
  arrival at a station and train B's planned departure from the same station
  (same station name, any track) are `0 < gap ≤ 15` steps apart. Reserve now =
  gap − A's delay now + B's delay now.
- **Actions out:** none (selection only).

| Field / capability | Available now | To build (flagged) |
|--------------------|:-------------:|:------------------:|
| Planned arrivals and departures per station | ✓ (`/hmi/plan`, agent stops) | |
| Connection pairs derived from the plan | ✓ (derived, labelled as such) | |
| Real connection data in the scenario | | ✓ (flagged: not in the `flatland-scenarios` format) |

## 5. Allocation & accountability touchpoints
- **Loop stage:** context
- **Owner per mode:** n/a.
- **Decision events emitted:** none.

## 6. Acceptance scenario
> A scenario where a feeder arrives 4 steps before a departure at the same
> station. The feeder gets 3 steps late; the row turns "at risk" with reserve 1.
> Success: the reserve shown equals the plan gap minus the delay (unit-checked).

## 7. Effort & changes
- **Effort:** S
- **Files:** `features/connection-watch/*`, registration seams, i18n `conn.*`.

## 8. Open questions / risks
- **The Walensee tour scenario has no such pair**, so the widget shows its empty
  state there and says why. Real connection data should come from the scenario
  format (to clarify with flatland-scenarios) rather than be invented here.
- Window of 15 steps and the 2-step minimum transfer time are assumptions.
