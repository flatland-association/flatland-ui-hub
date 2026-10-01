# Widget spec — Triage'd Event Feed

## 1. Identity
- **Name:** Triage'd Event Feed
- **`kind`:** event
- **`granularity`:** overview
- **Default zone:** left
- **Panel `type`:** `triaged-events`
- **Catalog id:** C2
- **Source(s):** [UIX] control-room alarm practice · EEMUA 191 · existing
  notification manager and train deadline data
- **Grounding reference:** EEMUA 191 alarm-management principles: distinguish
  alarms that need immediate action from warnings and information, reduce
  alarm flooding, and make priority/response time explicit. The railway
  adaptation groups related train events and uses the existing Flatland
  deadline/malfunction signals.
- **Source origin:** Source: from-scratch, deliberately. The existing
  `notifications-panel` is the data/rendering baseline; no external event-feed
  source code is copied.

## 2. Promise
The operator can identify what needs attention first, how much response time is
left, and which trains are affected without scanning a chronological feed.

## 3. Per-mode behaviour
- **Recommendation (WP 3.1):** Available. The same triage order and severity
  presentation are shown; the feed does not add, hide, rank, or badge AI
  recommendations.
- **Co-Learning (WP 3.3):** Available. The same neutral triage order and
  evidence are shown; the feed does not turn urgency into a preferred action
  and does not present options.
- **Director (WP 3.4):** Available. The same event urgency and affected-train
  grouping are shown. Routine low-value events may be collapsed to keep the
  supervisory view focused, but the ordering and labels remain identical.
  Director-specific AI activity remains in `ai-activity`; this widget is the
  operator's event queue, not a planner explanation.

## 4. System interaction
- **Data in** — `SessionStore.notifications()`, each notification's kind,
  timestamp, related element, code and params; `SessionStore.agents()` for
  `time_to_deadline`, delay, malfunction state and train handles; existing
  selection/highlight methods from the notification panel.
- **Shared with the notifications panel** — `NotificationPollingService`
  fills `SessionStore.notifications()` while at least one consumer is mounted
  (reference-counted `acquire()`), so the feed works in layouts without the
  notifications panel. `NotificationWordingService` gives both panels the same
  translated title and message from the notification `code`.
- **Actions out** — dismiss an event, select/highlight its related train, and
  optionally focus the existing map/inspector target. No simulation or policy
  writes.
- **Triage rule:** first classify by actionable urgency (active malfunction or
  error, then warning with a finite deadline, then informational); within a
  class sort by the smallest available remaining deadline, then newest event.
  Events without a reliable deadline retain their severity and are never given
  a fabricated countdown.
- **Backend table:**

| Field / capability | Available now | To build (flagged) |
|---|:---:|:---:|
| Notification severity, timestamp and expiry | ✓ | |
| Related train/event identifier | ✓ | |
| Train deadline and malfunction state | ✓ | |
| Derived urgency buckets and stable sorting | ✓ | |
| Exact event-specific response-time contract | | ✓ (flagged extension) |
| Alarm acknowledgement lifecycle | | ✓ (flagged extension) |
| Backend-provided priority and escalation policy | | ✓ (flagged extension) |

## 5. Allocation & accountability touchpoints
- **Loop stage:** notification / context.
- **Owner per mode (`allocation`):** shared: the system detects and orders
  events, while the human decides whether and how to respond. Director's AI
  planner remains responsible for routine dispatch, but event triage remains a
  supervisory information channel.
- **Decision events emitted:** None. Dismissal is a view action, not an
  operational decision. Selecting an event may reuse existing focus telemetry,
  but must not create a Decision Log entry. Subsequent overrides continue
  through the existing accountability seam.

## 6. Acceptance scenario
Create or replay a session with one active malfunction, one warning tied to a
train deadline, and one informational event. Open the `triaged-events` panel.
The malfunction must appear first, the warning second, and the informational
event last. The warning must show the real remaining train deadline when
available; an event without a deadline must show no invented countdown.
Clicking an event must highlight the same train as the existing notification
panel, and dismissing it must remove it without changing the simulation.
Repeat in all three modes: the order, labels, and lack of recommendation badge
must remain equivalent.

Measurable criterion: in a fixture containing the three event classes, the
ordering is 3/3 correct in all modes; zero simulation writes and zero decision
log entries are produced by viewing, selecting, or dismissing events. This
tests Q1 (consistent mode boundary) and Q5 (situation awareness).

## 7. Effort & changes
- **Effort:** S–M (frontend triage and Lyne presentation; no backend contract)
- **Files / seams to touch:**
  - `frontend/src/app/features/triaged-events/triaged-events.component.{ts,html,scss}`
  - `features/layout/components/panel-plugin-host/panel-plugin-host.component.ts`
    and `.html`
  - `features/layout-designer/layout-designer.component.ts`
  - `core/widgets/widget-catalog.ts` (C2 planned entry gets its live `type` and
    first-cut status)
  - `docs/reference/panel-mode-matrix.md`
  - `docs/plans/widget-catalog.md`
  - `frontend/public/i18n/{en,de,fr}.json`
  - `core/layout/panel-mode-availability.ts` remains unchanged: all modes.
  - `app.component.*` only if a later layout decision ships it by default.

## 8. Open questions / risks
- Notification payloads do not currently define a universal event-specific
  response-time field. The first cut must therefore use train deadlines only
  where the related train and value are unambiguous.
- EEMUA-style priority is adapted to this prototype; do not claim a calibrated
  safety alarm standard without a backend escalation policy.
- Director collapsing must not hide an active malfunction or an event with a
  short, known deadline.
- No algorithm is built from scratch. The widget derives presentation order
  from existing state; future backend priority/escalation logic is a flagged
  extension.
