# Plan B round 2, PR D: experiments

Status: implemented, 27 November 2026. Target: `main`. Builds on PR B, PR C and
[#201](https://github.com/flatland-association/flatland-ui-hub/pull/201) (the
Schichtbilanz with reflection overview; on `feature/134-control-group`, not
merged yet; this PR merges it in). Overview: [plan-b-round2.md](plan-b-round2.md).

## What round 2 runs

| Experiment | Preset | Legs | After the last leg |
| --- | --- | --- | --- |
| Tutorial Co-Learning | `preset-plan-b-colearning` | tutorial | Schichtbilanz, end (no questionnaire) |
| Tutorial Recommendations | `preset-plan-b-recommendation` | tutorial | Schichtbilanz, end (no questionnaire) |
| `plan-b-r2-colearning-p01` … `p08` | `preset-plan-b-colearning` | 3 of uc2-1, uc2-2, uc2-4 | Schichtbilanz with reflection overview, then `plan-b-final` |
| `plan-b-r2-recommendation-p01` … `p08` | `preset-plan-b-recommendation` | the same 3 | Schichtbilanz without reflection column, then `plan-b-final` |

All **(decided)**: no tutorial and no briefing page in the 16 experiments;
the first scenario's description card opens directly. uc2-3 is not used.

### Orders (decided: balanced)

The six orders of the three scenarios once per group, plus two repeats drawn
with a fixed seed (`random.Random(42).sample(perms, 2)`). Participant n gets
the same order in both groups.

| n | Order |
| --- | --- |
| 01 | uc2-1, uc2-2, uc2-4 |
| 02 | uc2-1, uc2-4, uc2-2 |
| 03 | uc2-2, uc2-1, uc2-4 |
| 04 | uc2-2, uc2-4, uc2-1 |
| 05 | uc2-4, uc2-1, uc2-2 |
| 06 | uc2-4, uc2-2, uc2-1 |
| 07 | uc2-4, uc2-2, uc2-1 (repeat of 06) |
| 08 | uc2-1, uc2-2, uc2-4 (repeat of 01) |

Each scenario then comes first 3, 2 or 3 times out of 8; exact balance needs
6 or 12 participants per group. The two repeats are fine as drawn **(decided)**.

## Changes

### 1. Conditions (`core/demo/study-conditions.ts`)

- `UC2_LEGS` (:173-175) is exported or a map by id, so the orders reuse the
  same leg objects (spec :156-165).
- `PLAN_B_R2_ORDERS` (the table above) and two generated lists
  `PLAN_B_R2_COLEARNING` / `PLAN_B_R2_RECOMMENDATION`, built like
  `PLAN_B_CONDITIONS` (:194-212): `studyLogging: true`, `policy:
  'deadlock_avoidance'`, `proposalAgent: 'uc2_rl'`, `surveyParts:
  [PLAN_B_FINAL_PART]`, Schichtbilanz on (`shiftSummary` absent), mode
  `co-learning` / `recommendation`.
- Two tutorial conditions `plan-b-r2-tutorial-colearning` and
  `plan-b-r2-tutorial-recommendation`, legs `[PLAN_B_TUTORIAL]`,
  `surveyParts: []`.
- New optional field `unlisted?: boolean`: the condition exists (replay,
  badge, resume, deep link look it up in `STUDY_CONDITIONS`), but the picker
  doesn't offer it. Set on `plan-b-p02` … `p10` **(decided: hide, keep)**.
- Order of `STUDY_CONDITIONS` (it is the dropdown's order; the picker never
  sorts): the two tutorials first, then the 8 Co-Learning, the 8
  Recommendation, the existing entries, and `plan-b-p01` last.

### 2. Picker (`app.component.ts:801-803`)

`guidedConditions` (and `studyConditions`) filter out `unlisted`. Deep links
and resume keep using the full list (`:920-926`, `:1377-1381`), so an
unlisted condition still opens with `#/experiment/<id>`.

### 3. No briefing page, but a briefing

The scenario card and the Schichtbilanz need a briefing
(`tour-context.service.ts:93, 255`), so the experiments keep one, without an
`opening` (precedent: `CO_LEARNING_EXPERIMENT_DE`, `tour-briefings.ts:485-507`):

- `plan-b-r2-colearning`: `debrief: true`, `debriefSections:
  ['shift-summary']`, `reasonDialog`, the Plan B guide hints, step wording
  in minutes (PR B).
- `plan-b-r2-recommendation`: the same without `reasonDialog` (no reflection,
  PR C), plus `decisionMoment: 'hold'` (PR C), and as #201 D-12: no
  `moduleBadges`, the guide without the `reflect` step, and
  `modeIntros.recommendation` = Plan B's Co-Learning card, its step count
  "fünf Schritte" (the guide has no `reflect` step; spec "every intro card
  counts the steps its guide strip shows").
- de/en/fr each (spec :115-123); en and fr may point to the de text with a
  TODO for translation, as `plan-b` does.
- The two tutorials use the same briefings: they open with the tutorial's
  scenario card, not with the Plan B "Einführung" page **(decided)**.

### 4. Schichtbilanz

- From #201: `tour-debrief` shows `ReflectionOverviewComponent` in an
  experiment (`inExperiment()`), the replay shows it in
  `replay-shift-summary`.
- From #201 (7853cc2e, D-22): the overview's "Reflexion" column is hidden
  when the briefing has no `reasonDialog`, live and in the replay. The
  Recommendation briefing (item 3) leaves it out; nothing else to do here.
- Minutes (PR B): `tourUi.guide.step` (the overview's "Schritt n") and
  `tourUi.debrief.kpi.totalDelay` (the table's column) get `…Min` siblings
  and join `MINUTE_KEYS`; the debrief template uses the `timeKey` pipe there.
- From #201 (f9d00093): "Kein Eingriff" reads as its button,
  `proposals.keepPlan` ("Nicht eingreifen" with PR A), through the log
  field `proposal`; nothing to do here.

### 5. Experiments without a questionnaire

Not supported today: `surveyParts` is required and the `'review'` phase
always moves on to `'finalSurvey'` (`app.component.ts:1216-1219`).

- `surveyParts: []` means none: from `'review'`, `advanceExperiment` calls
  `completeExperiment()` directly.
- The debrief's button then reads "Abschliessen" instead of "Weiter zum
  Fragebogen": #201's `inExperiment()` branch in `tour-debrief.component.html`
  and `finishLabel` (`experiment-run.service.ts:141-142`) both check for a
  questionnaire; new key `experimentRun.finish.complete` (`experimentRun.finish`
  is already an object).
- The stepper needs no change: it shows from two legs on, and the tutorials
  have one. The start screen's meta line and summary say "ohne Fragebogen"
  (new keys `experimentRun.metaNoSurvey`, `summaryNoSurvey`,
  `summaryOneNoSurvey`); `hasFinalSurvey()` in `study-conditions.ts`.

### 6. Labels

- `tours.plan-b-r2-*.{name,description}` in en/de/fr, e.g. "Runde 2 ·
  Co-Learning · Teilnehmer:in 01", "Tutorial Co-Learning", "Tutorial
  Recommendations" **(decided)**.
- `tours.plan-b-p01.name`: "Plan B Runde 1 Beispiel" (de; en "Plan B round 1
  example"). The id and `label` stay **(decided)**.

## New files

| File | Adds |
| --- | --- |
| — | No new files; conditions, briefings and keys go into the existing registries |

## Modified files

| File | Change |
| --- | --- |
| `frontend/src/app/core/demo/study-conditions.ts` | `unlisted`, `hasFinalSurvey()`; `UC2_LEGS` exported; `PLAN_B_R2_ORDERS`, the 2 tutorials and 16 experiments; new order, `plan-b-p02` … `p10` unlisted |
| `frontend/src/app/core/demo/tour-briefings.ts` | Briefings `plan-b-r2-colearning`, `plan-b-r2-recommendation` (German, as `plan-b`), registered in `TOUR_BRIEFINGS` |
| `frontend/src/app/app.component.ts` | Picker filters `unlisted`; `'review'` → complete when no questionnaire; start screen summary |
| `frontend/src/app/app.component.html` | Meta line without questionnaire |
| `frontend/src/app/core/demo/experiment-run.service.ts` | `hasFinalSurvey`; `finishLabel` "Abschliessen" without questionnaire |
| `frontend/src/app/features/tour-debrief/tour-debrief.component.{ts,html}` | Last button "Abschliessen" without questionnaire; delay column in minutes (`TimeKeyPipe`) |
| `frontend/src/app/features/reflection-overview/reflection-overview.component.ts` (from #201) | Step in minutes (`TimeKeyPipe`) |
| `frontend/src/app/core/time-unit/time-unit.service.ts` (PR B) | `tourUi.guide.step`, `tourUi.debrief.kpi.totalDelay` in `MINUTE_KEYS` |
| `frontend/public/i18n/{en,de,fr}.json` | Names/descriptions of 18 conditions, p01 name, `experimentRun.finish.complete`, `metaNoSurvey`, `summaryNoSurvey`, `summaryOneNoSurvey`, `tourUi.guide.stepMin`, `tourUi.debrief.kpi.totalDelayMin` |
| `frontend/src/app/core/demo/study-conditions.spec.ts` | Round 2 block (orders, legs, layouts, briefings, tutorials, picker order, unlisted); round 1 block sorted by id; five steps on the Recommendation card |
| `frontend/src/app/app.component.spec.ts` | Unlisted conditions not offered but found by id; a tutorial ends after its Schichtbilanz |
| `frontend/src/app/core/demo/experiment-run.service.spec.ts`, `features/tour-debrief/tour-debrief.component.spec.ts`, `features/reflection-overview/reflection-overview.component.spec.ts` | "Abschliessen" without questionnaire; minutes; "Nicht eingreifen" (PR A's wording, after merging #201) |

Not changed, unlike planned: `experiment-progress.component.ts` (no stepper
for one leg) and `uc2-session.spec.ts` (its round 1 rule still holds; round
2 is covered in `study-conditions.spec.ts`).

## Open points

- Not checked in the running app yet: the first end-to-end test of round 2
  (both groups, a tutorial, the Schichtbilanz, the questionnaire).
- en/fr briefings: German only, as `plan-b`.

## Order with #201 (decided: taken over, merged into this PR)

#201 was taken over on 27 November 2026 and adjusted for round 2 (up to
7853cc2e); it merges into `main` on its own. This PR builds on PR C with
#201's branch merged in (one merge commit), so the stack doesn't wait for
it; once #201 is on `main`, the merge is already part of it. Every
difference is tracked in [plan-b-round2.md](plan-b-round2.md#where-round-2-differs-from-201).
What round 2 takes from it and what it drops:

- Taken: the Schichtbilanz's reflection overview in the debrief and the
  replay, the per-leg decision record (`reason`, `reflection`, `events`),
  the debrief's "Weiter zum Fragebogen" button in an experiment, D-7
  (`decisionMoment`), D-12 (the Recommendation briefing), D-22 (no
  "Reflexion" column without `reasonDialog`).
- Dropped in #201 itself (11a70720): its template
  `plan-b-summative-colearning-p01` and briefing `plan-b-summative`; nobody
  ran them. Round 2 uses `plan-b-r2-*`.
- Its §4.3 (the Recommendation setting) points to
  [plan-b-round2-recommendation.md](plan-b-round2-recommendation.md).
- Added in #201 for round 2: `shiftDecisionsFrom()`, the log field
  `proposal`, D-22.
