# Briefing — ZWL (Zeit-Weg-Diagramm) improvements

> **Status:** briefing for review, nothing built yet. Dated 2026-09-22.
> **Purpose:** compare the shipped `marey` widget against
> `Basisanforderungen_ZeitWegDiagramm_ZWL 1.md` (external requirements doc, not
> yet checked into the repo — see "Housekeeping" at the end), assess how it
> behaves for the Walensee interview scenario and for Olten, and lay out
> options **before** any code changes. User's framing: build an **additional
> widget**, decide on archiving the old one later — this matches what the
> team had already scoped (see §4).

## 1 · What exists today

Single component: `frontend/src/app/features/marey-chart/marey-chart.component.ts`
(catalog id `marey`, title "Graphic Timetable", `docs/plans/widget-catalog.md`).
No separate "ZWL" implementation exists — this is it.

**The load-bearing fact:** the y-axis is not a line or a set of Betriebspunkte.
It is the **cell trajectory of whichever train is currently the active
agent**, straightened out. Every other train is projected onto that train's
cell sequence by nearest-index matching. Selecting a different active train
changes the entire axis. There is no independent notion of "this corridor" or
"this Streckenabschnitt."

This single fact explains most of the gaps below and *all* of the Olten
problem (§3).

## 2 · Gap check against the Basisanforderungen doc

| # | Requirement (Basisanforderungen) | Status | Note |
|---|---|---|---|
| 2.1 | Time axis: now/past/future, minute/5-/10-min/hour grid | **Partial** | Now-line and past/future split exist. Grid is step-count based (50/100/200 sim-steps), not clock time — no minute/hour semantics at all, because the sim has no wall-clock unit. |
| 2.1 | Datumswechsel | **Missing** | No date concept in the sim. |
| 2.2 | Wegachse: Betriebspunkte, Bahnhöfe, Streckenabschnitte | **Missing** | Axis is raw cells of one train's path, not station/section identities. This is `widget-linkmap-zwl.md`'s (B4) exact target. |
| 2.3 | Jetzt-Linie | **Done** | `nowCoord`. |
| 3.1 | Zuglinie: Richtung/Geschwindigkeit/Halt erkennbar | **Partial** | Direction and dwell compression exist; speed only implicitly via slope. |
| 3.2 | Zustände (geplant/prognostiziert/historisch/verspätet/ausgefallen) | **Partial** | Past/future + malfunction detection exist. No explicit "cancelled" rendering. |
| 3.3 | Mehrere Fahrplanreferenzen (Soll/Betrieb/Prognose/Historie) | **Partial** | History + forecast scenario are merged into one line (`mergedTrajectories`), not visually distinguished by reference type. |
| 4 | Konflikterkennung (alle Unterarten), Früherkennung, Wirkung, Priorisierung | **Missing** | Confirmed zero connection to the backend `conflict_detector`. Already tracked as catalog item **B2** ("Conflict-aware Marey"), `status: planned`, unbuilt. |
| 5 | Verspätungen: Entstehung/Wachstum/Kompensation lokalisiert | **Missing** | Only implicit in the raw past/future line; no attribution or localisation. |
| 6 | Navigation: Scroll/Zoom/Zeitverschiebung/Bereichsfokus | **Done** | Wheel zoom, drag pan, X/Y brush ranges, axis swap. |
| 6 | Selektion: Zug/Konflikt/Betriebspunkt/Infrastrukturabschnitt | **Partial** | Train click/hover exists and cross-highlights map + inspector. No conflict list (none exists), no Betriebspunkt/section selection (no such axis exists, see §3). |
| 7 | Ansichten-Synchronisierung | **Done** | Hover/selection shared via `SessionStore` signals, consistent with the map and agent inspector. |
| 9 | Was-wäre-wenn, Entwurf vs. aktiv unterscheidbar | **Partial** | One mechanism exists: a dashed "ghost" overlay for a Combined-Actions time-shift preview. No general draft/variant/simulation model — the project's actual what-if surface (`whatif-compare`, A3S/TraceRL convention, catalog **B1**) renders on the map, not here. |
| 10 | Transparenz (warum Konflikt/Prognose/Empfehlung) | **Partial** | The decision-glyph overlay shows the AI's recommended next action at switches with click-to-override — good on the "warum Empfehlung" axis, silent on "warum Konflikt/Prognose" (because neither exists yet). |
| 11 | Automatisierung sichtbar (was/wann/Auswirkung) | **Partial** | Recommended-action pills exist (what/where); no explicit "when will it act" or "expected effect" annotation. |
| 12 | Informationsdichte + Filter/Fokus/Priorisierung | **Partial** | Zoom/brush give focus; no filtering by train state, conflict, or delay. |
| 12 | Skalierbarkeit (wenige↔viele Züge, klein↔gross) | **Fails at network scale** | Works for a handful of trains on one path. Breaks down for a 52-agent network like Olten precisely because the axis is one train's path, not a shared coordinate system — see §3. |

**Bottom line:** the axis/identity problem (§2.2, §12) and the missing
conflict/delay/forecast layers (§4, §5, §3.3) are the two clusters driving
your dissatisfaction, and they are largely independent fixes.

## 3 · Olten and "which Streckenabschnitt is shown"

> **Reframed 2026-09-22:** Olten isn't a build target for this pass — it's
> the stress-test case for thinking through "what does the ZWL have to look
> like once it's not just one thing," i.e. the network-scale question. §3b's
> finding (no `StationsLinks`, needs manual curation) is useful precisely
> *because* it surfaces that design problem concretely, not because Olten
> itself needs shipping now. Walensee (§4) is the actual near-term target;
> Olten stays a design reference until its own curation work is separately
> prioritised.

Two findings from the audit, on how the shipped `marey` behaves for a
non-linear network like Olten:

1. **The team already hit this and wrote it down**, unprompted, in
   `docs/plans/widget-b5-network-time-view.md`: *"a Marey's y-axis is a
   linearisation of cells, so it presumes a line exists. That holds for the
   PF–CH corridor and is a fiction for Olten."* They had proposed the ZWL as
   the Director mode's default view and retracted it for this reason.
2. **No station/line/section picker exists anywhere in the app today** — not
   on the map, not on any widget. The only "selection" mechanisms are:
   picking a whole scenario, picking the active train (which *is* the ZWL's
   axis, see §1), and clicking cells on the map.

> **2026-09-22 decision: B5 is parked, out of scope for this work.** Treat it
> as a separate, later initiative — not folded into the ZWL fix. The B5
> references below are kept only for context on why the team considered and
> then set it aside; do not scope it as part of this effort.

There are two structurally different answers on the table, already scoped as
separate widgets, and they answer different questions:

- **B4 — Link Map (ZWL)** (`docs/plans/widget-linkmap-zwl.md`): ports
  flatland-hmi's `extract_link_map()` to give the Marey a **station/link
  y-axis** instead of raw cells. This is still a classic time-*distance*
  diagram — it just fixes the axis identity problem. It needs a
  `flatland-rl` 4.2.6 → 4.3.0 bump (sdist-only build, reward-semantics
  change — re-baseline needed) but is otherwise a straight, scoped port.
  It does **not** by itself solve "which section" for a non-linear network
  like Olten — a link-map axis still has to pick *a* path through the graph.
- **B5 — Network Time View** (`docs/plans/widget-b5-network-time-view.md`):
  a different diagram entirely — occupancy of named **resources** (platform
  tracks, approaches) as horizontal bars, not a distance axis at all. This is
  the one explicitly designed around Olten's fixture (24 waypoint cells → 12
  resource rows for a 52-agent network) and is the answer to "does the plan
  fit through the network's bottlenecks," not "show me train X's ride along
  section Y."

**Update 2026-09-22 — checked the actual flatland-hmi source
(`github.com/flatland-association/flatland-hmi`), not just its spec doc, and
this changes the answer: a corridor/link picker already exists upstream, as
part of what B4 proposes to port.**

Both `frontend/src/app/marey/marey.component.ts` and
`frontend/src/app/link-map/link-map.component.ts` in flatland-hmi are built
around a **link selector**, not a fixed axis:

- `StateService.getLinks()` emits the list of station-to-station links (each
  with a `label`, `fromGate`, `toGate`) computed from the env's
  `StationsLinks`.
- Both components hold `selectedLink` / `linkOptions` and render a `<select>`
  dropdown (`link-map.component.html:1-6`) bound to
  `ControllerService.selectLink(id)`.
- Changing the selection re-fetches/re-renders `getLinkMap()` for that one
  link — i.e. **exactly Option A below, already implemented**, not something
  we'd design from scratch.

So the picker question resolves itself once B4 is ported: don't design a new
UI, **port the existing dropdown + `StateService`/`ControllerService` link
plumbing as-is** (rewritten against `SessionStore` signals per our
conventions, same as the rest of the port already scopes). This also means
Olten needs its `StationsLinks` populated with more than one link (currently
only verified as a data question in `widget-linkmap-zwl.md` §8.2) — if Olten
generates as a single connected graph, the link list is what enumerates its
Streckenabschnitte for the dropdown.

| Option | How it works | Status |
|---|---|---|
| **A. Corridor dropdown** | Pick a station-to-station link from a `<select>`; ZWL axis re-linearises to that link. | **Already built upstream in flatland-hmi — port it, don't design it.** |
| **B. Click-to-select on the map** | Click a track segment/link on the network map instead of a dropdown. | Not in flatland-hmi; would be a genuine addition on top of the port, if the dropdown UX proves insufficient for Olten's link count. |

Recommendation: **ship A as part of the B4 port** (it comes for free), only
consider B later if Olten's link list turns out too long/unclear for a flat
dropdown.

### 3b · Checked Olten's fixture directly — it has no `StationsLinks` at all

You asked me to verify this rather than leave it flagged. I loaded
`backend/app/fixtures/olten/olten.pkl` directly: it's a raw serialized
`RailEnv` state — keys `grid, agents, malfunction, max_episode_steps,
elapsed_steps, random_seed, …` — **there is no `stations_links` field, and
none of the plain grid/agent data implies one.** `SOURCE.md` confirms why:
the fixture was generated upstream with **flatland-rl 4.0.6 / 4.1.0**, years
before `StationsLinks` existed (shipped in 4.3.0), and it's a **verbatim copy
of a real Swiss network** — not something built by `SparseRailGenerator`,
which is the only generator that emits `StationsLinks` today (per
`ZWL.md`'s own pipeline diagram, path "A"). Bumping our `flatland-rl` pin to
4.3.0 does **not** retroactively add this data to an already-serialized
environment — the library version has nothing to backfill.

**This means the B4 port's dropdown does not "just work" for Olten out of
the box**, contrary to what §3's port recommendation implies for a
freshly-generated scenario. `widget-linkmap-zwl.md` already flagged this
generally as open question #2 ("does every scenario-builder path populate
`StationsLinks`, or only `SparseRailGenerator`-built envs?") — this confirms
the answer for Olten specifically is **no**, definitively, not just
"unverified."

Two ways forward, both variants of what `ZWL.md`'s pipeline diagram already
names as paths B/C ("manually curated stations links" / "manually curated
mapping"), since path A (SparseRailGenerator) isn't an option for a
real-topology fixture:

- **Manually curate `StationsLinks` for Olten once**, from data we already
  have: the B5 investigation found Olten's 52 agents call at exactly 24
  distinct waypoint cells, clustering into the platform tracks (row 37,
  cols 7–16) and four line portals — this is very likely enough structure to
  hand-derive a station/link graph from, a one-time authoring task rather
  than an algorithm.
- **Ship B4 with an explicit "no link data" state for Olten**, and treat the
  Olten section-picker as unsolved until the curation above happens — i.e.
  land the corridor case (Walensee, §4) first, where the same caveat likely
  *also* applies (Walensee/PF-CH are hand-built fixtures too, not
  `SparseRailGenerator` output — unverified but the same reasoning applies;
  worth the same direct check before relying on it).

**Checked Walensee too, since it's the priority scenario (§4).** It's a
different fixture format entirely —
`backend/app/fixtures/pf_ch/pf-ch-wn-wal-long-approach.scene.json`, the
hand-authored scene JSON from the drawing tool (CLAUDE.md's
`gridDimensions/grid/stations/lines/...` format), not a serialized `RailEnv`.
It has **no `StationsLinks` either** (that's a flatland-rl runtime type,
irrelevant to this JSON format) and its own `lines` field is `null`. But it
**does** carry real, named stations already: 10 real stops (Siebnen-Wangen,
Schuebelbach-Butt., Reichenburg, Bilten, Ziegelbrücke, Weesen, Walenstadt,
Flums, Bad Ragaz, Landquart) each with an `x` grid coordinate and track
number. Since this is a single corridor, "the line" is just these stations
sorted by `x` — no graph algorithm needed, no ambiguity to pick between.
This is meaningfully cheaper than Olten: the axis-with-station-labels the
Basisanforderungen doc asks for (§2 row 2.2) could be built for Walensee
straight from this existing `stations` list, without waiting on the
`StationsLinks`/flatland-rl-4.3.0 path at all. Whether that reuses B4's port
or is a lighter, corridor-only stopgap is a build-time decision, not a data
question — the data already answers "yes, for Walensee."

## 4 · The Walensee interview scenario

The scenario you'll be showing is **Walensee**
(`infrastructureId: 'pf-ch-wn-wal-long-approach'`,
`frontend/src/app/core/demo/tours.ts:94`) — Pfäffikon SZ–Chur, Ziegelbrücke to
Walenstadt, with the single-track section where the interview tour's
breakdown plays out (`tour-briefings.ts:233-237`).

This is the **corridor case**, not the network case — a single line genuinely
exists, so it doesn't hit the Olten-style axis-identity problem as hard.
"Es soll dort gut aussehen" means in practice: get the new widget's baseline
quality (axis, states, readability, and the conflict overlay from §5) right
for a corridor scenario first, since that's what the interviews actually
show. It still inherits every other gap in §2 regardless of scenario.

## 5 · Recommendation shape

Given "Zusatzwidget first, archive later" — this already matches how B4 is
written: *"Additional widget alongside the shipped `marey` … not a
replacement."* Updated per §3's finding and the 2026-09-22 decision to park
B5:

1. Treat **B4 (Link Map/ZWL)** as the base of the new widget, named
   **"Zug-Weg-Diagramm"** (v2, §7.2) — closest to "the same ZWL, fixed axis,"
   already spec'd. For Walensee specifically, the Betriebspunkt axis (§2.2)
   is cheap — real station data already exists in the fixture (§3b) — so
   this is achievable for the interview scenario without waiting on the
   `StationsLinks`/4.3.0 path. Olten's version of this (§3, §3b) stays a
   separate, later curation task, not a blocker for this build.
2. **Conflict overlay is in scope from the start** (your call, 2026-09-22):
   fold **B2**'s conflict-ribbon work into the same build, retargeted onto
   B4's station/link axis instead of the old cell axis (per B2's own open
   question §8.4 in `widget-linkmap-zwl.md`) — not a later pass. This wires
   the widget to the backend `conflict_detector` for the first time (§2 row
   4), which is the single biggest gap against the Basisanforderungen doc.
3. Also layer on, in this order (your call, 2026-09-22): **delay
   localisation first** (§2 row 5), **plan-vs-actual/forecast distinction
   second** (§2 row 3.3) — both after the axis fix + conflict overlay.
4. **B5 is parked** (your call, 2026-09-22) — not part of this effort.
5. Only after the new widget covers what you need would archiving `marey`
   become a real question — nothing here requires deciding that now.

## 6 · Open questions for you

1. ~~Olten section picker~~ — reframed (§3): Olten is a design reference for
   the network-scale case, not a build target here. §3b's finding (no
   `StationsLinks`, needs manual curation) stands as the concrete answer for
   *when* that work is picked up, separately.
2. ~~Conflict overlay timing~~ — resolved: in scope from the start (§5.2).
3. ~~Priority: delay localisation vs. plan/forecast distinction~~ — resolved
   (§5.3): delay localisation first, plan/forecast distinction second.

## 7 · Follow-up (2026-09-22): flatland-rl checked, naming

### 7.1 What flatland-rl itself has (checked 2026-09-22)

Searched the installed package (`backend/.venv/…/flatland_rl-4.2.6`, pinned
in `backend/requirements.txt`) for anything ZWL/Marey/diagram-shaped:
`rendertools.py`, `evaluators/trajectory_analysis.py`,
`trajectories/*.py` — nothing. No stringline/diagram code, and no
`StationsLinks`/`stations_links` at all in this version.

**flatland-rl itself does not contain ZWL code to reuse.** Two separate
things exist upstream that are easy to conflate:

- **`StationsLinks` graph primitives** (`Station`, `Link`, `Gate`, `Pin`,
  `Fibre`) — a data structure for station/link topology, shipped in
  **flatland-rl 4.3.0** (we're pinned to 4.2.6). This is the *input* a
  linearized axis would need, not a renderer.
- **The actual ZWL/Marey renderer code** — lives in the sibling
  **flatland-hmi** repo (`flatland-association/flatland-hmi`,
  `backend/app/link_map.py` + `frontend/.../marey.component.ts`), *not* in
  flatland-rl. This is exactly what `widget-linkmap-zwl.md` (B4) already
  scoped porting.

So: nothing changes about the B4 plan — bump to 4.3.0 for `StationsLinks`,
port the renderer from flatland-hmi (not from flatland-rl, which has none).
Confirms B4 is the right target, not a shortcut we're missing inside
flatland-rl itself.

### 7.2 Naming: "Zug-Weg-Diagramm" (v2)

Noted: you want the new additional widget's working title to be
**"Zug-Weg-Diagramm"**, positioned as a v2 relative to the shipped `marey`
("Graphic Timetable"), rather than carrying over the "Link Map" name from the
flatland-hmi port it's based on. I'll use that as the display name/catalog
title when this gets built; the internal port (`extract_link_map()` etc.,
§3) stays as the implementation source, the name doesn't have to match it.

### 7.3 "Was meinst du mit Network Time View?" — in plain terms (B5, parked)

**Network Time View (B5)** is *not* a time-distance diagram at all — it
deliberately avoids the "pick a line" problem instead of solving it. Picture
a Gantt-style chart: each **row is a physical resource** (a platform track,
a single-track approach — e.g. "Gleis 37/13" or "Süd-Ost-Einfahrt"), the
x-axis is still time, and a **horizontal bar** on a row means "this resource
is occupied by this train from t1 to t2." Two trains needing the same
resource overlapping in time shows up as **overlapping bars in the same
row** — that's your conflict, read directly off the chart, no separate
detection needed.

Why it exists as a *different* widget from the ZWL: a time-**distance**
diagram (the ZWL) needs a single path to lay trains out spatially — that's
what breaks for a 52-train network like Olten with no single line. A
resource-occupancy chart doesn't have that requirement at all; rows come
from wherever the traffic actually calls (`docs/plans/widget-b5-network-time-view.md`
§4b derives Olten's 12 rows straight from its 24 waypoint cells, no line
needed). It answers "will the plan fit through the network's bottlenecks,"
not "watch this train's ride along this corridor" — that second question is
still the ZWL's job, which is why §5 above keeps B5 as a separate, later
decision rather than folding it into the ZWL fix.

## Housekeeping

`Basisanforderungen_ZeitWegDiagramm_ZWL 1.md` currently lives only in your
Downloads folder. If you want it as a standing reference (the way other
external specs are mirrored under `docs/reference/`), say so and I'll check a
copy into the repo alongside this briefing.
