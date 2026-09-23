# Widget spec — Zug-Weg-Diagramm (v2)

> Additional widget alongside the shipped `marey` (Graphic Timetable) — not a
> replacement. Archiving `marey` is a separate, later decision
> (`docs/plans/zwl-improvements-briefing.md` §5.5).
> Supersedes/merges catalog entries **B4** (`widget-linkmap-zwl.md`) and **B2**
> ("Conflict-aware Marey") into one build, per the 2026-09-22 decision recorded
> in the briefing (§5.2). Grounded in that briefing throughout — read it first.

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
| **Station axis for Walensee (v1 path)** | `pf-ch-wn-wal-long-approach.scene.json`'s existing `stations` array (10 real stops with `x`/track), sorted into a corridor — no `StationsLinks` needed | ✓ data exists, ✗ the sort-into-axis code |
| Station/link axis for a future `SparseRailGen` scenario | new `store.linkMap` signal, new endpoint, ported `extract_link_map()` | ✗ to build (B4 port) — **not on the critical path for Walensee, see §8.1** |
| Link/corridor picker | for v1, a static list from the scene JSON (Walensee is one corridor, so this is closer to a label than a choice); the ported `StateService.getLinks()` equivalent applies once a multi-link scenario is in scope | ✓ trivial for v1, ✗ deferred for the general case |
| Conflict predictions | backend `conflict_detector` | exists internally (`scenario_runner.py`), **not exposed via any HMI endpoint today** — ✗ to build |
| Delay origin/growth/compensation | — | ✗ to build — needs backend attribution, not just the raw past/future line the shipped widget already draws |
| Plan vs. actual vs. forecast tagging | `mergedTrajectories` already merges history + forecast | partial — needs tagging by reference type, not just a merge |

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
| Conflict predictions exposed to the frontend | internal only | ✓ — new endpoint/signal wrapping `conflict_detector`, and a mapping from its cell coordinates through the link-map's `mapping`/`reverseMapping` (see §8 risk) |
| Delay attribution (origin/growth/compensation) | | ✓ — new backend computation |
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

1. Operator opens the Zug-Weg-Diagramm widget. The y-axis shows named
   stations (Ziegelbrücke, Weesen, Walenstadt, …), not raw cells — selecting
   a different active train no longer changes the axis.
2. The single-track breakdown scenario runs. Before the two trains actually
   meet, a **conflict ribbon** appears on the Ziegelbrücke–Walenstadt
   section, naming both trains and the step range.
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
| Conflict overlay: expose `conflict_detector`, map onto the new axis, render ribbons | M–L | 2 |
| Delay localisation layer | M | 3 |
| Plan/forecast/actual tagging | S–M | 4 |
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
