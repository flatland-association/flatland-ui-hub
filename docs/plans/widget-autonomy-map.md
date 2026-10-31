# Widget spec — Autonomy Map (`autonomy-map`, catalog D1)

First cut of catalog entry **D1 Autonomy Dial / Allocation Panel**: the display
half. The dial (changing the allocation at runtime) stays a flagged extension.

## 1. Identity
- **Name:** Autonomy Map (Autonomie-Karte)
- **`kind`:** control (catalog D1); this cut is display-only, `writes: none`
- **`granularity`:** overview
- **Default zone:** left (reads, never acts)
- **Panel `type`:** `autonomy-map`
- **Catalog id:** D1
- **Source(s):** [D3.1] §7, T3.4 (adjustable autonomy)
- **Grounding reference:** levels of automation per decision type
  (Parasuraman, Sheridan & Wickens 2000; Timpe & Kolrep 2002) and control-room
  agreements on what the system may decide alone. `docs/reference/interaction-framework.md`
  already models `allocation` as its own concept.
- **Source origin:** from-scratch, deliberately. Presentation of rules that
  already exist in the code (impact-panel decision moment, countdown, Director).

## 2. Promise
> See, per kind of decision, who decides right now — me, the AI after a
> warning, or the AI alone — and which trains I have fixed by hand.

## 3. Per-mode behaviour
Four levels: **I decide** · **AI suggests, I confirm** · **AI decides after a
warning** · **AI decides**. Rows are decision types; the level is *derived* from
the mode and the settings — exactly the rule the code applies, nothing new.

| Decision type | Recommendation | Co-Learning | Director |
|---|---|---|---|
| Conflict or disruption (hold / reroute) | auto-pause on: AI decides after a warning (countdown N s, then the recommendation is applied); off: AI decides, you may override | auto-pause on: I decide (trains held until you decide); off: AI decides, you may override | AI decides (re-plans) |
| Routine running (no conflict) | AI decides | AI decides | AI decides |
| Objective / strategy | not in this mode | not in this mode | I decide (strategy focus) |
| Train fixed by hand | I decide | I decide | I decide |

Below the table: the trains currently fixed by hand (agents with an override),
and the evidence for the session — decision-log entries by owner (me / AI /
system). The rule and the record side by side make a mismatch visible.

## 4. System interaction
- **Data in:** `interactionMode()`, `autoPauseOnConflict()`,
  `decisionCountdownSeconds()`, `agents()` (`override_action`), `decisionLog()`.
- **Actions out:** `store.toggleAgentSelection(handle)` on a fixed train (navigation).

| Field / capability | Available now | To build (flagged) |
|--------------------|:-------------:|:------------------:|
| Level per decision type, derived | ✓ | |
| Fixed trains | ✓ | |
| Decision record by owner | ✓ | |
| Setting the level per decision type at runtime (the dial) | | ✓ (flagged: needs per-type allocation in the store, beyond the `InteractionMode` presets) |

## 5. Allocation & accountability touchpoints
- **Loop stage:** context (makes the allocation visible)
- **Owner per mode:** see table; the widget shows it, it does not change it.
- **Decision events emitted:** none.

## 6. Acceptance scenario
> Recommendation with auto-pause on: the conflict row reads "AI decides after a
> warning (10 s)". The participant switches auto-pause off in Settings; the row
> changes to "AI decides, you may override". Success: asked "who decides this
> conflict if you do nothing?", the participant answers correctly in every mode
> (Q4 allocation, Q3 accountability).

## 7. Effort & changes
- **Effort:** S
- **Files:** `features/autonomy-map/*`, the registration seams, D1 catalog entry
  (status → first-cut), i18n `autonomyMap.*`.

## 8. Open questions / risks
- The runtime dial is the interesting study lever (adjustable autonomy) but
  breaks the "modes are presets" guardrail unless it lands with the two-axis
  split (`widget-mode-axes.ts`). Deliberately not built here.
- Auto-pause only engages during a running demo; outside it nothing pauses. The
  row text names the setting, not the demo state.
