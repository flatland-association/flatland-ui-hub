# Olten — source and licence

Three scenario variants of a real Swiss network (Olten), taken verbatim from
[`flatland-association/flatland-scenarios`](https://github.com/flatland-association/flatland-scenarios),
**MIT licensed**, path `scenario_olten/data/<variant>/serialised_state/<variant>.pkl`.

| File | Upstream variant |
|---|---|
| `olten.pkl` | `olten` — the undisrupted timetable |
| `olten_disrupted.pkl` | `olten_disrupted` |
| `olten_partially_closed.pkl` | `olten_partially_closed` — the variant the WP4 orchestrator playground runner loads |

Copied 2026-08-28. Verified to load and run under the pinned `flatland-rl==4.2.6`
(the upstream files were generated with 4.0.6 / 4.1.0), which settles the open
question in `docs/plans/flatland-ecosystem-reuse-plan.md` §W8: Olten does **not**
require the 4.3.0 bump.

Not copied, because nothing renders it yet: each variant's `position_to_latlon.pkl`
(a lat/lon mapping per cell) and the recorded trajectories under `event_logs/`.

## Names — `olten.geography.json` (added 2026-09-25)

The `.pkl` files carry no names. `olten.geography.json` names every cell a train
calls at or ends in (26 cells; all three variants' stops are covered — see
`backend/tests/test_olten_geography.py`). Served by `/hmi/geography` with
`layout: "network"`. Sources, in order of confidence:

1. **Platforms, Olten Hammer, Trimbach** — named in the upstream notebook
   `scenario_olten/scenario_olten.ipynb` (cell "Lat-Lon Mapping"): `olten1` …
   `olten12` ("names correspond to track number in Olten": tracks 1–4, 7–12),
   `hammer2`/`hammer4`, `trimbach2`. Mapped to cells by running the notebook's own
   grid code (`grid_coordinates`, origin (7, 20), 35 × 60).
2. **Portal destinations** (Basel, Sissach, Aarau, Solothurn, Bern, Luzern) —
   *derived*: the notebook names the portals only by line and compass side
   (`end10north`, `end6south`, …); the destination comes from the comments on
   its 52 timetable rows ("# Genf", "# Sissach via Trimbach", …) and was checked
   against `position_to_latlon.pkl` (bearing/distance from Olten track 1 matches:
   Hammer 0.8 km WSW, Trimbach 1.6 km N, Basel portals 2.2 km N, Aarau 1.8 km ENE,
   Bern/Luzern ~1.3–1.8 km S). Each portal entry says so in its `basis` field;
   worth a check by someone who knows the node (which southern pair is Bern
   vs. Luzern, the four eastern tracks all towards Aarau).

`end4south` (50, 0) is named with the Solothurn portal although no train uses
it. The `code` fields are this repo's ids, not SBB abbreviations.
