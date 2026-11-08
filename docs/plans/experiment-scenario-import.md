# Experiment scenarios from `.pkl` files — the Plan B scenarios on top of the experiment workflow

> **Status: agreed 2026-11-02; §8 steps 1–2 implemented.** Plan B content
> (§4, §8 step 7) in progress since 2026-11-07: the scenarios are a tutorial
> plus four (not six), and the ten conditions exist; the briefing text and the
> final questionnaire follow. §3.7 (train and station names) is agreed
> (2026-11-03, §6); the drawing tool's stations phase 2 it waited for is done
> (flatland-scenarios `feature/grouped-station-format`, 2026-11-04), and §3.7
> is updated to it and implemented (§8 step 4). §3.8 (seconds per step) added 2026-11-04, §6 Q5 decided, implemented (§8 step 5).
> **Builds on:** #157 (`feature/129-experiment-logging`), which builds on #156
> (`feature/131-experiment-workflow-definitions`, plan
> [experiment-workflow.md](experiment-workflow.md)) and #146 (configurable UI).
> This PR targets `main` (#157 is merged).
> **Closes the gap #156 leaves open on purpose:** its §4 says "Defining the six
> networks and the ten conditions is **not part of this PR**" (Q13). This plan
> is how those six networks get in — as `.pkl` files built outside this repo —
> and the few changes the workflow needs to run them as the study wants.
> **Upstream:** flatland-rl PR `feat/scheduled-malfunction-effects-generator`
> (`ScheduledMalfunctionEffectsGenerator`); not released, see §3.6.

---

## 1. What is asked

The Plan B study runs each participant through a tutorial and four fixed
scenarios (first planned as four of six; reduced to four on 2026-11-07),
then one questionnaire. The scenarios are drawn in the Flatland Environment
Drawing Tool and turned into a `RailEnv` `.pkl` by `flatland-scenarios`'
`scenario_generator` (tool export + `config.json`).

1. **A scenario is** a `.pkl` that holds **the whole simulation**, plus a
   title, a description and an optional image (one language for now).
2. **Nothing about the simulation changes at run time**: no random
   breakdowns, no disturbance files, no session settings on top of the `.pkl`.
   The only malfunctions are the scheduled ones inside the `.pkl`.
3. **The experiment** — briefing page, scenarios in a fixed order per
   participant, questionnaire(s) — is what #156 already builds, with three
   adjustments (§3.3–§3.5).

## 2. What #156/#157 already provide

| Need | Provided by | Where |
|---|---|---|
| Experiment = sequence of scenarios + questionnaire | `StudyCondition` with `legs: ExperimentLeg[]` | `core/demo/study-conditions.ts` |
| Experiment description page with image/video | the briefing's opening pages, `BriefingSection.media` | `core/demo/tour-briefings.ts`, `StudyCondition.briefingIds` |
| Per-scenario intro page before it starts | the intro card (`ModeIntro`), per leg via `ExperimentLeg.intro` | `features/mode-intro/`, `TourContextService.modeIntroFor` |
| Each scenario on a fresh session of its own preset | `startConditionLeg()` with `leg.scenarioId` | `app.component.ts` |
| Fixed layout + mode, UI restrictions | `StudyCondition.layoutId`, `.mode`; layout `ui` block (#146) | `study-conditions.ts`, `layout-presets.ts` |
| Questionnaire after each leg and/or at the end | `legSurveyParts`, `surveyParts` | `study-conditions.ts`, `ExperimentRunService` |
| One record per run, resume after reload | `ExperimentRunService`, run record | `core/demo/experiment-run.service.ts`, `core/interaction-log/` |

The experiment definition therefore stays **TypeScript in
`study-conditions.ts`**, like #156's — not a separate JSON format, which would
be a second experiment model next to `StudyCondition`. (This reverses the
"experiments as JSON" idea of the first draft; the scenarios remain files.)

## 3. Changes

### 3.1 Scenarios as files (backend)

One folder per scenario:

```
backend/app/fixtures/scenarios/<scenario-id>/
  scenario.pkl      # RailEnvPersister format, from scenario_generator
  scenario.json     # metadata, below
  scenario.png      # optional image (png, jpg or svg)
```

```json
{
  "id": "plan-b-s1",
  "title": "Störung am Einspurabschnitt",
  "description": "Ein Zug bleibt mitten im Einspurabschnitt stehen …",
  "image": "scenario.png",
  "source": "flatland-scenarios scenario_generator (drawing tool export + config.json)"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Equals the folder name; unique across all presets. Used as `ExperimentLeg.scenarioId`. |
| `title` | yes | Intro card heading; gallery card. |
| `description` | yes | Plain text, blank lines separate paragraphs. |
| `image` | no | File in the same folder. |
| `source` | no | Provenance for the gallery card. |
| `seconds_per_step` | no | Real seconds per simulation step at the default pace, number ≥ 0.1 (§3.8). |

`scenario_presets.py` discovers the folders at import and registers each as an
`env` preset (`path = scenario.pkl`) with `title`, `description`, `image_url`,
`experiment_only: true`. Grid size and train count are read from the env once
at discovery, not written by hand. A malformed `scenario.json` (missing field,
id ≠ folder, image file missing, duplicate id) fails startup with a message
naming the file — a study must not run with a silently dropped scenario.

`GET /session/scenario-presets` lists them (so the `/scenarios` gallery shows
them); the free Infrastructure picker leaves out `experiment_only` presets.
`GET /session/scenario-presets/{id}/image` serves the one file the JSON names.

JSON, not a spreadsheet: diffable, validated, and the form of the other
fixtures (`*.geography.json`, disturbance files).

### 3.2 Nothing on top of the `.pkl` (backend)

For an `experiment_only` preset, `POST /session` rejects `disturbance_ids` and
a `malfunction_rate > 0` (the live variant) with a 400, instead of applying
them. The existing env-preset load path (`load_preset_env`) already adds
nothing else. On discovery, a scenario whose env has a random malfunction
generator (rate > 0) logs a warning: the six Plan B scenarios have scheduled
malfunctions only, and a random rate would make two participants see
different runs. The leg's `seed` is still passed; with scheduled malfunctions
only it changes nothing.

### 3.3 Intro card from the scenario (frontend)

A leg without its own `intro` whose preset has a `title` gets a **scenario
card**: title, description paragraphs, optional image, and the existing
"Szenario starten" button and "⟨name⟩ (k/N)" eyebrow. No mode sections
(role, controls, watch-for, goal) — not needed for these scenarios.

- `TourContextService` gains `scenarioCardFor(leg)`, resolving the preset's
  `title`/`description`/`image_url` from the loaded preset list.
- `ModeIntroComponent` renders that card when there is no `ModeIntro` for the
  leg. Fixed labels stay i18n keys; title and description are content from
  the file, like the authored briefing text.
- `ExperimentLeg.nameKey` (the stepper's "⟨name⟩ (k/N)") becomes optional:
  without it the stepper shows the scenario's `title` (decided, §6 Q1).
  `TourContextService.legName(leg)` resolves it for the live run and the replay.
- The replay shows the same card (`ReplayService.scenarioCard`).
- The map opens on the whole network: a briefing's `mapFocusCols` belongs to
  its own network (Walensee, columns 69–126), so a leg on an experiment
  scenario does not inherit it; the leg's own `mapFocusCols` still applies.

### 3.4 Policy pinned per experiment (frontend)

`StudyCondition` gains `policy?: PolicyName`. At every leg start the run sets
it (`store.setActivePolicy`). The policy is sent with every step, so this is
what runs — independent of the layout's `policyAllowlist`, and therefore of
the #146 issue that the active policy is not recomputed when an allowlist is
applied. Plan B: `deadlock_avoidance` for now, the study's own policy later.

### 3.5 Run flow adjustments (frontend)

- **No Schichtbilanz:** #177's `StudyCondition.shiftSummary: false` (this
  branch had its own `review` flag until the rebase, §4). `nextLegOrReview()`
  then goes from the last leg straight to the final questionnaire.
- **A leg also ends when its episode ends:** today a leg ends by the toolbar's
  finish button or the guide's "Schicht beenden" (hidden in Plan B by
  `control.endShift`). An effect advances the run when the episode is done
  (all trains arrived or horizon reached) in phase `running`, with reason
  `'episodeEnd'` in the record — so a participant is never stuck.
- **Questionnaire after a single leg** (for "2 scenarios, questionnaire, 3
  scenarios, questionnaire"): `ExperimentLeg.surveyParts?` — a questionnaire
  after this leg, taking precedence over `legSurveyParts`. **Not in this PR**
  (decided, §6 Q2): Plan B does not need it.

### 3.6 The scheduled-malfunction class (both repos, temporary)

The `.pkl` stores its effects generator as a class path, which must be
importable where the `.pkl` is loaded. The class is in flatland-rl's PR but
not released, and no release is planned soon.

Until then both sides carry a compat copy **registered under flatland-rl's
future path**, `flatland.envs.malfunction_effects_generators.ScheduledMalfunctionEffectsGenerator`:

- the copy's `__module__` is set to that module, and it is attached to it with
  `setattr` — only if flatland does not have the class yet;
- ui-hub imports the compat module (`app/utils/flatland_compat.py`) from
  `app/core/scenario_presets.py`, which every `.pkl` load goes through — so
  tests and scripts that never import `app.main` get it too;
- flatland-scenarios' `malfunctions.py` does the same instead of defining its
  own class, so the `.pkl`s it writes already carry the future path.

Cleanup once ui-hub runs a flatland-rl with the class: delete both compat
copies. The `.pkl`s stay valid, nothing is regenerated.

It is a hack — two repos attach a class to a flatland module from outside —
accepted for the study (decided 2026-11-02) and marked with a `TODO` pointing
at the flatland-rl PR in both places.

### 3.7 Train and station names from the generator output (backend, one line frontend)

**Today.** Every session names its trains from one authored roster
(`TrainIdentityService.SERVICE_ROSTER`: handle 0 = `IC_703`, 1 = `ICE_42`, …),
whatever the scenario. Stations get a name only where `GET
/session/{id}/hmi/geography` names their cell (the PF–CH scenes, Olten's
sidecar); everywhere else the store labels them `S1`, `S2`, … by position. An
experiment scenario therefore shows `IC_703` for the drawn `Z-W-1-S`, and `S3`
for Ziegelbrücke.

**Where the names are.** Since the drawing tool's stations phase 2
(flatland-scenarios, 2026-11-04) **station names are in the `.pkl`**: the
generator writes `env.stations_links`, whose stations carry the name given in
the tool and their stopping points (`Ziegelbrücke.0` at a platform cell),
which `RailEnvPersister` keeps. An unnamed station is named by its tool id
("3"). **Train names are not:** Flatland agents have no name, and
`RailEnvPersister` has no slot for extra data. They live in the scenario
generator's output JSON (written next to the `.pkl`): `timetables[i].name` is
the name of handle *i* — the same rule the generator uses to resolve
`"train": "Z-W-1-S"` in `config.json`.

**Change.** The scenario folder takes the generator output as an optional
fourth file, for the train names:

```
backend/app/fixtures/scenarios/<scenario-id>/
  scenario.pkl
  scenario.json
  generator.json    # optional: the scenario generator's output .json, copied unchanged
  scenario.png
```

- **Discovery** (`_load_scenario_folder`):
  - **Stations** from the `.pkl`'s `stations_links`, when it has any: the
    preset keeps (internally) a `geography` with one entry per stopping
    point, in the shape Olten's sidecar already has (`{code, name, track,
    cell, kind: "platform"}`, `layout: "network"`, no `locations`, no
    `single_track`): `code` and `name` the station's name, `track` the
    stopping point's index + 1, `cell` its node. *§3.9 changes the layout
    to `"corridor"`.*
  - **Trains** from `generator.json` if present, checked against the `.pkl`:
    same grid size, one timetable per agent, train names unique and
    non-empty. A mismatch fails startup with the file named, like every other
    folder error — a stale `generator.json` would put the wrong name on a
    train. The preset keeps `train_names`: `[timetables[0].name, …]`, in
    handle order.
- **`GET /session/{id}/hmi/geography`** returns that geography for an
  experiment scenario (the existing `network_geography` branch, fed from the
  preset instead of a sidecar file), plus a new list `trains: [{handle,
  name}]`. Other presets return `trains: []`.
- **Stations need no frontend change:** `SessionStore.stationNameAt` already
  prefers a geography name over `S{n}`, and the map, the timetable, the
  impact panel and the ZWL all read it. A drawn station without a
  name shows its tool id ("3"). A `.pkl` without `stations_links` (built
  before phase 1) keeps `S{n}`.
- **Trains:** `TrainIdentityService.nameByHandle` uses `geography.trains`
  when the session has them, otherwise the roster as today. Every surface that
  names a train (21 components, the notification texts via
  `withTrainNames`) goes through this service, so none of them changes.
- **Replay** gets the names for free: it answers `/hmi/geography` from the
  recorded call. Records written before this change replay with the roster,
  as they were seen.

**Why the geography response, not `SessionInfo`.** It is the per-session
"names of this network" call the store already makes, and the replay serves it
from the recording; a field on `SessionInfo` would be lost in the replay, which
rebuilds the session from the record header.

**The `.pkl`s must be regenerated** with the current scenario generator after
naming the stations in the tool: `uc2-1`'s `.pkl` predates phase 2, so its
stations are named "2" … "5".

**What stays as it is.**
- Built-in presets (Walensee, Olten, the generated networks) keep the roster:
  the Walensee briefings name `IC_703` in their text.
- Study data: logs and decision records reference trains by handle; a
  decision record carries the displayed order next to the handles, which is
  then the scenario's names.
- **Combined Actions** ranks "long-distance first" by roster name
  (`TRAIN_WEIGHT`); an unknown name gets the default weight, so with drawn
  names that ordering falls back to handle order. Not in the Plan B layout;
  a weight from the timetable's `trainCategory` is a later step.
- Train categories and speeds in `generator.json` are not used yet.
- The ZWL builds its axis from the rail grid
  (`core/route_axis.py`) and needs no `stations_links` links; flatland-hmi's
  does, which is why links come in a later flatland-scenarios PR.

### 3.8 Seconds per step from the scenario (backend, frontend)

**Today.** The toolbar's speed slider has five levels of steps per second
(`core/play-speed.ts`: 0.25, 0.5, 1, 3, 10; level 2, 0.5 steps/s = 2 s per
step, is the default). A leg can start on another level
(`ExperimentLeg.playSpeedLevel`). The backend's play loop takes any speed but
waits at most 10 s per step (`websockets.py`, `max(speed, 0.1)`), and a speed
change while playing (`POST /play` retunes `state.speed`) only applies after
the wait in progress.

**Change.** `scenario.json` gets an optional `seconds_per_step`: how many real
seconds one simulation step lasts at the scenario's default pace (a number
≥ 0.1, e.g. `3` or `1.5`; no upper limit: a study's value is honoured, not
clamped). 0.1 is the slider's fastest level today; the faster levels of a
quick scenario may then run as fast as the backend can step. It is the default whether or not the layout shows the slider; Plan B's
layout hides it (done elsewhere), the other layouts keep it.

| Field | Required | Notes |
|---|---|---|
| `seconds_per_step` | no | Number ≥ 0.1; without it the app's default (2). |

- **Discovery** validates it (a number, not a boolean or string, ≥ 0.1; else startup
  fails naming the file and field) and `GET /session/scenario-presets` lists
  it on the preset (`ScenarioPreset.seconds_per_step?`).
- **Backend play loop:** the 10 s floor goes (`PlayRequest.speed` must be
  > 0 instead), and the wait between steps is slept in short slices against
  the current `state.speed`, so a slider change applies at once even during a
  long step. Without that, level 1 of a 10 s scenario (20 s) would be clamped
  back to 10 s.
- **Frontend (decided, §6 Q5 a):** the slider's levels become factors of
  a per-session base pace instead of fixed speeds: `[0.5, 1, 2, 6, 20]` ×
  base, base 0.5 steps/s by default — the same five speeds as today. A session
  on a preset with `seconds_per_step` gets base `1 / seconds_per_step`, so
  level 2 ("normal") is exactly the scenario's pace and the other levels keep
  their ratio to it. The toolbar's "1 min = n s" label already derives from
  the speed. A leg's `playSpeedLevel` still picks a level, now relative to its
  scenario.
  - `SessionStore` gets `playSpeedBase` (set in `newSession` from
    `opts.secondsPerStep`); `playSpeed = base × factor(level)`.
  - The app passes `secondsPerStep` from the preset whenever it creates a
    session on one (experiment legs and the `/scenarios` gallery);
    a restart keeps it, like the preset id.
- Built-in presets have no `seconds_per_step` and run as today. The replay is
  unaffected (it plays the recorded timeline at its own `REPLAY_SPEEDS`).

### 3.9 The ZWL draws an experiment scenario as a corridor (backend)

**Today.** §3.7 gives an experiment scenario's geography `layout: "network"`,
the shape of Olten's sidecar. The ZWL (Zeit-Weg-Linie-Diagramm) only draws an axis by
itself for `layout: "corridor"` (`zwl-axis.ts` `columnAxis`); for a
network it shows "Dieses Szenario ist ein Netz, keine einzelne Strecke. Wähle
oben einen Abschnitt …" until the participant picks two stations. Nothing
picks a section by default (`SessionStore.zwlRoute` starts `null`). With
the Plan B layout opening on the ZWL (#168, PR #171), every Plan B leg on a
drawn scenario would open on that empty diagram.

**Change.** `_stations_links_geography` (`scenario_presets.py`) returns
`layout: "corridor"` instead of `"network"`. All Plan B scenarios are
corridors, so the existing column axis fits them:

- The axis runs from the station farthest left to the one farthest right:
  `columnAxis` places each station at its platform column (the leftmost
  stopping point of a station with several) and sorts by column.
- The view still opens zoomed to where the trains run, widened to the next
  station on either side ("Ganze Strecke" shows the whole axis), as on
  Walensee. A participant can still pick a section; the pickers then offer
  "whole corridor" instead of "choose".
- `locations` and `single_track` stay empty: no places between stations, no
  single-track shading on the axis. Deriving single-track sections from the
  rail grid is a later step.
- No frontend change; `isNetwork()` is false for these scenarios, so the
  corridor texts apply.

**Limit.** A future experiment scenario that is a network rather than one line
would get a misleading axis (positions by column across branches). It then
needs an explicit `"layout": "network"` in `scenario.json`, added when such a
scenario exists (§6 Q7).

### 3.10 The Plan B final questionnaire (frontend)

Source: `261105_FragebogenFinal.docx` (2026-11-05, study team), "Finaler
Fragebogen für User Study 2". Six pages, German, asked once per participant
after the last scenario (it replaces `DEFAULT_SURVEY_PARTS` on the ten
conditions). Requirements from the document: every item must be answered;
the demographics (page 6) only once, at the very end; the agreement items as a
matrix (one row per item, one radio column per scale point, the labels above
the columns, as in the document's example picture).

| Page | Items | Answer |
|---|---|---|
| 1 | 1–3 responsibility, accountability, control | 7-point agreement matrix |
| 1 | 4 own share of the result vs. the AI system | slider 0–100 % with a number box |
| 2 | 5–8 challenge, development, fit with own goals | 5-point agreement matrix |
| 3 | 9–12 task significance; 13–17 own role | 5-point matrix, two blocks |
| 4 | 18–27 trust in the system | 7-point matrix |
| 5 | 28–37 ease of use, usefulness, intention to use | 7-point matrix |
| 6 | AI use in daily life (6 options), age, gender (3 options), years as dispatcher | radio list, text, radio list, text |

Design:

- **Pages.** `SurveySection.page` and `SurveyConfig.paged`; a survey without
  `paged` renders as before (one scroll). Above the items "Seite k von 6" with
  one dot per page; below them "‹ Zurück" (from page 2 on, left) and
  "Weiter ›" (right), on the last page "Absenden". With `requireAll`, "Weiter"
  and "Absenden" stay active, but a page with open items does not advance: the
  items get a red bar, the first scrolls into view, a line says "Bitte
  beantworte alle Fragen auf dieser Seite." "Absenden" checks every page and
  opens the first with an open item. "Zurück" always works and keeps the
  answers. A page turn is logged as context event `survey_page`
  `{surveyId, page}`; the buttons carry click ids `surveyUi.back/next/submit`.
- **No close.** `closable: false`: no × and no "Abbrechen"; the questionnaire
  ends by submitting.
- **Matrix.** A section with `scale: string[]` (the column labels) renders its
  `likert` items as a matrix with real radio inputs (`name` = item id, keyboard
  and screen reader as radio groups). Narrow screens: each item stacks with its
  options below.
- **Percent slider.** New type `percent`: a number box with "%" above a
  full-width range 0–100, both bound to one value; no thumb and unanswered
  until moved or typed, so 0 % is an answer, not a default.
- **Radio list.** `radio` with `layout: 'list'` renders vertical radio inputs
  (page 6); the existing chips stay for the other surveys.
- **Numbers.** New type `number` (min, max, step, unit): age 15–99 whole
  years, years as dispatcher 0–60 in half years; outside the range counts as
  unanswered.
- **Data.** Item ids `pb_1` … `pb_37`, `pb_ai_use`, `pb_age`, `pb_gender`,
  `pb_years`; answers stored as the scale value (1..7 / 1..5), the percent as
  a number, radio answers as the option text. Config id `plan-b-final`; one
  survey part `plan-b-final` that the ten conditions name as `surveyParts`
  (not offered in Settings; `postSessionSurvey()` returns the whole
  questionnaire for it). Item numbers are not shown. Scores: none for now
  (raw answers only; the export already writes one row per item).
- **Language.** German, written as data in `survey-configs.ts` like the other
  instruments (questionnaires are not i18n keys). Divergence from AGENTS.md
  ("questionnaires stay English"): this study's instrument is German.
- **Replay.** Shows the recorded answers read-only, all pages one under the
  other (no navigation needed to review).

Decided 2026-11-07: slider empty until touched; grammar fixed (below); item
numbers hidden; age and years as number fields; gender with the document's
three options; no close or cancel.

Wording changed against the document, for the study team's review:

- Items 5, 6, 8: "Während diesen Aufgaben" → "Während dieser Aufgaben" (as
  item 7).
- Items 9, 11: "Diese Aufgaben wirkte sich" → "wirkten sich".
- Items 18–27: full stop added, as in the other items.
- Items 30, 34: comma after "Ich finde"; item 35: comma after "Angenommen".
- Page 1: "Auf einer Skala von 1–7: Inwieweit stimmst du …?"; scale ranges
  with an en dash, "5 = …" with spaces.
- Column labels in lower case throughout ("stimme …", "teils/teils").
- Page 6: "(privat und beruflich): Wie häufig …"; options in lower case
  ("nie"); "Wie viele Jahre hast du als Dispatcher*in? (in Jahren)" → "Wie
  viele Jahre arbeitest du schon als Dispatcher*in?" with the unit "Jahre".

Bundle size: the production build's initial bundle is 2.01 MB with this,
12 kB over the 2.00 MB error budget in `angular.json` (it was 1.99 MB before);
decided 2026-11-08: the error budget is raised to 2.10 MB (loading the
questionnaire lazily would not save it: its texts load with the conditions).

## 4. Plan B content

Decided 2026-11-07 (§6, Plan B):

- **Five scenario folders** (§3.1): `tutorial`, `uc2-1` … `uc2-4`, each with
  `scenario.json` (`id` = folder name, German title and description,
  `seconds_per_step`), `generator.json` and `scenario.pkl`. Built from
  `draw.json` + `config.json` in the same folder by flatland-scenarios'
  `generate_scenarios_for_ui_hub.py`, **run with this repo's backend Python**
  (`flatland-rl==4.3.0`): a `.pkl` written by a newer flatland-rl does not
  load here (`Agent.__new__() takes from 17 to 22 positional arguments but 24
  were given`). Folders starting with `_` are skipped by discovery (`_test`,
  `_example-scheduled-malfunction`).
- **Ten conditions** `plan-b-p01` … `plan-b-p10` (`study-conditions.ts`,
  `PLAN_B_CONDITIONS`), one per participant: `layoutId: 'preset-plan-b'`,
  `mode: 'co-learning'`, `policy: 'deadlock_avoidance'`, `shiftSummary: false`,
  `studyLogging: true`, no `legSurveyParts`, `surveyParts` for the final
  questionnaire (for now `DEFAULT_SURVEY_PARTS`; the study's own content
  follows). Five legs each: `tutorial` first, then the four UC2 scenarios in
  the participant's order. Legs are shared objects, `seed: 42`, no
  disturbances, named by the scenario's title.
- **Orders** (`PLAN_B_ORDERS`): drawn at random once,
  `random.Random(20261107).shuffle(['uc2-1', 'uc2-2', 'uc2-3', 'uc2-4'])` per
  participant, and fixed in the code:

  | Participant | Scenarios 2–5 |
  |---|---|
  | p01 | uc2-3, uc2-1, uc2-2, uc2-4 |
  | p02 | uc2-1, uc2-4, uc2-3, uc2-2 |
  | p03 | uc2-4, uc2-3, uc2-1, uc2-2 |
  | p04 | uc2-2, uc2-4, uc2-1, uc2-3 |
  | p05 | uc2-3, uc2-1, uc2-4, uc2-2 |
  | p06 | uc2-4, uc2-2, uc2-1, uc2-3 |
  | p07 | uc2-4, uc2-1, uc2-3, uc2-2 |
  | p08 | uc2-2, uc2-1, uc2-4, uc2-3 |
  | p09 | uc2-2, uc2-1, uc2-3, uc2-4 |
  | p10 | uc2-2, uc2-4, uc2-3, uc2-1 |

- **The former `plan-b-p01`** (two Walensee legs, `nasa-tlx` after each,
  Schichtbilanz) is removed; its id now names participant 01. Records made
  under the old one keep their `conditionId` and replay without the
  condition's definition. The scripts `docshots-experiment-*.mjs` and
  `measure-/replay-video-experiment-logging.mjs` still walk the old two
  Walensee legs and need updating before their next run.
- **Briefing** `plan-b` (`tour-briefings.ts`, German only, also served for
  `en`): the flags and six guide steps of `colearning-experiment-2x` (no
  Schichtbilanz, #174) with its own opening page, text
  from the study (2026-11-07): the sector, the map of the line
  (`frontend/public/experiments/Walensee.png`), the goal (delay only), what
  follows. No title or headings, so the opening page takes optional
  `eyebrow`/`title`/`byline` and section `heading`, a section `goal` flag,
  and inline `**bold**` / `__underlined__` in `lead`, `body` and `items`
  (`InlineMarksPipe`, rendered as elements, never as HTML).
  `colearning-experiment-2x` stays for `plan-b-uc2`.
- **Guide strip:** kept, with hints that fit every scenario, the tutorial
  included (`PLAN_B_GUIDE_HINTS`, 2026-11-08): no Walensee breakdown and no
  "Neu:"; «Entscheiden» no longer asks to take an option; «Reflexion»: "Nach
  deiner Entscheidung fragt das Tool nach deinem Grund." Dropping the strip
  for Plan B stays possible (`guide: undefined` in `PLAN_B_DE`).
- **Names:** `tours.plan-b-pNN.name` / `.description` in en/de/fr.
- **Rebased onto `main` with #177 and #178** (2026-11-08): the branch's own
  `review` flag was dropped for #177's `shiftSummary: false`
  (`hasShiftSummary`), and its pause of the last leg for #177's pause of
  every finished leg; the ZWL code uses #178's names (`zwlRoute`).

## 5. Files

### New files

| File | Adds |
|---|---|
| `backend/app/fixtures/scenarios/<id>/{scenario.pkl,scenario.json,generator.json,image}` | The five Plan B scenarios (`tutorial`, `uc2-1` … `uc2-4`, §4); `generator.json` optional (§3.7) |
| `backend/app/utils/flatland_compat.py` | Compat `ScheduledMalfunctionEffectsGenerator` under flatland-rl's path (§3.6) |
| `backend/tests/test_experiment_scenarios.py` | §7 backend tests |
| `docs/reference/experiment-scenarios.md` | How to add a scenario folder and use it in a condition |
| `frontend/src/app/features/mode-intro/mode-intro.component.spec.ts` | Scenario card rendering |
| `frontend/src/app/features/tour-briefing/inline-marks.pipe.ts` (+ spec) | `**bold**` / `__underlined__` in briefing text, as elements |
| `frontend/src/app/core/survey/plan-b-final-survey.spec.ts` | The questionnaire's ids, pages, scales and types (§3.10) |
| `frontend/src/app/features/survey/survey.component.spec.ts` | Paging, required items, percent and number answers, matrix (§3.10) |
| `frontend/public/experiments/Walensee.png` | The map of the sector on the briefing page |
| `frontend/src/app/core/session-switch.spec.ts` | Leaving a playing session pauses it on the server |

### Modified files

| File | Change |
|---|---|
| `backend/app/core/scenario_presets.py` | Import `flatland_compat`; discover scenario folders (`discover_scenarios`, `ScenarioFolderError`); `experiment_only`, `title`, `description`, `image_url`; `is_experiment_only`, `preset_image`; random-malfunction warning |
| `backend/app/core/scenario_presets.py` (§3.7) | Station `geography` from the `.pkl`'s `stations_links`; read and check `generator.json` for `train_names` (both internal) |
| `backend/app/core/scenario_presets.py` (§3.8) | Validate and list `seconds_per_step` |
| `backend/app/core/scenario_presets.py` (§3.9) | `_stations_links_geography`: `layout: "corridor"` |
| `docs/reference/experiment-scenarios.md` (§3.9) | The ZWL draws the scenario left to right; scenarios must be corridors for now |
| `backend/app/api/sessions.py` | Image route; reject disturbances and live malfunctions for `experiment_only` presets |
| `backend/app/api/websockets.py` (§3.8) | `PlayRequest.speed > 0`; no 10 s floor; the wait between steps follows a speed change |
| `backend/app/api/hmi.py` | `get_geography`: an experiment scenario's station geography from the preset; new `trains: [{handle, name}]` (§3.7) |
| `backend/app/core/station_names.py` | `network_geography` also takes an in-memory geography, not only a sidecar path (§3.7) |
| `frontend/src/app/core/train-identity.service.ts` | `nameByHandle` prefers `geography.trains`, else the roster (§3.7) |
| `frontend/src/app/core/models.ts` (§3.7) | `SceneGeography.trains?: {handle, name}[]` |
| `frontend/src/app/core/models.ts` | `ScenarioPreset` gets `title?`, `description?`, `image_url?`, `experiment_only?`; `seconds_per_step?` (§3.8) |
| `frontend/src/app/core/play-speed.ts` (§3.8) | Levels as factors of a base pace; `playSpeedForLevel(level, base)` |
| `frontend/src/app/core/session.store.ts` (§3.8) | `playSpeedBase`, `newSession({ secondsPerStep })`; `playSpeed` from base and level |
| `frontend/src/app/core/demo/study-conditions.ts` | `StudyCondition.policy?`; `ExperimentLeg.nameKey` optional; the old `plan-b-p01` removed; `PLAN_B_TUTORIAL`, `PLAN_B_ORDERS` and the ten `plan-b-p01` … `p10` built from them (§4) |
| `frontend/src/app/core/demo/study-conditions.spec.ts` | A leg without `nameKey` has no disturbances; guards for the Plan B conditions (§7) |
| `frontend/src/app/core/demo/experiment-run.service.ts` | finish label without the Schichtbilanz (now #177's `hasShiftSummary`); `legName` via `TourContextService`; `LegFinishReason` |
| `frontend/src/app/core/demo/tour-context.service.ts` | `ScenarioCard`, `scenarioPresets`, `scenarioCardFor(leg)`, `scenarioCard`, `legName(leg)`; `LegFinishReason` (adds `'episodeEnd'`); `mapFocusCols` ignores the briefing's range on an experiment scenario |
| `frontend/src/app/core/replay/replay.service.ts` | `scenarioCard`; leg names via `legName` |
| `frontend/src/app/features/mode-intro/mode-intro.component.{ts,html,scss}` | Render the scenario card; `replayScenarioCard` input |
| `frontend/src/app/app.component.{ts,html}` | `secondsPerStep` from the preset for sessions on it (§3.8); `scenarioPresets` shared with `TourContextService`; `pinExperimentPolicy`, pinned policy enabled in `legSessionOpts`; (the last leg to the final questionnaire is #177's `shiftSummary: false`); `_legEndsWithEpisode`; `pickerScenarioPresets` |
| `frontend/src/app/app.component.spec.ts`, `core/demo/experiment-run.service.spec.ts` | §7 frontend tests |
| `frontend/src/app/core/demo/tour-briefings.ts` | The Plan B experiment briefing `plan-b` (German), on the six steps of `colearning-experiment-2x` with its own guide hints (`PLAN_B_GUIDE_HINTS`) |
| `frontend/src/app/features/tour-briefing/tour-briefing.component.{html,ts}` | Optional title, byline and headings; inline `**bold**` / `__underlined__` |
| `frontend/src/app/core/survey/survey.types.ts` | `page`, `scale` (matrix), `paged`, `requireAll`, `closable`; types `number`, `percent`; radio `layout` (§3.10) |
| `frontend/src/app/core/survey/survey-configs.ts` | `PLAN_B_FINAL_SURVEY` and the part `plan-b-final` (§3.10) |
| `frontend/src/app/features/survey/survey.component.{html,ts,scss}` | Pages with back/next, required items, matrix, percent, number, radio list, no close (§3.10) |
| `frontend/src/app/core/interaction-log/{interaction-log.service,session-record}.ts` | Context event `survey_page` |
| `frontend/src/app/core/replay/replay.service.spec.ts` | The two-Walensee-leg replay specs run on `plan-b-uc2` |
| `docs/experiment-logging.md` | Click id table: `surveyUi.back/next/submit` |
| `frontend/angular.json` | Initial bundle error budget 2.00 → 2.10 MB (§3.10) |
| `frontend/src/app/core/session.store.ts` | A playing session that is replaced or ended is paused on the server (§8 step 8) |
| `frontend/public/i18n/{en,de,fr}.json` | Labels of the scenario card, if new ones are needed; `tours.plan-b-p01` … `p10` names and descriptions |

In flatland-scenarios (separate PR): `scenario_generator/flatland_integration/malfunctions.py`
switches to the compat registration (§3.6). For station names (§3.7, §6
Q3), done in the stations phase 2 (`feature/grouped-station-format`): the
drawing tool names stations, and the generator writes the names into the
`.pkl`'s `stations_links`.

## 6. Decisions (2026-11-02)

1. **Stepper label of a leg:** the scenario's `title`; `nameKey` stays
   possible for legs that want their own.
2. **Questionnaire after a single leg** (§3.5): later, when an experiment
   needs it; Plan B does not.

### §3.7 (2026-11-03)

3. **Station names come from the drawing tool:** a name field per station,
   exported as `stations[].name` and passed through by the generator — the
   "string names" item of the flatland-scenarios stations phase 2. Phase 2 is
   designed and done first (its scope is still being thought through); §3.7
   follows. No hand-kept `stations` map in `scenario.json`. A station without
   a name keeps `S{n}`. *Updated 2026-11-04:* phase 2 writes the names into
   the `.pkl`'s `stations_links`, so ui-hub reads stations from there and
   `generator.json` only for trains; the export always names a station, an
   unnamed one by its tool id, which ui-hub then shows instead of `S{n}`.
4. **File name** of the generator output in the folder: `generator.json`.

### §3.8 (2026-11-04)

5. **How the slider relates to the scenario's `seconds_per_step`:** the
   levels scale with it — "normal" is the scenario's pace, the others keep
   their ratios (§3.8). Not chosen: starting outside the five levels (the
   pace is lost once the slider moves), snapping to the nearest level.
6. **`seconds_per_step` is a number ≥ 0.1 with no upper limit** (an integer
   or a float), honoured rather than clamped; the play loop drops its 10 s floor and reacts to a
   speed change within a step.

### §3.9 (2026-11-05)

7. **The ZWL axis of an experiment scenario:** every experiment scenario is
   read as a corridor, stations ordered from farthest left to farthest right
   (§3.9), since all scenarios needed now have that structure. Not chosen: a
   default section in `scenario.json` (an extra field every scenario must
   carry), a section derived from the timetables. A `"layout"` field in
   `scenario.json` comes when a network scenario is needed.

## 7. Tests

| What | Where |
|---|---|
| Every shipped scenario folder validates, loads, steps 10 times; no random malfunction generator | `backend/tests/test_experiment_scenarios.py` |
| A `.pkl` with a scheduled malfunction loads via the compat class and breaks the train during exactly its window | same |
| Malformed `scenario.json` cases fail with file and field named | same |
| `POST /session` rejects disturbances and live malfunctions for an `experiment_only` preset | same |
| The image route serves the named file only (no path traversal) | same |
| Scenario card: title, paragraphs, image; no mode sections | `mode-intro.component.spec.ts` |
| A condition with `policy` sets it at every leg start | `experiment-run.service.spec.ts` / app spec |
| `shiftSummary: false` goes from the last leg to the final questionnaire | `experiment-run.service.spec.ts` |
| A leg advances when its episode ends | same |
| Every Plan B condition: four legs, known scenario ids, known survey parts | `study-conditions.spec.ts` |
| Station geography from `stations_links`: names and stopping points; a `.pkl` without it has none | `test_experiment_scenarios.py` |
| `generator.json`: train names in handle order; wrong grid size, agent count, duplicate or empty name fail with the file named; a folder without it loads as before | `test_experiment_scenarios.py` |
| `seconds_per_step`: listed on the preset; 0, 0.05, -1, `true`, `"2"` fail with file and field named; 0.1, 2.5 and 60 are accepted | same |
| Play loop: a speed below 0.1 steps/s waits its full step; a speed change during a long wait applies within a slice; `speed: 0` is rejected | `backend/tests/` (play loop) |
| Play speed: base × level factors; default base gives today's five speeds; a session on a preset with `seconds_per_step` plays level 2 at that pace | `play-speed.spec.ts`, `session.store.spec.ts` |
| `/hmi/geography` of an experiment scenario: its stations and `trains`; built-in presets unchanged, `trains: []` | same |
| `/hmi/geography` of an experiment scenario has `layout: "corridor"`; Olten keeps `"network"` (§3.9) | `test_experiment_scenarios.py` |
| A session whose geography has `trains` uses them; without, the roster | `train-identity.service.spec.ts` |
| An experiment leg opens the map whole, not on the briefing's columns | `experiment-run.service.spec.ts` |

Browser check (repo rule): Plan B participant 01 end to end, with
screenshots of the briefing, one scenario card and the questionnaire.

## 8. Order of work

1. Backend: compat class, scenario discovery, routes, rejection, tests — with
   one test `.pkl` (a small drawn scenario with one scheduled malfunction).
2. Frontend: scenario card, policy pin, `shiftSummary: false`, episode-end advance,
   tests.
3. flatland-scenarios: compat registration in `malfunctions.py` (separate
   PR); regenerate the six `.pkl`s with `flatland-rl==4.3.0`.
4. Train and station names (§3.7): backend, then the one-line frontend
   change, tests, a browser check on `uc2-1` with a regenerated `.pkl` (map,
   timetable, notifications show `Z-W-1-S` and the station names).
5. Seconds per step (§3.8): backend field and play loop, play speed base,
   tests, browser check (slider shows the scenario's pace as "normal").
6. ZWL corridor (§3.9): the layout change, test, docs, browser check (the ZWL
   tab of `uc2-1` draws its stations left to right without a picked section).
7. Plan B content (§4; folders, ten conditions and orders done 2026-11-07;
   briefing text and final questionnaire open): five scenario folders (each with `generator.json` and,
   where wanted, `seconds_per_step`), briefing, ten conditions.
8. Browser check, then the PR against `main` (#157 is merged).
   Done 2026-11-08 on `plan-b-p01` (production build, Plan B UI config,
   German, headless Chromium): start screen, briefing, the five scenarios in
   the participant's order, the six questionnaire pages (open items marked,
   back keeps answers), submit, thank-you page; no console errors. Found and
   fixed: the briefing's sections ran in three columns (now `layout:
   'stack'`), spaces around the marked text; the last scenario ran on behind
   the questionnaire (now paused; after the rebase by #177's pause of every finished leg); **every earlier leg's session
   kept playing on the server** after the next leg started, and its stream
   could show in the footer: `SessionStore.newSession()` and `endSession()`
   now pause a playing session on the server (`session-switch.spec.ts`).
   The start screen's "danach Schichtbilanz und Fragebogen" and the
   stepper's Schichtbilanz step were left for #177 and are gone after the
   rebase. The guide strip's hints came from `colearning-experiment`
   (Walensee wording, e.g. "bleibt ein Zug im Einspurabschnitt stehen") in
   every scenario, the tutorial included; reworded, §4.
