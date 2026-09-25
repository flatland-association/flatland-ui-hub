# Plan — Zug-Weg-Diagramm: choose a route between two stations

> **Status:** 2026-09-25 — steps 0–3 built (Olten names, route-axis endpoint, widget on the route axis with from/to pickers); step 4 (map selection) open. Extends
> [`widget-b4-zug-weg-diagramm.md`](widget-b4-zug-weg-diagramm.md) (B4); replaces
> its deferred "port the flatland-hmi link dropdown" path for scenarios without a
> single corridor. User's idea (2026-09-24): in a larger network, pick *between
> which stations* a time-distance diagram is drawn — from the widget or from the
> track map.

## Why

The v1 axis is "position = grid column", which only holds for a west–east
corridor (Walensee). A node like Olten has no single line, so any fixed axis is
fiction (briefing §3). A Bildfahrplan in a control room is always drawn for a
chosen section anyway; choosing it is the natural fix. It also removes the
dependency on `StationsLinks` / flatland-rl 4.3.0 (spec §8.1): the rail grid
itself is enough.

## Step 0 — names for Olten ✓ (2026-09-25)

`backend/app/fixtures/olten/olten.geography.json`: 10 platforms (real track
numbers), Olten Hammer, Trimbach, six portal destinations; provenance in
`fixtures/olten/SOURCE.md`. `/hmi/geography` now returns `layout: "corridor"` for
scenes and `"network"` for this sidecar; the widget draws its column axis only
for `corridor` and shows a "network — route choice planned" note otherwise.

## Design

### Route axis (backend)

`GET /{session_id}/hmi/route-axis?from=<cell>&to=<cell>` (cells, or station
codes once names are unique enough):

1. From the rail transitions, build the directed cell graph (Flatland
   `(row, col, dir)` states).
2. The **route set** = every cell that lies on *some* path from A to B (forward
   reachable from A ∩ backward reachable from B). This deliberately includes
   parallel platform tracks, passing loops and crossovers between them.
3. **Axis position** of a cell = its shortest-path distance from A within the
   route set. Parallel tracks at the same distance share an axis position —
   exactly what the column did for Walensee.
4. Return `{cells: {"r,c": pos}, length, stations: [{name, track, kind, pos}]}`
   — the named cells inside the route set, placed on the axis.

Walensee is the acceptance check: A = Siebnen-Wangen, B = Landquart must give
(almost) the current column axis — positions differ by at most the few cells of
a switch diagonal.

### Widget

- Axis source: route axis when a route is chosen; the column axis stays the
  default for corridor scenes (no change for the interview tour).
- A train is drawn while it is on route-set cells; it enters/leaves at the
  edges, as in a real Bildfahrplan. Delay marks, Soll line and conflict ribbons
  work unchanged on the new positions; conflicts off the route keep the
  existing "outside this view" chip.
- `delayMarks` / `contentionBand` switch from `col` to "axis position of the
  cell" — one lookup function passed in instead of `Number(cell[1])`.

### Choosing A and B — one store signal, several surfaces

`SessionStore.zugWegRoute = signal<{ from: Cell; to: Cell } | null>` —
presentation only (`writes: view`), shared so every surface stays in sync:

1. **In the widget:** two pickers "from / to" over the named stations (grouped:
   platforms, stops, portals as "towards Basel"); swap button.
2. **On the track map:** station context action "Zug-Weg from here / to here";
   the chosen route set is highlighted on the map.
3. *Later, only if needed:* a small route widget with saved sections
   ("Walensee whole", "single-track section", "Olten → Basel").

## Steps

| # | Step | Effort |
|---|---|:---:|
| 1 | Route-axis endpoint + tests (Walensee equivalence, Olten A→B, unreachable pair → 404-ish empty) — **done 2026-09-25** | M |
| 2 | Widget reads a position lookup instead of the column; column axis kept as default — **done 2026-09-25** | S–M |
| 3 | From/to pickers in the widget, `zugWegRoute` in the store — **done 2026-09-25** | S |
| 4 | Map: "from here / to here" + route highlight | M |

## Open questions

1. **Two genuinely different routes A→B** (not parallel tracks): the route set
   then mixes two lines. Options: shortest route only, or an optional "via"
   station. Probably rare in Olten; decide in step 1 with real data.
2. **Portal names** are derived (see SOURCE.md) — a check by someone who knows
   the Olten node before showing them to operators.
3. **Olten has no Soll plan** (`/hmi/plan` → `hasPlan: false`): Soll line and
   delay marks stay off there; conflicts and Ist/Prognose work.
4. **Which surface first** — widget pickers are the cheap, self-contained
   start; the map interaction is the one that makes it feel like dispatching.
5. **B5 (Network Time View)** remains the better answer to "does the traffic
   fit through the node"; this plan is about "watch trains along a section".

## Step 1 as built (2026-09-25)

`GET /{session_id}/hmi/route-axis?from=<code|row,col>&to=<code|row,col>` —
`app/core/route_axis.py` + `backend/tests/test_route_axis.py`. A station code
stands for all its cells ("OL" = every Olten platform). Response: `length`,
`cells: [[row, col, pos]]`, `stations` on the route with `pos`, and `ticks` (one
per named place, the median of its tracks; corridor scenes add their track-less
places by column). ≤ 2 ms per route on both scenarios.

- **Position = mean of "distance from A" and "length − distance to B".** Plain
  distance from A let every parallel-track detour push all later cells back
  (Walensee drifted up to 11 cells against the column axis; Ziegelbrücke's
  tracks spread over 54–60). The mean cancels the detour at the platform:
  Walensee SIB→LQ now matches the column axis within ±1 at every station
  (±6 inside switch throats), which is the acceptance check.
- **Route tolerance:** paths up to max(8, 15 % of L) longer than the shortest
  still count — takes in parallel tracks and loops, keeps out runs past B.
- **Olten's platforms** still spread over ~8 positions on Bern→Basel (the
  throat fans differ in length); the tick uses their median, trains keep their
  exact position. Revisit in step 2 if it reads badly.
- Olten examples: Bern→Basel `[Bern, Olten, Basel]`, length 77;
  Solothurn→Aarau `[Solothurn, Olten Hammer, Olten, Aarau]`, length 63.

## Steps 2–3 as built (2026-09-25)

- `zug-weg-axis.ts` now has one `AxisModel` (`pos(row, col)`, `placeAt(row, col)`,
  `ticks`, `singleTrack`) with two implementations: `columnAxis` (corridor
  scenes, unchanged behaviour) and `routeAxis` (from `/hmi/route-axis`). Train
  lines, Soll, delay marks and conflict ribbons only ask the model; a cell off
  the route breaks the line, a train never on it is not drawn, a contention
  wholly off it keeps the "outside this view" chip with the backend's location
  name. Delay marks match places by code instead of by column.
- `SessionStore.zugWegRoute` (`{sessionId, from, to}`), view only. The widget
  shows from/to pickers wherever places are named: "whole corridor" is the
  default for a corridor scene, a network (Olten) asks to choose. Portals read
  "towards Basel"; swap and clear buttons.
- Checked in the browser: Olten Bern → Basel draws the trains entering and
  leaving through the node (6 lines at step 52); Walensee whole corridor is
  unchanged (chip, live delay marks), and ZB → WAL shows the same conflict and
  marks on the shorter axis.
- The plot has a 320 px floor now — in a view-tabs panel without
  `minBodyHeight` it collapsed to nothing.
- Noticed, not ours: in the `preset-combined-actions-package` layout on Olten
  the Combined Actions panel reported a "north entry" contention while
  `/hmi/contentions` returned none for the same session — that panel's package
  variant reads a different source. The diagram shows what `/hmi/contentions`
  says.
- The pickers also appear in the interview layout (default "whole corridor",
  so the view is unchanged). If they distract in interviews, a panel setting
  can hide them there.

## Tour "Olten: explore the Zug-Weg-Diagramm" (2026-09-25)

Recommendation mode on Olten (undisrupted, random breakdowns), EN + DE twins
(`olten-zug-weg-en` / `-de` in `core/demo/tours.ts`), layout
`preset-olten-zug-weg`: Notifications | track map | Zug-Weg-Diagramm over the
timetable | Recommendations + train detail. Keeps the three-zone contract with
the centre split, because Olten's map is portrait; a timetable under both
views is not possible — rows span the full width in the layout model. The
briefing sets `zugWegRoute` (towards Bern → towards Basel) for each tour
session; `TourBriefing.opening`/`closing` are optional now, so a short tour is
just its mode intro. Checked: intro, preset route, the three views in sync
(click a train in the diagram → highlighted, train detail shows it with its
switch actions), the recommendation card (~7 s to compute on 52 trains).

### Revised 2026-09-25 (user feedback: recommendation panel not useful, no forecast visible)

- **Forecast lines were missing while playing.** They came from the scenario
  rollouts (≈12 s on Olten, refreshed only on discrete actions). Now
  `/hmi/contentions?trajectories=true` returns the forecast branch's positions
  and the widget draws those: the same 50-step run the conflict ribbons come
  from (≈0.7 s, refreshed every 3 steps while playing). Scenario forecast stays
  the fallback.
- **Olten is sparse:** 52 trains over the hour, on average 2.9 on the map at
  once (max 5). Contentions are rare; the impact recommender never fired in 320
  steps. So conflict-driven panels are mostly empty there by nature.
- **Recommendations panel replaced by Combined Actions**, and the tour got one
  scripted breakdown (`fixtures/olten/disturbances_tour/olten-breakdown-south.json`:
  train 1 stops at step 55 for 25 steps just after leaving towards Bern). Found
  by searching every train on the Bern→Basel section in the first 300 steps —
  it is the only breakdown there that blocks another train. Test:
  `test_olten_tour_breakdown_blocks_a_train_on_the_tour_section`.
- Checked in the browser: forecast lines while playing; at step 60 the chip
  "Blocking · Bern – Olten · ICE_42 × RE_18", the ribbon on the section, and
  Combined Actions with three packages, A "Recommended by AI".
- **Weak spot:** with two trains in the contention, the three packages come out
  with identical figures (−13 min each). The decision is real but not rich.
  A denser Olten (compressed departures) or a second breakdown would give
  Combined Actions more to rank — a scenario decision, not taken here.
