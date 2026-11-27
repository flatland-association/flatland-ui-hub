# Plan B round 2, PR B: the Co-Learning screen (`preset-plan-b-colearning`)

Status: implemented, 27 November 2026. Target: `main`. Builds on PR A.
Overview: [plan-b-round2.md](plan-b-round2.md).

A new preset for round 2's Co-Learning group, copied from `preset-plan-b`.
`preset-plan-b` stays unchanged **(decided)**: round 1's conditions and
replays use it. Decisions taken with the study lead are marked
**(decided)**; defaults chosen by this plan **(default)**.

## Today's `preset-plan-b`

`PLAN_B` (`core/layout/layout-presets.ts:741-807`), one row:

| Zone | Panels |
| --- | --- |
| left 20% | Lagebild (`situation-summary`), Ereignisse (`notifications`) |
| centre 50% | `view-tabs` with ZWL and Streckenspiegel as tabs (minBodyHeight 560); Fahrplan (`timetable`) |
| right 30% | Lage: Risiko & Auswirkung (`impact`), Handlungsoptionen (`proposal-compare`), Entscheidungsprotokoll (`decision-log`) |

`PLAN_B_UI` (:706-731) hides pan, opacity, end shift, playback, the time
axis of the comparison, session info, mode tabs, the view-tabs title, the
decision log's actions, the guide and the leg names.

## Change

### 1. Layout (decided)

| Zone | Panels |
| --- | --- |
| left 20% | Ereignisse, then Lage: Risiko & Auswirkung |
| centre 50% | ZWL (`zug-weg-diagramm`) above, Streckenspiegel (`flatland-map`) below, no tabs |
| right 30% | Handlungsoptionen, Entscheidungsprotokoll |

- No Fahrplan, no Lagebild.
- `PLAN_B_COLEARNING` is written out like `PLAN_B` (a study layout has to be
  reviewable on its own), with its `ui` built on `PLAN_B_UI`, new ids
  (`preset-pbc-*`), registered in `LAYOUT_PRESETS`, `nameKey`/`purposeKey`
  under `layouts.planBColearning` (en/de/fr).
- The centre column stacks two panels; no preset does ZWL-above-map yet,
  but `ZWL_CORRIDOR` (:908-918) stacks them the other way round. Heights
  **(default)**: ZWL `minHeight` 380, map 340, tuned in the running app so
  both fit a 1080p screen without page scroll.
- Panel titles stay ("Zeit-Weg-Liniendiagramm (ZWL)", "Streckenspiegel")
  **(default)**; hiding them would need `widget.zug-weg-diagramm.title` /
  `widget.flatland-map.title` in `TITLE_IDS` (`ui-config-items.ts:67-69`).
- **Check without view-tabs:** `view-tabs` also sets `store.centerView`,
  `showMap`, `showMarey` (`view-tabs.component.ts:73-96`), and
  `activeHandle()` falls back on `showMarey`. With both views always shown,
  these must read "both visible"; to be verified in the app and covered by a
  spec.

### 2. Minutes instead of steps (decided: a setting, fixed in Plan B round 2)

A step is shown as one minute; there is no conversion
(`MINUTES_PER_STEP = 1`, `combined-actions-preview.ts:26`). Only the words
change. `seconds_per_step` in `scenario.json` is playback pace and is not
touched.

- **Setting:** "Zeiteinheit: Schritte / Minuten" in the Settings dialog
  (advanced tab, next to "Entscheidungszeit", `app.component.html:950-955`),
  default Schritte, persisted with the other session settings
  (`persistSessionSettings`, `app.component.ts:1675-1735`).
- **New service** `TimeUnitService` (`core/time-unit/time-unit.service.ts`):
  a `unit` signal (`'steps' | 'minutes'`) and `key(k)`, which returns
  `k + 'Min'` when minutes are on and `k` is in `MINUTE_KEYS`, else `k`.
  The setting is remembered per browser (like smooth motion).
- **Fixed per preset:** `UiConfig` gets `timeUnit?: 'steps' | 'minutes'`;
  when the preset sets it, it wins over the setting. A new control id
  `control.timeUnit` hides the setting. `PLAN_B_COLEARNING` (and C) set
  `timeUnit: 'minutes'` and hide `control.timeUnit`.
- **Texts:** each text with a step unit gets a sibling key with the minute
  wording, e.g. `zwd.timeUnit` "Schritt" / `zwd.timeUnitMin` "min",
  `zwd.conflicts.inMin` / `inMinMin` "in {{min}} min". Places on the Plan B
  screen:
  - ZWL: `zwd.timeUnit` (`zwl.component.ts:740`), `zwd.conflicts.inMin`
    (`.html:45`), `zwd.delaySteps` (`.ts:885`, map plate tooltip
    `flatland-map.component.ts:295`);
  - map: `map.predicted`, `map.holdMark`, `map.contentionDetail`,
    `lanes.inSteps`, `map.problem.malfunctionLeft`;
  - Handlungsoptionen: `proposals.step`, `stepOnPlan`, `stepVsPlan`,
    `course.wait`, `waitOne`, `branch`, `axis.unit`, `compareNote`;
  - impact: `impact.steps`, `impact.bufferNone`;
  - events: `notifications.train.malfunction.{message,short}` (through
    `NotificationWordingService`);
  - decision log: `log.decidedAt`; footer/toolbar: `footer.step`,
    `toolbar.stepsRemaining`;
  - hypothesis texts `hypothesis.impact.blockLong/Short`.
  Code needs no change: `LanguageService.t()` maps the key itself. Templates
  use `'key' | timeKey | transloco`; `scripts/i18n-coverage.mjs` recognises
  that form, and a spec checks every `Min` sibling in en/de/fr. None of these
  keys are click ids.
- `ui-config.schema.json` knows `timeUnit` and `control.timeUnit`.
- Wording **(decided)**: "min" after numbers ("+3 min", "in 5 min"),
  "Minuten" in sentences.
- The briefings of round 2 (PR D) are written in minutes directly.

### 3. Handlungsoptionen: Mensch options inside the Mensch box (decided)

- **Now:** the option buttons (`pc-options`, `proposal-compare.component.html:34-45`)
  sit above the three boxes; the Mensch box (:103-120) appears only once an
  option is chosen and computed, with a placeholder before (:121-137).
- **Change:** the Mensch box is always there. Its top holds the option
  buttons (Halten, Weiterfahren, Fahrweg ändern — "Halten bis frei" is gone
  with PR A); below them the placeholder, "wird gerechnet…" or the computed
  course with its take button, as today. Applies to every preset with
  Handlungsoptionen **(default; it is the same panel everywhere)**.
- "Kein Eingriff" / "Nicht eingreifen" and the missing subline come from
  PR A item 9.

## New files

| File | Adds |
| --- | --- |
| `frontend/src/app/core/time-unit/time-unit.service.ts` | `TimeUnitService`, `MINUTE_KEYS`, `timeKey()`, `TimeKeyPipe` |
| `frontend/src/app/core/time-unit/time-unit.service.spec.ts` | Siblings in en/de/fr; setting vs preset; round 1 stays in steps |

## Modified files

| File | Change |
| --- | --- |
| `frontend/src/app/core/layout/layout-presets.ts` | `PLAN_B_COLEARNING` (+ `PLAN_B_COLEARNING_UI`), registered (items 1, 2) |
| `frontend/src/app/core/config/ui-config.service.ts` | `UiConfig.timeUnit`, `timeUnit` signal (condition wins over deployment) |
| `frontend/src/app/core/config/ui-config-items.ts`, `frontend/public/ui-config.schema.json` | `control.timeUnit`; schema `timeUnit` |
| `frontend/src/app/core/i18n/language.service.ts` | `t()` maps keys through `TimeUnitService` |
| `frontend/src/app/app.component.{ts,html}` | Setting "Zeiteinheit" in the dialog; `footer.step` |
| `frontend/src/app/features/{zwl,flatland-map,impact-panel,decision-log,situation-summary,toolbar,proposal-compare}/…` | `timeKey` pipe in templates |
| `frontend/src/app/features/proposal-compare/proposal-compare.component.{html,spec.ts}` | Options inside the Mensch box (item 3) |
| `frontend/scripts/i18n-coverage.mjs` | Accepts `'key' \| timeKey \| transloco` |
| `frontend/src/app/core/config/ui-config.service.spec.ts`, `core/stored-ids.spec.ts` | Plan B family may hide guide/leg names; preset id pinned |
| `frontend/public/i18n/{en,de,fr}.json` | `layouts.planBColearning`, `settings.timeUnit`, 26 `…Min` siblings, `proposals.placeholder` without "oben" |

## Open points

Panel titles of ZWL and map: kept (default); hiding them is a one-line
UiConfig change if the screen turns out too tight.
