# Experiment scenarios from `.pkl` files — the Plan B scenarios on top of the experiment workflow

> **Status: agreed 2026-11-02; §8 steps 1–2 implemented.** The Plan B content
> waits for the six scenarios. §3.7 (train and station names) is agreed
> (2026-11-03, §6); the drawing tool's stations phase 2 it waited for is done
> (flatland-scenarios `feature/grouped-station-format`, 2026-11-04), and §3.7
> is updated to it and implemented (§8 step 4). §3.8 (seconds per step) added 2026-11-04, §6 Q5 decided.
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

The Plan B study runs each participant through four of six fixed scenarios,
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

- **No Schichtbilanz:** `StudyCondition.review?: boolean` (default `true`, so
  #156's example is unchanged). With `false`, `nextLegOrReview()` goes from the
  last leg straight to the final questionnaire.
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
    stopping point's index + 1, `cell` its node.
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
  impact panel and the Zug-Weg-Diagramm all read it. A drawn station without a
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
- The Zug-Weg-Diagramm builds its axis from the rail grid
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

## 4. Plan B content

- Six scenario folders (§3.1), `.pkl`s generated with `flatland-rl==4.3.0`
  (this repo's pin) and the compat class.
- `plan-b-p01` already exists as a `StudyCondition` (#156 moved it from a
  tour; `#/tour/plan-b-p01` still opens it). Today it runs two Walensee legs
  (`WAL_SINGLE_TRACK`, `WAL_FOLLOWER`) with a `nasa-tlx` questionnaire after
  each, the Schichtbilanz and the full questionnaire. It becomes the first of
  ten conditions `plan-b-p01` … `plan-b-p10`: `layoutId: 'preset-plan-b'`,
  `mode: 'co-learning'`, `policy: 'deadlock_avoidance'`, `review: false`, four
  legs each in the participant's order (`disturbanceIds: []`, a fixed
  `seed`), no `legSurveyParts`, and `surveyParts` for the final
  questionnaire. The orders and the questionnaire parts come from the study
  design.
- Its briefing `colearning-experiment-2x` describes the two Walensee
  scenarios; Plan B gets its own briefing (experiment page, with image),
  referenced by all ten via `briefingIds`. The Walensee legs and briefing stay
  for the `colearning-experiment` conditions that use them.

## 5. Files

### New files

| File | Adds |
|---|---|
| `backend/app/fixtures/scenarios/<id>/{scenario.pkl,scenario.json,generator.json,image}` | The six Plan B scenarios; `generator.json` optional (§3.7) |
| `backend/app/utils/flatland_compat.py` | Compat `ScheduledMalfunctionEffectsGenerator` under flatland-rl's path (§3.6) |
| `backend/tests/test_experiment_scenarios.py` | §7 backend tests |
| `docs/reference/experiment-scenarios.md` | How to add a scenario folder and use it in a condition |
| `frontend/src/app/features/mode-intro/mode-intro.component.spec.ts` | Scenario card rendering |

### Modified files

| File | Change |
|---|---|
| `backend/app/core/scenario_presets.py` | Import `flatland_compat`; discover scenario folders (`discover_scenarios`, `ScenarioFolderError`); `experiment_only`, `title`, `description`, `image_url`; `is_experiment_only`, `preset_image`; random-malfunction warning |
| `backend/app/core/scenario_presets.py` (§3.7) | Station `geography` from the `.pkl`'s `stations_links`; read and check `generator.json` for `train_names` (both internal) |
| `backend/app/core/scenario_presets.py` (§3.8) | Validate and list `seconds_per_step` |
| `backend/app/api/sessions.py` | Image route; reject disturbances and live malfunctions for `experiment_only` presets |
| `backend/app/api/websockets.py` (§3.8) | `PlayRequest.speed > 0`; no 10 s floor; the wait between steps follows a speed change |
| `backend/app/api/hmi.py` | `get_geography`: an experiment scenario's station geography from the preset; new `trains: [{handle, name}]` (§3.7) |
| `backend/app/core/station_names.py` | `network_geography` also takes an in-memory geography, not only a sidecar path (§3.7) |
| `frontend/src/app/core/train-identity.service.ts` | `nameByHandle` prefers `geography.trains`, else the roster (§3.7) |
| `frontend/src/app/core/models.ts` (§3.7) | `SceneGeography.trains?: {handle, name}[]` |
| `frontend/src/app/core/models.ts` | `ScenarioPreset` gets `title?`, `description?`, `image_url?`, `experiment_only?`; `seconds_per_step?` (§3.8) |
| `frontend/src/app/core/play-speed.ts` (§3.8) | Levels as factors of a base pace; `playSpeedForLevel(level, base)` |
| `frontend/src/app/core/session.store.ts` (§3.8) | `playSpeedBase`, `newSession({ secondsPerStep })`; `playSpeed` from base and level |
| `frontend/src/app/core/demo/study-conditions.ts` | `StudyCondition.policy?`, `.review?`; `ExperimentLeg.nameKey` optional; `plan-b-p01` rewritten, `plan-b-p02` … `p10` added |
| `frontend/src/app/core/demo/study-conditions.spec.ts` | A leg without `nameKey` has no disturbances; guards for the Plan B conditions (§7) |
| `frontend/src/app/core/demo/experiment-run.service.ts` | `hasReview`; finish label without review; `legName` via `TourContextService`; `LegFinishReason` |
| `frontend/src/app/core/demo/tour-context.service.ts` | `ScenarioCard`, `scenarioPresets`, `scenarioCardFor(leg)`, `scenarioCard`, `legName(leg)`; `LegFinishReason` (adds `'episodeEnd'`); `mapFocusCols` ignores the briefing's range on an experiment scenario |
| `frontend/src/app/core/replay/replay.service.ts` | `scenarioCard`; leg names via `legName` |
| `frontend/src/app/features/mode-intro/mode-intro.component.{ts,html,scss}` | Render the scenario card; `replayScenarioCard` input |
| `frontend/src/app/app.component.{ts,html}` | `secondsPerStep` from the preset for sessions on it (§3.8); `scenarioPresets` shared with `TourContextService`; `pinExperimentPolicy`, pinned policy enabled in `legSessionOpts`; `review: false` in `nextLegOrReview`; `_legEndsWithEpisode`; `pickerScenarioPresets` |
| `frontend/src/app/app.component.spec.ts`, `core/demo/experiment-run.service.spec.ts` | §7 frontend tests |
| `frontend/src/app/core/demo/tour-briefings.ts` | The Plan B experiment briefing |
| `frontend/public/i18n/{en,de,fr}.json` | Labels of the scenario card, if new ones are needed |

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
| `review: false` goes from the last leg to the final questionnaire | `experiment-run.service.spec.ts` |
| A leg advances when its episode ends | same |
| Every Plan B condition: four legs, known scenario ids, known survey parts | `study-conditions.spec.ts` |
| Station geography from `stations_links`: names and stopping points; a `.pkl` without it has none | `test_experiment_scenarios.py` |
| `generator.json`: train names in handle order; wrong grid size, agent count, duplicate or empty name fail with the file named; a folder without it loads as before | `test_experiment_scenarios.py` |
| `seconds_per_step`: listed on the preset; 0, 0.05, -1, `true`, `"2"` fail with file and field named; 0.1, 2.5 and 60 are accepted | same |
| Play loop: a speed below 0.1 steps/s waits its full step; a speed change during a long wait applies within a slice; `speed: 0` is rejected | `backend/tests/` (play loop) |
| Play speed: base × level factors; default base gives today's five speeds; a session on a preset with `seconds_per_step` plays level 2 at that pace | `play-speed.spec.ts`, `session.store.spec.ts` |
| `/hmi/geography` of an experiment scenario: its stations and `trains`; built-in presets unchanged, `trains: []` | same |
| A session whose geography has `trains` uses them; without, the roster | `train-identity.service.spec.ts` |
| An experiment leg opens the map whole, not on the briefing's columns | `experiment-run.service.spec.ts` |

Browser check (repo rule): Plan B participant 01 end to end, with
screenshots of the briefing, one scenario card and the questionnaire.

## 8. Order of work

1. Backend: compat class, scenario discovery, routes, rejection, tests — with
   one test `.pkl` (a small drawn scenario with one scheduled malfunction).
2. Frontend: scenario card, policy pin, `review: false`, episode-end advance,
   tests.
3. flatland-scenarios: compat registration in `malfunctions.py` (separate
   PR); regenerate the six `.pkl`s with `flatland-rl==4.3.0`.
4. Train and station names (§3.7): backend, then the one-line frontend
   change, tests, a browser check on `uc2-1` with a regenerated `.pkl` (map,
   timetable, notifications show `Z-W-1-S` and the station names).
5. Seconds per step (§3.8): backend field and play loop, play speed base,
   tests, browser check (slider shows the scenario's pace as "normal").
6. Plan B content: six scenario folders (each with `generator.json` and,
   where wanted, `seconds_per_step`), briefing, ten conditions.
7. Browser check, then the PR against `main` (#157 is merged).
