# Widget spec — Deviation Radar (`deviation-radar`)

Part of the Kolb Co-Learning tour ([`colearning-kolb-tour.md`](colearning-kolb-tour.md)).

## 1. Identity
- **Name:** Deviation Radar (Abweichungsradar)
- **`kind`:** event
- **`granularity`:** overview
- **Default zone:** left (read-only, see [`mode-layouts-three-zones.md`](mode-layouts-three-zones.md))
- **Panel `type`:** `deviation-radar`
- **Catalog id:** new
- **Source(s):** [DB]
- **Grounding reference:** control-room practice: a delay list sorted by deviation
  with a trend ("is it getting worse?"), so a dispatcher sees which train needs
  attention before it becomes a conflict.
- **Source origin:** from-scratch, deliberately. The delay number is the one
  `core/timetable/current-delay.ts` already computes for the ZWL and the map.

## 2. Promise
> See at a glance which trains run late, by how much, and whether it is growing.

## 3. Per-mode behaviour
The same list in every mode. It reads; it never acts.

- **Recommendation (WP 3.1):** list and trend.
- **Co-Learning (WP 3.3):** list and trend. A "calm" line when no deviation is
  growing: the moment the Kolb tour uses for a mid-shift reflection.
- **Director (WP 3.4):** list and trend, framed as supervision ("watch").

Filters (all · late · growing) and clicking a row to select the train are
navigation, which the left zone allows. The threshold that counts as "late" is a
**panel setting** (`settings.thresholdMinutes`, default 3), not an action in the
widget: the left column stays read-only for the demo. A softer zone rule may be
decided later; the setting keeps it configurable.

## 4. System interaction
- **Data in:** `CurrentDelayService.minutes()` (delay now against the baseline
  timetable), `SessionStore.agents()`, `elapsedSteps()`, `selectedHandle()`.
- **New:** `DelayHistoryService` (root) records each train's delay per elapsed step,
  drops entries past `now` on a seek-back, and resets on a new session.
- **Actions out:** `store.toggleAgentSelection(handle)` (selection only).

| Field / capability | Available now | To build (flagged) |
|--------------------|:-------------:|:------------------:|
| Delay now per train | ✓ (`CurrentDelayService`) | |
| Delay history per step | ✓ (new frontend service) | |
| Forecast delay at destination | | ✓ (flagged: from the contentions branch, not faked) |

## 5. Allocation & accountability touchpoints
- **Loop stage:** context
- **Owner per mode:** n/a, it reads.
- **Decision events emitted:** none.

## 6. Acceptance scenario
> Walensee long approach, Co-Learning. A train breaks down in the single-track
> section. Within 3 steps the follower rises to the top of the list with a growing
> trend. Success: the participant names the affected train before the TMS
> notification is opened (Q1 / Q5).

## 7. Effort & changes
- **Effort:** S
- **Files:** `features/deviation-radar/*`, `core/timetable/delay-history.service.ts`,
  the six registration seams, i18n `devRadar.*`.

## 8. Open questions / risks
- Trend window is fixed at 5 steps. Measure in the pilot whether that is too nervous.
- Without a baseline timetable (`/hmi/plan` empty) the list shows an empty state.
