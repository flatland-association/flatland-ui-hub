# Experiment scenarios

A scenario for a study is a `.pkl` that holds the whole simulation, plus a
title, a description and an optional image. The app runs it exactly as the
file says: no disturbances, no random breakdowns, no session settings on top.
Design: [plans/experiment-scenario-import.md](../plans/experiment-scenario-import.md).

## Adding one

`backend/app/fixtures/plan-b/example-scheduled-malfunction/` is a complete
example. Its `config.json` is the scenario_generator input, built from
flatland-scenarios' `examples/example_1`, so the `.pkl` can be regenerated.

1. Build the `.pkl` with flatland-scenarios' `scenario_generator` (drawing-tool
   export + `config.json`), using `flatland-rl==4.3.0`, this repo's pin.
   Scheduled malfunctions are stored as
   `flatland.envs.malfunction_effects_generators.ScheduledMalfunctionEffectsGenerator`.
   Until flatland-rl ships that class, `backend/app/utils/flatland_compat.py`
   provides it.
2. Make a folder `backend/app/fixtures/plan-b/<id>/` with:

   ```
   scenario.pkl     # RailEnvPersister format
   scenario.json    # below
   generator.json   # optional: the scenario_generator's output .json, unchanged (train names)
   scenario.png     # optional; .png, .jpg/.jpeg or .svg
   ```

   ```json
   {
     "id": "<id>",
     "title": "Störung am Einspurabschnitt",
     "description": "First paragraph.\n\nSecond paragraph.",
     "image": "scenario.png",
     "source": "flatland-scenarios scenario_generator",
     "seconds_per_step": 3
   }
   ```

   | Field | Required | Notes |
   |---|---|---|
   | `id` | yes | Equals the folder name, and differs from every built-in preset id. |
   | `title` | yes | Heading of the intro card, and the scenario's name in "⟨name⟩ (k/N)". |
   | `description` | yes | Plain text. Blank lines separate paragraphs. |
   | `image` | no | A file name in the same folder. |
   | `source` | no | Where the scenario comes from. |
   | `seconds_per_step` | no | Real seconds one step lasts at the speed slider's «Normal», a number ≥ 0.1 (e.g. `3`, `1.5`, `60`). The slider's other levels keep their ratio to it (half as fast, 2×, 6×, 20×). Without it: 2 s. It is the pace also when the layout hides the slider. |

   No other fields are accepted. Grid size and train count are read from the
   `.pkl`.

   **Names.** Stations are named from the `.pkl` (its `stations_links`, which
   the scenario_generator writes from the station names given in the drawing
   tool; an unnamed station shows its tool id). Trains are named from
   `generator.json`; without it, they keep the app's roster names (`IC_703`, …).

   **ZWL (Zeit-Weg-Linie-Diagramm).** The scenario is read as a corridor: the ZWL's
   axis runs from the station farthest left to the one farthest right, by
   platform column, without a section to pick first. So a scenario has to be
   a single line for now; a network would get a misleading axis.

   **`generator.json`** is the `.json` the scenario_generator writes next to
   the `.pkl`, copied unchanged and renamed: the command, run in the
   flatland-scenarios root (its `scenario_generator/README.md` describes
   `config.json`),

   ```shell
   PYTHONPATH=. python -m scenario_generator.model.config export.json config.json uc2-1 --output-folder out
   ```

   writes `out/uc2-1.json` (→ `generator.json`) and `out/uc2-1.pkl`
   (→ `scenario.pkl`). Pick an output name other than `scenario`: the
   generator's `scenario.json` would be a different file from the folder's
   own `scenario.json` (title, description, …). ui-hub reads two things from
   it and ignores the rest (grid, stations, lines, train categories, …):

   ```json
   {
     "gridDimensions": { "rows": 13, "cols": 80, "cellSize": 30 },
     "timetables": [
       { "name": "Z-W-1-S", "trainCategory": "IC", "stops": [] },
       { "name": "Z-W-2-IR", "trainCategory": "IC", "stops": [] },
       { "name": "F-W-S", "trainCategory": "IC", "stops": [] }
     ]
   }
   ```

   | Field | Read as |
   |---|---|
   | `gridDimensions.rows`, `.cols` | Must equal the `.pkl`'s height and width. |
   | `timetables[i].name` | The name of train *i* (handle *i*, in the tool's timetable order). There must be one timetable per train in the `.pkl`, and the names must be non-empty and unique. |

   A file that doesn't match its `.pkl` fails the backend at startup, with the
   file named: a stale `generator.json` would put the wrong name on a train.
   So regenerate both together, from the same run.

3. Run `cd backend && pytest -q tests/test_experiment_scenarios.py`. Every
   shipped folder is loaded and stepped. A malformed folder fails the backend
   at startup, with the file and the field named. A `.pkl` with a random
   malfunction generator logs a warning.

## Using it in an experiment

Name the folder id as a leg's `scenarioId` in a guided condition
(`frontend/src/app/core/demo/study-conditions.ts`):

```ts
{ id: 'plan-b-s1', scenarioId: 'plan-b-s1', disturbanceIds: [], seed: 1 }
```

- Leave out `nameKey`: the leg is named by the scenario's title.
- Leave out `intro`: the intro card shows the title, the description and the
  image.
- `disturbanceIds` stays empty. The backend refuses disturbances and
  `malfunction_rate > 0` on an experiment scenario.

On the condition:

- `policy: 'deadlock_avoidance'` runs every leg on that policy.
- `shiftSummary: false` (#174) goes from the last leg straight to the final questionnaire,
  without the Schichtbilanz.

A leg also ends when its episode ends (all trains arrived, or the horizon
reached). This is recorded as `finishReason: 'episodeEnd'`.

Experiment scenarios appear in `GET /session/scenario-presets` with
`experiment_only: true`. The free Infrastructure picker leaves them out.
`GET /session/scenario-presets/<id>/image` serves the image.
