# Widget spec — Zug-Weg-Diagramm (v2)

> Additional widget alongside the shipped `marey` (Graphic Timetable) — not a
> replacement. Archiving `marey` is a separate, later decision
> (`docs/plans/zwl-improvements-briefing.md` §5.5).
> Supersedes/merges catalog entries **B4** (`widget-linkmap-zwl.md`) and **B2**
> ("Conflict-aware Marey") into one build, per the 2026-09-22 decision recorded
> in the briefing (§5.2). Grounded in that briefing throughout — read it first.

> **Status 2026-09-23 — first-cut, priorities 1–4 built.** 1+2 (axis +
> conflict overlay) reviewed and accepted by the user; 3 (delay localisation)
> and 4 (Soll line) built after that review, see §8.9. Corrections agreed with the user before building are folded in
> below and marked *(2026-09-23)*. Code: `frontend/src/app/features/zug-weg-diagramm/`.

## 1 · Identity

- **Name:** Zug-Weg-Diagramm (v2)
- **`kind`:** prediction — not re-litigated: the shipped `marey`, the B2 entry
  it absorbs, and the B4 entry it's built from are all already `prediction`
  in `widget-catalog.ts` (time-distance train movement + predicted
  conflicts). No open choice here.
- **`granularity`:** overview-detail (same as shipped `marey`)
- **Default zone:** center
- **Panel `type`:** `zug-weg-diagramm`
- **Catalog id:** **B4** (absorbs **B2**'s scope — see below)
- **Source(s):** UIX top cross-model bet (6/6, inherited from B2's entry);
  central to §3.3 dual-path (marey-rethink)
- **Grounding reference:** Marey time-distance diagram / Bildfahrplan —
  standard control-room instrument for verkehrsdisposition (per the
  Basisanforderungen doc this spec answers to). The conflict-ribbon layer's
  own grounding (from B2's entry): UIX top cross-model bet.
- **Source origin:** ported from
  [`flatland-association/flatland-hmi`](https://github.com/flatland-association/flatland-hmi)
  (MIT) — `backend/app/link_map.py` (`extract_link_map()` + ~15 helpers),
  `frontend/src/app/link-map/link-map.component.ts`,
  `frontend/src/app/marey/marey.component.ts`, including their **link
  selector** (`StateService.getLinks()/getSelectedLink()`,
  `ControllerService.selectLink()`) ported as-is rather than redesigned. The
  RxJS `StateService`/`ControllerService`/`RendererService` plumbing is
  **not** ported — rewritten against `SessionStore` signals per CLAUDE.md.
  The conflict-ribbon overlay (absorbed from B2) has no upstream source —
  B2's own entry already states `from-scratch UI build`; this stays true
  here, retargeted onto the ported axis instead of `marey-chart`'s cell axis.

## 2 · Promise

Read train movements over time along a **named corridor you choose** — not
whichever train happens to be active — and see a predicted conflict on that
corridor before it happens, not just current positions.

## 3 · Per-mode behaviour

**v1 stays ALL_MODES**, matching the shipped `marey`'s current (undifferentiated)
behaviour — this spec does not attempt the mode-differentiation work
CLAUDE.md's "current focus" section calls out as outstanding. That is a
deliberate scope cut, not an oversight — flagged again in §8.

- **Recommendation (WP 3.1):** Same as Co-Learning/Director. Decision pills
  at switches (ported from the shipped `marey`'s `decisionGlyph`) show the
  AI's recommended action; click-to-override via the existing
  `TrainActionService` seam.
- **Co-Learning (WP 3.3):** Same rendering. No neutral/ranked distinction
  applied yet — inherited gap, not new.
- **Director (WP 3.4):** Same rendering, including the override pills — this
  is inconsistent with how Director suppresses dispatch-level control
  elsewhere (`agents-table`, `combined-actions`), and is flagged as an open
  question (§8) rather than silently carried over.

## 4 · System interaction

**Data in**

| Need | Source | State |
|---|---|---|
| Train positions over time | `store.history()` / trajectory signals (already feeding `marey-chart`) | ✓ exists, reused |
| **Station axis for Walensee (v1 path)** | `pf-ch-wn-wal-long-approach.scene.json`'s existing `stations` array (10 real stops with `x`/track), sorted into a corridor — no `StationsLinks` needed. Served by the existing `GET /hmi/geography` (`store.geography()`), which also carries the track-less places (`locationOrder`/`locationColumns` — Mühlehorn, Tiefenwinkel, …) and `singleTrackSection`: those become minor ticks and the shaded single-track band *(2026-09-23)* — without them the contended MH–TIEF stretch would be unlabelled. Stations keep their platform `x`; `locationColumns` is used only for codes without tracks (the two sources differ by a few columns for the same code). | ✓ built (`zug-weg-axis.ts`) |
| Station/link axis for a future `SparseRailGen` scenario | new `store.linkMap` signal, new endpoint, ported `extract_link_map()` | ✗ to build (B4 port) — **not on the critical path for Walensee, see §8.1** |
| Link/corridor picker | for v1, a static list from the scene JSON (Walensee is one corridor, so this is closer to a label than a choice); the ported `StateService.getLinks()` equivalent applies once a multi-link scenario is in scope | ✓ trivial for v1, ✗ deferred for the general case |
| Conflict predictions | backend `conflict_detector` | ✓ **already exposed** *(2026-09-23 correction)*: `GET /hmi/contentions` runs it on a 50-step no-override forecast branch, groups by contending trains, returns window cells + `perHandle` entry/headway; `store.contentions()` (used by Combined Actions). Reused as-is; the widget adds a throttled `store.refreshContentions()` so the ribbon stays current during play. |
| Delay origin/growth/compensation | the scenario's `*.plan.json` (`scheduled_at` per cell), loaded as `session.trainrun_plan` but only exposed as `has_plan` | ✗ to build *(2026-09-23 correction)*: a small `GET /hmi/plan`; delay per place = actual − scheduled — no separate attribution algorithm |
| Plan vs. actual vs. forecast tagging | the same plan (Soll line) + store history (Ist) + baseline scenario forecast (Prognose) | partial — v1 already draws Ist solid and Prognose dashed; the Soll line needs `GET /hmi/plan` |

**Actions out** — same pattern as shipped `marey`: hover/select mirrors
`store.setAgentHoverAgents` (cross-highlights map + timetable); train click
routes through `TrainActionService` (`writes: simulation`); link selection
is presentation-only (`writes: view`).

**Backend table**

| Field / capability | Available now | To build (flagged) |
|---|:---:|:---:|
| Agent trajectory points `(i, t, r, c)` | ✓ | |
| Walensee station axis (sort `scene.json` `stations` by `x`) | data ✓ | ✓ — small, scenario-specific, **this is the v1 axis path** |
| `flatland.envs.stations_links` types (`StationsLinks`, `Fibre`, `Link`, `Station`, `Gate`, `Pin`) | | ✓ — `flatland-rl` 4.2.6 → 4.3.0 bump (sdist-only build, reward-semantics change — re-baseline needed, per `flatland-ecosystem-reuse-plan.md` W8). **Confirmed not required for Walensee (§8.1)** — only matters for a future `SparseRailGen`-generated scenario. |
| Link-map linearisation algorithm | | ✓ — port `extract_link_map()` into `backend/app/core/link_map.py`, attribution comment (MIT). **Deferred**, same reason. |
| New endpoint `GET /{id}/hmi/link-map` | | ✓ — following `models/hmi.py` conventions. **Deferred**, same reason. |
| Conflict predictions exposed to the frontend | ✓ `/hmi/contentions` *(2026-09-23)* | mapping cells → axis is by column (corridor), see §8.2 |
| Delay attribution (origin/growth/compensation) | plan ✓ (session) | ✓ — `GET /hmi/plan` + actual − scheduled |
| Plan/forecast/actual reference tagging | partial (`mergedTrajectories`) | ✓ — tag, don't just merge |

## 5 · Allocation & accountability touchpoints

- **Loop stage:** context/monitor for reading the diagram; the existing
  decision-pill override affordance makes it also an **act** surface, same
  dual role the shipped `marey` already has.
- **Owner per mode (`allocation`):** human owns interpretation and train
  overrides in all three modes for v1 (unchanged from shipped `marey`) — see
  §3's flag that this may be wrong for Director specifically.
- **Decision events emitted:** train overrides go through the existing
  `TrainActionService` dispatch seam (already logged). Conflict
  acknowledgement and link selection emit no decision event — view-only.

## 6 · Acceptance scenario

Walensee (`pf-ch-wn-wal-long-approach`), the CAS-thesis interview corridor.

*(2026-09-23 correction: the scene itself has three trains and no
breakdown — the acceptance run is the interview tour's variant with the
`interview-e1-breakdown-single-track` disturbance, and the contention sits on
the single-track section MH–TIEF.)*

1. Operator opens the Zug-Weg-Diagramm widget. The y-axis shows named
   stations (Ziegelbrücke, Weesen, Walenstadt, …) and the track-less places
   of the single-track section, not raw cells — selecting a different active
   train no longer changes the axis.
2. The breakdown on the single-track section happens. Before the following
   trains reach it, a **conflict ribbon** appears over the Mühlehorn–
   Tiefenwinkel stretch, naming the contending trains and how soon.
3. The operator reads, without opening another panel: which section is
   contended, which two trains, and roughly when.

**Measurable success criterion (Q1, Q2):** an operator unfamiliar with the
scenario, shown the widget at the moment the ribbon first appears, correctly
names the contended section and both trains within 15 seconds, in ≥ 80% of
trials. This is also the first time any ZWL-family widget in this repo is
wired to `conflict_detector` — a concrete, checkable step toward the
Basisanforderungen doc's §4 requirement (currently "missing" per the
briefing's gap table).

## 7 · Effort & changes

**M–L overall for the Walensee-scoped v1** (the full B4 port is deferred, see
§8.1) — re-sequenced 2026-09-22 now that the 4.3.0 bump is confirmed
unnecessary for the priority scenario:

| Part | Effort | Priority |
|---|:---:|:---:|
| Walensee axis from `scene.json` `stations` (sort by `x`, render as y-axis labels) | S | 1 |
| Conflict overlay: reuse `/hmi/contentions` (already exposes `conflict_detector`), map onto the new axis, render ribbons | S–M *(was M–L; 2026-09-23)* | 2 |
| Delay localisation layer (`GET /hmi/plan`, actual − scheduled per place) — **built** | S–M | 3 |
| Plan/forecast/actual tagging (Soll line from the same plan) — **built** | S | 4 |
| *Deferred:* `flatland-rl` 4.3.0 bump, full `extract_link_map()` port, `store.linkMap`, corridor dropdown | M–L | later — only when a `SparseRailGen`-generated scenario is actually in scope |

Registration points (per `widget-authoring-process.md`):
`features/zug-weg-diagramm/`, `panel-plugin-host` (`@switch` + `.ts`),
`layout-designer` palette, `panel-mode-availability.ts` (omit — all modes),
`core/widgets/widget-catalog.ts` (new `B4` entry with `type:
'zug-weg-diagramm'`; retire/redirect the existing type-less `B2` entry to
point at this spec instead of duplicating it), `features/view-tabs/center-views.ts`.

## 8 · Open questions / risks

1. **Resolved 2026-09-22, and it changes the plan: Walensee/PF-CH will
   *not* get `StationsLinks` from the 4.3.0 bump either.** Checked
   flatland-rl PR #441 directly: `stations_links` is computed by
   `SparseRailGen._extract_stations_links()`, a method on that one generator
   class, built from its own internal city/gate/pin bookkeeping — it is
   **not** a generic post-processing step applicable to any rail. Checked
   `flatland-scenarios`' `ScenarioBuilder.to_rail_env()` next
   (`scenario_generator/model/scenario.py:80-87`): it builds the env via
   `rail_generator_from_grid_map()`
   (`flatland_integration/flatland_generators.py:7-14`), which wraps a fixed,
   hand-authored `RailGridTransitionMap` and returns an **empty**
   `agents_hints`, no `stations_links` key at all — regardless of
   `flatland-rl` version, because the generator that would compute it never
   runs. Walensee, PF-CH, and Olten are all in the identical position for
   the identical structural reason: none of our real-topology scenarios are
   built with `SparseRailGen`; all three hand a finished grid to the
   generator instead. Only a hypothetically freshly-`SparseRailGen`-generated
   scenario would get `StationsLinks` "for free."

   **This means the 4.3.0 bump does not unblock Walensee, and building the
   axis via the full ported `extract_link_map()`/`StationsLinks` pipeline is
   not the near-term path for the priority scenario.** Revised recommendation
   for v1: build the Walensee axis **directly from the scene JSON's own
   `stations` array** (§4 of the system-interaction table — already real
   names + x-coordinates, trivial to sort into a corridor axis, no
   `StationsLinks` dependency). Keep the ported flatland-hmi pipeline in the
   spec as the path for **synthetic/`SparseRailGen`-generated** scenarios
   (if/when one is used) rather than a blocking dependency for Walensee. This
   also means the `flatland-rl` 4.3.0 bump (§7, currently "priority 1,
   blocking") is **not actually required for the Walensee acceptance
   scenario (§6)** — it only matters once a `SparseRailGen` scenario is in
   scope. Re-sequence §7 accordingly before scaffolding: build the
   scene-JSON-based axis first, treat the bump + full port as a
   later/parallel track.
2. **Conflict-to-axis mapping.** `conflict_detector` reports conflicts in
   grid cell coordinates. The link-map port already builds a
   `mapping`/`reverseMapping` between grid cells and linearised axis
   positions (for train rendering) — the assumption is that the same map
   works for conflict coordinates, since it's the same grid. Not yet
   confirmed; if conflicts reference cells the link-map's linearisation
   doesn't cover (off the chosen corridor), the ribbon needs an explicit
   "conflict is outside this view" affordance rather than silently dropping
   it.
3. **Director's override pills, carried over unexamined (§3).** Every other
   widget with per-train action affordances (`agents-table`,
   `combined-actions`) suppresses them in Director because the AI owns
   actuation there. This widget's v1 does not, matching the shipped `marey`'s
   current (also unexamined) behaviour. Decide explicitly when Director mode
   differentiation is next touched — don't let this spec be the reason it's
   assumed fine.

   **User leaning (2026-09-23):** make the pills *configurable* (per layout /
   experiment condition) rather than on or off everywhere. Direct actuation in
   the diagram shows the system's power, but where it is simply available it
   pushes the recommendation logic and the Co-Learning flow into the
   background. Not built yet; decide the configuration seam (layout panel
   setting vs. experiment condition) when the pills are ported.
4. **Mode differentiation is explicitly out of scope for v1** (§3). This
   widget ships behaviourally identical to `marey` across modes, same as
   today. Flagged so it reads as a deliberate cut, per CLAUDE.md's "current
   focus" framing, not a miss.
5. **B2's catalog entry.** It currently exists as a type-less `planned`
   entry in `widget-catalog.ts`. Once this widget ships, that entry should
   be removed or repointed here rather than left as a duplicate "still to
   build" card in the Widget Gallery.
6. **Naming vs. implementation.** The user-facing title is "Zug-Weg-Diagramm";
   the ported code (`extract_link_map`, `LinkMapComponent`) keeps its
   upstream names internally. Not a risk, just noted so nobody goes looking
   for a `zug-weg-diagramm.py` upstream.
7. **Olten stays out of scope** (briefing §3, reaffirmed 2026-09-22): no
   design work in this spec accounts for a network without a single
   corridor. Its curation task (deriving `StationsLinks` manually from the
   24 known waypoint cells) is a separate, later effort.
8. **Found while building (2026-09-23).**
   - **Decision pills not in the first cut.** §3 describes the shipped
     `marey`'s override pills in all modes; the first cut leaves them out
     (catalog `writes: 'view'` — line click only selects the train). That also
     sidesteps §8.3 for now. Add them together with the Director decision.
   - **Forecasts during play.** The store refreshes `contentions` and the
     scenario forecasts only after discrete actions (step buttons, policy
     change), not while the simulation plays. The widget therefore calls a new,
     narrow `store.refreshContentions()` every 3 steps; the backend memoises
     per step. The dashed forecast lines still come from the scenario
     forecast and go stale during play, as in the shipped `marey`. Scenario-panel's
     throttling was left untouched (CLAUDE.md guardrail).
   - **Conflict → axis mapping (§8.2) holds by column.** The contention window
     is a path overlap, so the named section can be wider than the single-track
     stretch (e.g. "Mühlehorn – Murg"). That is the backend's window, reported
     as-is rather than narrowed.
   - **Not in the interview layout yet.** `preset-colearning-interview` pins
     its view tabs to `flatland-map` + `marey`; adding `zug-weg-diagramm` there
     is a decision for the interview setup, not made here.
   - **Orientation (user request 2026-09-23).** Default is the SBB convention:
     time runs down the vertical axis, places west→east along the horizontal
     one (names slanted above the plot). "Achsen drehen" switches to the
     classic Marey layout (time left→right, places top→bottom); the choice is
     remembered per viewer in `localStorage` (`zwd.orientation`).
9. **Priorities 3+4 as built (2026-09-23).**
   - **`GET /hmi/plan`** serves the *baseline* timetable
     (`baseline_trainruns_from_env`) cell by cell — deliberately not the plan
     the trains currently run on, so an accepted AI replan does not reset the
     yardstick. Tests: `backend/tests/test_hmi_plan.py`.
   - **Soll line**: the timetable per train, thin, in the train's colour at
     reduced opacity; Ist solid, Prognose dashed. Legend entries toggle the Soll
     line and the delay marks.
   - **Delay localisation** (`delayMarks` in `zug-weg-axis.ts`): delay per named
     place = step reached − step scheduled (late part only; running early counts
     as 0), actual where passed, forecast beyond. A mark is drawn only where
     that number *changes*: red = arises, orange = grows, green = made up
     (the existing severity/positive tokens). Forecast marks are hollow.
   - **Live mark**: a train held short of its next place (waiting behind the
     breakdown) accrues delay before it reaches anything named. When its next
     place is overdue and no forecast reaches it, the delay so far is marked at
     its current position on the now-line ("wächst gerade"). Without this the
     two waiting trains in the acceptance scenario showed no delay at all.
   - **No attribution model**: *where* a delay arises is localised, not *why*
     (knock-on vs. primary). Knock-on attribution would need the contention
     data joined in — a later refinement, not faked here.
   - **SBB view in a short panel**: the time axis keeps at least 300 px and the
     plot scrolls; the place names sit in a sticky header, and the now-line is
     kept in view (scrolls only once it leaves the visible part).
