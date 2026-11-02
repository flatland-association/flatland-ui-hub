# Experiment scenarios from `.pkl` files — the Plan B scenarios on top of the experiment workflow

> **Status: agreed 2026-11-02; §8 steps 1–2 implemented.** The Plan B content
> (step 4) waits for the six scenarios.
> **Builds on:** #157 (`feature/129-experiment-logging`), which builds on #156
> (`feature/131-experiment-workflow-definitions`, plan
> [experiment-workflow.md](experiment-workflow.md)) and #146 (configurable UI).
> This PR targets `feature/129-experiment-logging`.
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
| `backend/app/fixtures/scenarios/<id>/{scenario.pkl,scenario.json,image}` | The six Plan B scenarios |
| `backend/app/utils/flatland_compat.py` | Compat `ScheduledMalfunctionEffectsGenerator` under flatland-rl's path (§3.6) |
| `backend/tests/test_experiment_scenarios.py` | §7 backend tests |
| `docs/reference/experiment-scenarios.md` | How to add a scenario folder and use it in a condition |
| `frontend/src/app/features/mode-intro/mode-intro.component.spec.ts` | Scenario card rendering |

### Modified files

| File | Change |
|---|---|
| `backend/app/core/scenario_presets.py` | Import `flatland_compat`; discover scenario folders (`discover_scenarios`, `ScenarioFolderError`); `experiment_only`, `title`, `description`, `image_url`; `is_experiment_only`, `preset_image`; random-malfunction warning |
| `backend/app/api/sessions.py` | Image route; reject disturbances and live malfunctions for `experiment_only` presets |
| `frontend/src/app/core/models.ts` | `ScenarioPreset` gets `title?`, `description?`, `image_url?`, `experiment_only?` |
| `frontend/src/app/core/demo/study-conditions.ts` | `StudyCondition.policy?`, `.review?`; `ExperimentLeg.nameKey` optional; `plan-b-p01` rewritten, `plan-b-p02` … `p10` added |
| `frontend/src/app/core/demo/study-conditions.spec.ts` | A leg without `nameKey` has no disturbances; guards for the Plan B conditions (§7) |
| `frontend/src/app/core/demo/experiment-run.service.ts` | `hasReview`; finish label without review; `legName` via `TourContextService`; `LegFinishReason` |
| `frontend/src/app/core/demo/tour-context.service.ts` | `ScenarioCard`, `scenarioPresets`, `scenarioCardFor(leg)`, `scenarioCard`, `legName(leg)`; `LegFinishReason` (adds `'episodeEnd'`) |
| `frontend/src/app/core/replay/replay.service.ts` | `scenarioCard`; leg names via `legName` |
| `frontend/src/app/features/mode-intro/mode-intro.component.{ts,html,scss}` | Render the scenario card; `replayScenarioCard` input |
| `frontend/src/app/app.component.{ts,html}` | `scenarioPresets` shared with `TourContextService`; `pinExperimentPolicy`, pinned policy enabled in `legSessionOpts`; `review: false` in `nextLegOrReview`; `_legEndsWithEpisode`; `pickerScenarioPresets` |
| `frontend/src/app/app.component.spec.ts`, `core/demo/experiment-run.service.spec.ts` | §7 frontend tests |
| `frontend/src/app/core/demo/tour-briefings.ts` | The Plan B experiment briefing |
| `frontend/public/i18n/{en,de,fr}.json` | Labels of the scenario card, if new ones are needed |

In flatland-scenarios (separate PR): `scenario_generator/flatland_integration/malfunctions.py`
switches to the compat registration (§3.6).

## 6. Decisions (2026-11-02)

1. **Stepper label of a leg:** the scenario's `title`; `nameKey` stays
   possible for legs that want their own.
2. **Questionnaire after a single leg** (§3.5): later, when an experiment
   needs it; Plan B does not.

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

Browser check (repo rule): Plan B participant 01 end to end, with
screenshots of the briefing, one scenario card and the questionnaire.

## 8. Order of work

1. Backend: compat class, scenario discovery, routes, rejection, tests — with
   one test `.pkl` (a small drawn scenario with one scheduled malfunction).
2. Frontend: scenario card, policy pin, `review: false`, episode-end advance,
   tests.
3. flatland-scenarios: compat registration in `malfunctions.py` (separate
   PR); regenerate the six `.pkl`s with `flatland-rl==4.3.0`.
4. Plan B content: six scenario folders, briefing, ten conditions.
5. Browser check, then the PR against `feature/129-experiment-logging`.
