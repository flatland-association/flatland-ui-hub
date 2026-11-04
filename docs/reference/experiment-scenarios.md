# Experiment scenarios

A scenario for a study is a `.pkl` that holds the whole simulation, plus a
title, a description and an optional image. The app runs it exactly as the
file says: no disturbances, no random breakdowns, no session settings on top.
Design: [plans/experiment-scenario-import.md](../plans/experiment-scenario-import.md).

## Adding one

`backend/app/fixtures/scenarios/example-scheduled-malfunction/` is a complete
example. Its `config.json` is the scenario_generator input, built from
flatland-scenarios' `examples/example_1`, so the `.pkl` can be regenerated.

1. Build the `.pkl` with flatland-scenarios' `scenario_generator` (drawing-tool
   export + `config.json`), using `flatland-rl==4.3.0`, this repo's pin.
   Scheduled malfunctions are stored as
   `flatland.envs.malfunction_effects_generators.ScheduledMalfunctionEffectsGenerator`.
   Until flatland-rl ships that class, `backend/app/utils/flatland_compat.py`
   provides it.
2. Make a folder `backend/app/fixtures/scenarios/<id>/` with:

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
     "source": "flatland-scenarios scenario_generator"
   }
   ```

   | Field | Required | Notes |
   |---|---|---|
   | `id` | yes | Equals the folder name, and differs from every built-in preset id. |
   | `title` | yes | Heading of the intro card, and the scenario's name in "⟨name⟩ (k/N)". |
   | `description` | yes | Plain text. Blank lines separate paragraphs. |
   | `image` | no | A file name in the same folder. |
   | `source` | no | Where the scenario comes from. |

   No other fields are accepted. Grid size and train count are read from the
   `.pkl`.

   **Names.** Stations are named from the `.pkl` (its `stations_links`, which
   the scenario_generator writes from the station names given in the drawing
   tool; an unnamed station shows its tool id). Trains are named from
   `generator.json`: the `.json` the scenario_generator writes next to the
   `.pkl` (it has the `.pkl`'s base name, so rename it), whose
   `timetables[i].name` names train *i*. It must match the `.pkl` — same grid
   size, one timetable per train, unique non-empty names — or the backend fails
   at startup. Without it, the trains keep the app's roster names (`IC_703`, …).
   Regenerate `generator.json` together with the `.pkl`.

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
- `review: false` goes from the last leg straight to the final questionnaire,
  without the Schichtbilanz.

A leg also ends when its episode ends (all trains arrived, or the horizon
reached). This is recorded as `finishReason: 'episodeEnd'`.

Experiment scenarios appear in `GET /session/scenario-presets` with
`experiment_only: true`. The free Infrastructure picker leaves them out.
`GET /session/scenario-presets/<id>/image` serves the image.
