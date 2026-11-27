# Plan B, round 2: overview

Status: planned, 26 November 2026. Target: `main` (all PRs).

Round 2 of the Plan B study compares two groups on the same three UC2
scenarios: **Co-Learning** (the Plan B working screen, reworked) and
**Recommendation** (the control group: the KI suggests, the human takes it
or not). The work is split into six PRs. Each has its own plan.

| PR | Plan | What | Depends on |
| --- | --- | --- | --- |
| 0 | — (fixtures only) | The four Plan B scenarios regenerated with a fixed seed; UC2 bundle re-pinned | — |
| A | [plan-b-round2-general.md](plan-b-round2-general.md) | Fixes for every mode: ZWL, "Episode beendet", reflection, "Halten bis frei", decision log, "Kein Eingriff" | — |
| B | [plan-b-round2-colearning.md](plan-b-round2-colearning.md) | New preset `preset-plan-b-colearning`: layout, minutes, Mensch options in the Mensch box | A |
| C | [plan-b-round2-recommendation.md](plan-b-round2-recommendation.md) | New preset `preset-plan-b-recommendation` for the control group | B |
| D | [plan-b-round2-experiments.md](plan-b-round2-experiments.md) | Two tutorial experiments, 8 + 8 round 2 experiments, round 1 hidden | B, C, #201 (merged first) |
| E | [plan-b-round2-preview.md](plan-b-round2-preview.md) | "Vorschau": the KI or Mensch course in the ZWL and on the map before taking it | B |

## Decisions taken with the study lead

- `preset-plan-b` stays as it is (round 1 replays use it); B and C are copies.
- Stored ids, preset ids, `data-log` ids and translation keys are never
  renamed: wording changes go into `public/i18n/*.json` only (AGENTS.md).
- Round 2 overrules [#201](https://github.com/flatland-association/flatland-ui-hub/pull/201)
  where they differ: three scenarios, no tutorial and no briefing in the
  experiments, "Lage: Risiko" and "Vergleich" stay in the Recommendation
  screen. #201's Schichtbilanz with reflection overview is reused.
- The preview (E) is wanted for round 2, but in its own PR, so A to D can
  merge without it.
