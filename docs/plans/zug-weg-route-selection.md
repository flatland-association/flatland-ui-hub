# Plan — Zug-Weg-Diagramm: choose a route between two stations

> **Status:** plan, 2026-09-25. Nothing built beyond step 0. Extends
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
| 1 | Route-axis endpoint + tests (Walensee equivalence, Olten A→B, unreachable pair → 404-ish empty) | M |
| 2 | Widget reads a position lookup instead of the column; column axis kept as default | S–M |
| 3 | From/to pickers in the widget, `zugWegRoute` in the store | S |
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
