# Plan B round 2, PR A: general fixes

Status: implemented, 27 November 2026. Target: `main`. One PR, one commit per item.
Overview: [plan-b-round2.md](plan-b-round2.md).

Seven fixes that apply in every mode and every preset, not only in Plan B.
Decisions taken with the study lead are marked **(decided)**; defaults this
plan chose on its own are marked **(default)** and can still be changed.

## Items

### 1. ZWL: delay next to every train name, also "0"

- **Now:** the ZWL and the map's train plates already show the current delay
  after the name (`zwl.component.html:148`, `flatland-map.component.ts:288`),
  both from `CurrentDelayService.label()`
  (`core/timetable/current-delay.service.ts:63-66`). It returns `"+5"` for a
  late train and `''` when the train is on time, early or not measurable.
- **Change:** `label()` returns `"0"` when the train is on time or early, and
  `"+n"` when it is late **(decided: current delay only, everywhere the name
  is drawn with a delay)**. A train with nothing to measure (no plan loaded,
  not departed) stays without a suffix **(default)**.
- The map plate's tooltip (`zwd.delaySteps`, "{{n}} Schritte") then reads
  "0 Schritte", which is fine.

### 2. ZWL: the future line looks like the past

- **Now:** `.zwd__past` is solid, 2.2 px; `.zwd__forecast` is dashed
  (`5 4`), 1.8 px (`zwl.component.scss:253-260`). Both take the train's
  colour from `AgentColorService.getColorSolid`.
- **Change:** `.zwd__forecast` gets the past's style: solid, 2.2 px, same
  colour. The legend's two entries "Ist" and "Prognose"
  (`zwl.component.html:206-207`) would then show the same line, so they
  become one, "Ist und Prognose" **(default)**. The now-line remains the
  only boundary between past and future.
- The tours' ZWL hints ("gestrichelt = die Prognose", "rote Bänder")
  in `tour-briefings.ts` are reworded (de/en).
- Applies to every ZWL **(decided: general change)**.

### 3. Conflicts: dotted and grey instead of red, in the ZWL and on the map

- **Now:** the contention ribbons (`zwl.component.html:126-135`, class
  `zwd__band`) are filled with `--app-zwd-conflict-fill` and outlined with
  `--app-zwd-conflict`, which is `--app-severity-error` (red,
  `styles.scss:276-277`). The same tokens colour the conflict chips above the
  plot (`zwl.component.scss:71-86`) and the legend swatch (`:311-312`).
- **Change** **(decided: one colour in ZWL and map, grey)**:
  - A new token `--app-conflict-area` in `styles.scss`, a dark grey.
    `--app-zwd-conflict(-fill)` and the map's `--layer-color-contentions`
    (`styles.scss:88`) derive from it, so chips, ribbons, labels, legend and
    the map's conflict marks change together and stay the same colour
    ([plan-b-small-changes.md](plan-b-small-changes.md) item 3 keeps its
    point: one conflict reads the same in both views).
  - The ribbon's outline is dotted (`stroke-dasharray: 2 3`) and its fill
    light, so the band reads as an area of caution, not an alarm. Red keeps
    its meaning for errors and delay origins.
  - Grey has to stay apart from the ZWL's single-track bands
    (`--app-zwd-single-track`, a light grey fill) and the map's rails: the
    conflict area is darker and the only one with a dotted outline. To be
    checked on screen; if grey doesn't read, the token's value changes, no
    other code (yellow was dropped: too close to the KI colour).

### 4. "Episode beendet" says what happened

- **Now:** `backend/app/core/hmi_mock.py:76-88` emits `episode.finished`
  ("Alle Züge haben ihr Ziel erreicht.") whenever `dones["__all__"]` is
  true. Flatland sets that also when the episode's time runs out, with trains
  still on the way.
- **Change:**
  - All trains `DONE`: `episode.finished` as before.
  - Time ran out: a new code `episode.timeUp` with params
    `{notArrived, total}`. German: title "Episode beendet", message
    "Die Zeit ist abgelaufen: {{notArrived}} von {{total}} Zügen sind nicht
    angekommen." **(decided: add the sentence)**
  - New keys `notifications.episode.timeUp.{title,message}` (en/de/fr); the
    frontend words it via `NotificationWordingService` (no code change there).

### 5. "Ja, als Regel" looks like "Nein"

- **Now:** `rp-btn--yes` is filled with the co-learning accent,
  "Nein" is outlined (`reflection-prompt.component.scss:105-124`).
- **Change:** drop the `--yes` fill; both buttons are outlined. The disabled
  state stays for "Ja, als Regel" (it needs a factor). The class and the
  `data-log` ids stay.

### 6. "Weiss nicht" on the three choice questions

- **Now:** the reflection prompt (`features/reflection-prompt/`) has three
  chip questions: factors (multiple choice, `FACTORS`), gut feeling (single,
  `GUT`) and missing information (multiple, `MISSING`) —
  `reflection-prompt.component.ts:20-42`.
- **Change:**
  - Each list gets `{ id: 'unknown', labelKey: '….unknown' }` as its last
    option, "Weiss nicht" (en "Don't know", fr "Je ne sais pas").
  - In the two multiple-choice questions it is exclusive **(decided)**:
    choosing it clears the others, choosing another clears it
    (`toggleFactor`, `toggleMissing`). In "gut" it is one more single choice.
  - "Nichts" in "missing" becomes exclusive the same way **(decided)**.
  - "Weiss nicht" alone is enough for "Ja, als Regel" (`canConfirm`)
    **(default)**. As a factor it goes into the rationale text like every
    other chip (the text is the only record of the factors), and it carries no
    value axis: `valueAxisFromRationaleIds` has no entry for `unknown`.
  - Keys: `rationale.chip.unknown`, `reflectionPrompt.gut.unknown`,
    `reflectionPrompt.missing.unknown`; the debrief finds the last two by id.
- **Export and summaries:** answers are stored as ids (`reflection.gut`,
  `reflection.missing`, the factor ids in `rationale`), so the export needs no
  new column. The new ids need translations wherever answers are read back:
  `tour-debrief.component.ts:223-227` and the Schichtbilanz's reflection
  overview (#201), and the codebook entry if the reflection is listed there.

### 7. "Halten bis frei" removed

- **Now:** the option is offered in the Handlungsoptionen
  (`proposal-compare.component.ts:112`, caveat at `.html:196-198`) and in the
  map's option strip at the selected train
  (`flatland-map.component.ts:223`).
- **Change:** remove it from both lists and the caveat **(decided)**.
  `ProposalOption` and the backend (`overrides.py:435`) keep
  `hold_until_clear`, so old logs and replays stay readable. The keys stay in
  the i18n files (they are click ids).
- Not touched **(decided)**: the rule builder and sandbox replay of the
  co-learning tours keep their own `hold_until` measure ("Halten bis frei" as
  a rule's measure).

### 8. Decision log summary: Mensch and KI only

- **Now:** the summary (`decision-log-panel.component.html:60-77`) counts
  entries by `accountableOwner`: Mensch, KI, System. Taking a proposal is
  always `'human'` (`SessionStore.recordProposalChoice`, `session.store.ts:790`,
  action `'accept'` for the KI plan, `'proceed'` for keeping the plan); only a
  countdown auto-apply is `'ai'`, and `systemHold` is `'system'`.
- **Change** **(decided)**:
  - "System" goes from the summary.
  - KI = entries owned by `'ai'` plus taken KI plans (`origin === 'proposals'`
    and `action === 'accept'`).
  - Mensch = the other human entries: "Kein Eingriff" and the human's own
    option.
  - Display only: `accountableOwner` stays as stored, so the study data,
    the override rate (`overrideRate`) and the Director note keep their
    meaning. A pure function `summaryCounts()` and a computed `summary`;
    `humanCount` / `aiCount` stay for those uses, `systemCount` goes.

### 9. "Plan" becomes "Kein Eingriff"

- **Now:** the first box in the Handlungsoptionen is "Plan" with the subline
  "ohne Eingriff", its button "Plan behalten"; the "Vergleich" below labels
  the same course "Plan" (`VARIANT_LABEL` → `proposals.plan`).
- **Change** **(decided: everywhere, wording only)**:
  - `proposals.plan`: "Plan" → "Kein Eingriff" (en "No intervention").
  - `proposals.planSub` is no longer shown (`proposal-compare.component.html:63`).
  - The co-learning tours' hints that list "Plan, KI-Vorschlag und deine
    Wahl" say "kein Eingriff" instead (`tour-briefings.ts`, de/en).
  - `proposals.keepPlan`: "Plan behalten" → "Nicht eingreifen" (en "Don't
    intervene"); key and `data-log` id stay.
  - Sentences that mean the same course follow, e.g. `proposals.note`,
    `proposals.aiMatchesPlan`. "gegenüber Plan" (`stepVsPlan`, the
    timetable) stays: it means the Fahrplan, not the box.

## New files

| File | Adds |
| --- | --- |
| — | Only new keys and a token; no new files |

## Modified files

| File | Change |
| --- | --- |
| `frontend/src/app/core/timetable/current-delay.{service,spec}.ts` | `delayLabel()`: `"0"` when on time (item 1) |
| `frontend/src/app/features/zwl/zwl.component.scss` | Forecast solid; band dotted (items 2, 3) |
| `frontend/src/app/features/zwl/zwl.component.{html,ts}` | One legend entry "Ist und Prognose"; doc comment (item 2) |
| `frontend/src/styles.scss` | New `--app-conflict-area`; `--app-zwd-conflict(-fill)` and `--layer-color-contentions` derive from it (item 3) |
| `backend/app/core/hmi_mock.py` | `episode.timeUp` when time ran out (item 4) |
| `backend/tests/test_notification_codes.py` | Both endings (item 4) |
| `frontend/src/app/features/reflection-prompt/reflection-prompt.component.{ts,scss}` | Button style; `unknown` options, exclusive toggles (items 5, 6) |
| `frontend/src/app/features/reflection-prompt/reflection-prompt.component.spec.ts` | Exclusivity, confirm with "Weiss nicht" |
| `frontend/src/app/core/demo/tour-briefings.ts` | ZWL hints (items 2, 3), "kein Eingriff" (item 9) |
| `frontend/src/app/features/proposal-compare/proposal-compare.component.{ts,html}` | Without `hold_until_clear`; no `planSub` (items 7, 9) |
| `frontend/src/app/features/flatland-map/flatland-map.component.ts` | Option strip without `hold_until_clear` (item 7) |
| `frontend/src/app/features/decision-log/decision-log-panel.component.{ts,html}` | `summaryCounts()` / `summary`, no System cell (item 8) |
| `frontend/src/app/features/decision-log/decision-log-panel.component.spec.ts` | Counting rule (item 8) |
| `frontend/public/i18n/{en,de,fr}.json` | `episode.timeUp`, `….unknown`, wording of `proposals.plan`, `keepPlan`, related sentences |

## Open points

None. All answered by the study lead on 27 November 2026.
