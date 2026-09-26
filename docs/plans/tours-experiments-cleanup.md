# Tours, experiments and layouts — the 2026-09-25 clean-up

Status: decided 2026-09-25 (items 1, 3, 4), open (item 2, widget choice).
Source: a run through every tour and both experiment conditions on the merged
state of `explore_db` + PR #96, then a decision round with Daniel.

Already done on the way:

- `fix(contentions)` (0771bf6): a contention group without a window crashed
  `/hmi/contentions` and took every other group of that request with it.
- `feat(tours)` (b996700): one picker entry per tour, briefing picked by the
  app language (`Tour.briefingIds`); old per-language links resolve through
  `TOUR_ALIASES` and set their language.

## Decisions, round 2 (2026-09-25)

- The Co-Learning Monte Carlo interview tour stays **unchanged** (answers
  open question 1a: no).
- Item 2: the two Combined Actions layouts and Guide Mode · Light are offered
  only under **Build your own**; the "Two modes · Guide Mode Light" tour goes.
- Item 3: questionnaire by **option (a)** — our renderer, the instruments'
  items re-authored verbatim with citations.
- PR #96 is merged into `explore_db`, so the Director tour can build on it.

## 1. One tour per mode, on the same disruption — plus Olten

Decision: every mode gets a tour, and the three mode tours run on the **same
Walensee disruption** (`pf-ch-wn-wal-long-approach`, E1 breaks down in Weesen),
so the one conflict is seen once per automation level. Olten stays as the
more complex tour.

| Mode | Tour | Change |
|---|---|---|
| Recommendation | `walensee-zug-weg` | pause at the conflict (below) |
| Co-Learning | `colearning-interview` | none — it is the thesis instrument and runs on `interview-e1-breakdown-single-track`; see open question 1a |
| Director | **new** `corridor-director` | briefing EN/DE on `pf-ch-corridor-stops` (16 trains, stops). Walensee was tried first: with 3 trains and no stops all three focuses plan identically, so the tour moved to the corridor, where they differ; needs `encoder_max_trains` 16 (done 2026-09-26) |
| (complex) | `olten-zug-weg` | unify the conflict label (map says "cell 23, 12", Zug-Weg says "Bern – Basel") |
| (reference) | `three-modes-original` | kept |

**Pause at the conflict** — done 2026-09-25: Combined Actions (strategies source) stops a guided run once per session at the first forecast contention (step 20 on Walensee), under the same rules as the impact panel's auto-pause. Original note: On autoplay the Walensee decision (steps 18–25)
is over before anyone has read it. A tour-level `pauseAtStep` (or pause on the
first forecast contention) stops the clock once, with the tour guide pointing
at Combined Actions.

**Director tour** depends on PR #96 (map anchor, option bars, the PF-CH
Director tour and the raised encoder caps). Built after #96 is merged, or on
top of it with a note in the PR.

Acceptance: the picker offers a tour for each of the three modes; the three
mode tours name the same disruption in their briefings; Walensee pauses by
itself at the conflict; Olten's map label and Zug-Weg banner name the same
place.

Open 1a: move the Co-Learning interview to `strategy-e1-breakdown-weesen` as
well? It would make the three identical, but the interview instrument would
change mid-thesis — default **no**.

## 2. Layouts — what stays in the tours, what moves to "Build your own"

Inventory (2026-09-25):

| Layout | Left | Centre | Right | Used by |
|---|---|---|---|---|
| System · Recommendation | situation, events, trains | map / ZWL | impact, recommendations, train detail | Three modes |
| System · Co-Learning | situation, events, trains | map / ZWL, reflection | what-if, impact, scenario | Three modes |
| System · Director | — | directive, strategy tiles, map / ZWL | weights, forecast, AI activity, reflection, learning effect, impact | Three modes, Director only |
| Recommendation · Study 2 | situation, events, trains | map / ZWL | recommendations | Experiment |
| Co-Learning · Study 2 | situation, events, trains | map / ZWL | what-if, reflection | Experiment |
| Guide Mode · Light | situation, events, trains | map / ZWL / timetable | impact, what-if, train detail, decision log | Two modes |
| Co-Learning · Interview | situation, events, decision log | map / Zug-Weg, timetable | impact, Plan/KI/Mensch | Interview |
| Olten · Zug-Weg | events | map · Zug-Weg + timetable | Combined Actions, train detail | Olten |
| Zug-Weg · Korridor | events | map, Zug-Weg, timetable stacked | Combined Actions, train detail | Walensee |
| Combined Actions · Demo | situation, events | map / ZWL, timetable | Combined Actions | — |
| Combined Actions · Package (Roman) | problem, situation | map / ZWL | one action package | — |

Leaning (not decided): keep both Combined Actions layouts as worked examples,
optimise them, and offer them only in **Build your own**, not as tours. Same
question for Guide Mode · Light and its two-modes tour.

## 3. The experiments — Study 2 kept, Study 3 beside it, one questionnaire

**Done 2026-09-25.** Study 2 stays as the dispatcher review designed it and
only gains the questionnaire; the updated conditions are **User Study 3**,
side by side (`core/demo/study-conditions.ts`):

- Study 3 pins scenario, disturbance and map range (Walensee long approach,
  `strategy-e1-breakdown-weesen`, columns 69–126); the start screen states
  them instead of offering a choice.
- Layouts `preset-recommendation-study3` / `preset-colearning-study3`: situation
  and events left; track map over Zug-Weg-Diagramm in the centre; right
  Combined Actions with simulated strategies + train detail, or Plan/KI/Mensch
  + impact + reflection.
- Every condition ends with **Finish & questionnaire** (footer) and answers the
  same fixed set: NASA-TLX raw, Jian trust, perceived understanding, open
  feedback. **Submit & download** saves one JSON record — answers, scores
  computed as hmisurveys does (`core/survey/survey-scoring.ts`), and the
  condition, scenario and disturbances.
- Items re-authored from hmisurveys (option a); the understanding instrument's
  factual and conceptual probes are domain-specific and not written yet.

Original analysis below.

## 3a. The two experiments — fixed scenario, validated questionnaire (analysis)

Decision: each condition runs one **fixed scenario** and ends in a
questionnaire from **`AI4REALNET/hmisurveys`** (TU Delft, validated
instruments), replacing our home-grown items in `core/survey/survey-configs.ts`.

Per condition:

- fixed scenario and disturbance, preselected (today: none ticked, so the
  Recommendation condition shows "no active recommendations" for the whole run
  while the map announces a conflict);
- `mapFocusCols` on the corridor (today a hairline);
- a defined end ("Finish & survey"), then the questionnaire;
- layout updated: Zug-Weg-Diagramm instead of ZWL; Recommendation gets Combined
  Actions with simulated strategies instead of the old recommendations panel;
  Co-Learning gets Plan/KI/Mensch and impact as in the interview layout.

Instruments available in hmisurveys: NASA-TLX (and 1-part TLX), RSME, Modified
Cooper-Harper, SART, SA general, Trust in automation (Jian et al. 2000), TAM,
Van der Laan acceptance, UEQ / UEQ-S, Understanding (+ calibrated), HAT
(human-autonomy teaming), and a survey chainer that emits one JSON.

**Licence — needs a decision before any code is copied.** hmisurveys is
**GPL-3.0**; this repo is **Apache-2.0**. GPL code cannot be relicensed into an
Apache repo. Options:

- (a) Keep our survey renderer and re-author the item sets exactly as the
  published instruments define them (the scales are literature, not GPL code),
  citing Borst 2025 (DOI 10.5281/zenodo.17495928) and the original authors.
- (b) Serve the unmodified hmisurveys HTML separately (git submodule or a
  separate static mount, keeping its own licence) and embed it by `<iframe>`,
  collecting results over `postMessage` — the integration the README intends.
- (c) Vendor the HTML files into the repo under their GPL licence as a
  separate work — needs a licence check, not recommended without one.

Recommendation: (b) — unmodified instruments are the point of "validated",
and the README asks that they not be modified.

Open 3a: which instruments per condition (suggestion: 1-part TLX, Trust,
Understanding; plus HAT for Director once it gets an experiment).

## 4. Zug-Weg-Diagramm everywhere, Marey archived

Decision: the Zug-Weg-Diagramm replaces the old time–distance chart (Marey /
"ZWL") in every layout; the Marey is archived.

- Presets: `marey` tabs become `zug-weg-diagramm`.
- The `toggle-view` composite and the `graphic-timetable` / `marey` panel
  types render the Zug-Weg-Diagramm, so layouts saved in a browser keep
  working.
- Centre views and the layout-designer palette no longer offer the Marey.
- Catalog: the `marey` entry gets status `archived`; the components stay in
  `features/marey-chart` and `features/graphic-timetable` as reference, unused.

## 5. Widgets worth using per mode

In the catalog, not yet in any mode tour or experiment:

| Widget | Status | For |
|---|---|---|
| Risk & Uncertainty (A1) | first-cut | Recommendation: confidence and uncertainty band next to the proposal; the missing "how sure is the AI" |
| Decision Log (A2) | first-cut | all modes; Co-Learning reflection, experiment accountability |
| What-if Compare (B1, blue = you / yellow = AI) | first-cut | Co-Learning experiment |
| Problem Overview (E1c) | first-cut | Recommendation: states the problem before any action |
| Reflection prompt | first-cut | Co-Learning |
| Shift review, strategy reflection | shipped | Director tour closing |

On branches, not merged:

| Widget | Branch | For |
|---|---|---|
| **Learning Moment** — predict first, then see what the alternative did (forked forward simulation, prose kept apart from numbers) | `roman/director-strategies-shift-review` (2026-08-27) | Co-Learning; the "predict → compare" loop of Kolb, directly |
| **Policy-Divergence Event Graph** — all policies rolled forward in lockstep, nodes only where futures differ, hover shows that state | `state_graph` (2026-07-23) | Director / Co-Learning; close to TraceRL's branch tree (A3S), worth aligning |
| LLM chat panel | `first_llm_test` (2026-07-14) | a seam test, not a mode widget |

Planned only: Trade-off frontier (C1), triaged event feed (C2), autonomy dial
(D1, Director), AI track record (A3), partial non-control zones (D2).

Open 5a: which of Learning Moment / Policy-Divergence Graph / Risk &
Uncertainty to bring into which mode.

## Order of work

1. Item 4 (mechanical, decided).
2. Item 1: Walensee pause, Olten label; Director tour once #96 is in.
3. Item 3 after the licence decision.
4. Items 2 and 5 after the decision.
