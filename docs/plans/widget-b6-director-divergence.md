# Widget spec — `Was ändert sich` (Director divergence)

Status: spec, 2026-09-26. Asked for in
[mode-layouts-three-zones.md](mode-layouts-three-zones.md) §4 ("A *Was ändert
sich* companion beside the map") and §6 (new, S–M).

## 1. Identity
- **Name:** Was ändert sich · *What changes*
- **`kind`:** prediction — what the plan would do differently under an objective
  (plan-vs-plan, before it is taken over)
- **`granularity`:** detail (one row per affected train), linked to the map's overview
- **Default zone:** center, as a companion under the track map — cause (map) and
  effect (list) have to be readable at the same time, so not a tab (§4)
- **Panel `type`:** `director-divergence`
- **Catalog id:** B6 (new, next to B1 what-if and B4 Zug-Weg)
- **Source(s):** [D3.1] §7 (Director System: directives executed by
  interpretable primitives, ranked shortlist), [D3.2] T3.4
- **Grounding reference:** D3.1 §7 — a directive is only supervisable if its
  effect is *interpretable*; the worked example ends in a ranked shortlist of
  affected trains. Here the "primitive" is the planner's divergence per train.
- **Source origin:** `Source: from-scratch, deliberately` — presentation only. The
  data is the backend's `DirectorDivergence`
  (`/director/strategies` → `strategies[].divergence`), already computed for the
  map's branch marks and option bars (PR #96). No algorithm is built here.

## 2. Promise
> Before taking over an objective, the operator reads *which trains* it changes
> and *how* — "RE 18 takes another route from Weesen in 4 min", "IC 703 waits
> 6 min at Ziegelbrücke" — and points at a row to see that train's route on the
> map.

## 3. Per-mode behaviour
- **Recommendation (WP 3.1):** not offered. The dispatch-level counterpart is
  Combined Actions (the package's train order and its preview on map and ZWL).
- **Co-Learning (WP 3.3):** not offered. The counterpart is Plan / KI / Mensch and
  the what-if compare (blue = you, yellow = AI).
- **Director (WP 3.4):** offered. Read-only — supervision, not a lever; the
  lever is the objective in `strategy-options`. Neutral framing: the list states
  what each option changes, it does not rank options (the tiles already carry
  the forecast and the planner's scores).

`availableModes: ['director']` — the data exists only in Director.

## 4. System interaction
- **Data in**
  - `store.directorStrategies()` — the three options with `divergence`
    (`reroutes: {handle → {branch: {row, col, step}, points}}`,
    `holds: [{handle, row, col, steps}]`) and `ident` (A/B/C), `focus`
  - `store.directorPreviewStrategyId()` / `directorPreviewDivergence()` — the
    option drawn on the map ("Auf Karte")
  - `store.geography()` — place names for a cell (nearest named station)
  - `TrainIdentityService.nameFor(handle)` — train names
  - `store.elapsedSteps()` — "in n min" for a branch ahead; `MINUTES_PER_STEP`
- **Actions out** (view only, no decision)
  - pointing at a row: `store.directorHoverHandle.set(handle)` when that option
    is the one on the map (the map then draws that train's deviating route and
    marks its branch); otherwise `store.setAgentHoverAgent(handle)` (the train
    is highlighted, no route — the route belongs to the option on the map)
  - the A/B/C switch in the widget chooses which option's list is shown; it does
    not preview or apply anything
- **Backend table**

| Field / capability | Available now | To build (flagged) |
|---|:-:|:-:|
| Per option: rerouted trains, branch cell + step, deviating points | ✓ | |
| Per option: waiting trains, cell, steps | ✓ | |
| Place name for a cell | ✓ (geography, nearest station) | |
| Delay a change costs *per train* (minutes) | | ✓ — the planner reports utilities per plan, not per train; not shown rather than estimated |
| A Δ column in the Fahrplan (§4 item 2) | | ✓ separate item |

## 5. Allocation & accountability touchpoints
- **Loop stage:** decision (evidence before a directive is taken over)
- **Owner per mode:** Director — AI executes, human supervises; the widget
  supports the human's choice of objective, not a dispatch action
- **Decision events emitted:** none (read-only). Hovering is not logged.

## 6. Acceptance scenario
> Corridor Director tour (`pf-ch-corridor-stops`, 16 trains). Once the three
> options are planned, the widget shows the option that is on the map, else the
> first that changes anything. For option B it lists every rerouted and waiting
> train — one row each, waiting trains by wait (longest first), rerouted trains
> by how soon they branch — with a place name and a time. Pointing at a row with
> B on the map draws that train's route and highlights its branch mark. An
> option that changes nothing says so in one line.
>
> Measurable (Q1 distinct modes, Q5 study value): the row count equals
> `|reroutes| + |holds|` of the option; the widget is absent in Recommendation
> and Co-Learning.

## 7. Effort & changes
- **Effort:** S
- **Files:** `features/director-divergence/director-divergence.component.{ts,html,scss}`
  and a pure `core/director-divergence.ts` (rows, sorting, place lookup — unit
  tested); the six seams of the registration checklist; the
  `preset-director-three-zones` centre column; i18n en/de/fr.

## 8. Open questions / risks
- Reroutes carry no per-train cost, so rows state *what* changes, not *what it
  costs*. Adding a per-train delta needs the planner to report per-train
  arrivals per option — a backend extension, flagged.
- On 16 trains an option can change most of them; the list scrolls inside the
  panel rather than growing the centre column.
- From scratch by decision: this is presentation over an existing payload; no
  consortium widget covers it.
