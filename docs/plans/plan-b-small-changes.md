# Plan B: small changes to the working screen

Status: implemented, 16 November 2026. Target: `main`. One PR, one commit per item.
Screenshots (uc2-1 leg of `plan-b-uc2`) in `plan-b-small-changes/`.

Ten small changes to the Plan B working screen (`preset-plan-b`, co-learning),
plus the tutorial's new station names. Decisions taken with the study lead are
marked **(decided)**; defaults this plan chose on its own are marked
**(default)** and can still be changed.

## Items

### 1. Taller ZWL area, and no jumping scroll

- **Now:** the centre tab area (`preset-pb-views`, `view-tabs`) has no row
  height of its own; the headerless panel body caps it at `min(85vh, 60rem)`,
  and the ZWL plot has `min-height: 320px`. With its 84 px station header on
  top, the ZWL always has some internal scroll. On every step, the
  `followNow` effect (`zwl.component.ts:169-186`) sets `scrollTop` back to
  about 0 as soon as the now-line is outside the visible band, which is
  exactly the case after the user scrolled away. That is the jump.
- **Change:**
  - Plan B gives the tab area the free height of the screen: a
    `minBodyHeight` and `max-height` for `preset-pb-views` that fill the
    viewport beside the right column, so the ZWL fits without scrolling on
    a normal laptop screen (1080 px high) **(default)**.
  - `followNow` only follows the now-line while the user hasn't scrolled by
    hand, and never moves the view on a mere re-render. With the taller
    area this mostly never triggers, but it stops the jump on small screens.

### 2. Zoom back in the Streckenspiegel, opacity slider gone

- **Now:** the zoom buttons were not removed, only hidden. In Plan B,
  `control.mapNavigation` hides both the pan arrows and the zoom +/−/%
  overlay (`flatland-map.component.html:789-805`). Mouse-wheel zoom and drag
  pan still work. The vertical slider ("25%") is the rail-tile **opacity**
  (`railOpacity`), not a contrast setting.
- **Change:**
  - A new UI-config id `control.mapZoom` guards the zoom +/−/% overlay;
    `control.mapNavigation` keeps guarding only the pan arrows. Plan B
    hides pan arrows, shows zoom **(default)**. Existing ids aren't renamed.
  - A new UI-config id `control.mapOpacity` guards the slider; Plan B hides
    it **(default: Plan B only, the other tours keep it)**.

### 3. Conflicts red on the map too

- **Now:** the map draws conflicts with `--layer-color-contentions`, which
  is `--app-severity-warn` (orange). The ZWL draws them with
  `--app-zwd-conflict`, which is `--app-severity-error` (red).
- **Change:** `--layer-color-contentions` points to `--app-severity-error`.
  It's a token change in `styles.scss`, so it applies in every mode
  **(default)**, which matches the ZWL everywhere.

### 4. "Umleiten" becomes "Fahrweg ändern" (decided: everywhere)

- Every German "Umleiten" the UI shows: `proposals.option.reroute`
  (Handlungsoptionen), `log.action.reroute`, `impact.measureHoldOrReroute`,
  `impact.rule.measure.reroute`, `tourUi.debrief.action.reroute`,
  `tourUi.sandboxReplay.option.reroute`, `tourUi.rule.measure.reroute`.
- Related wordings follow ("keine Umleitung" → "kein anderer Fahrweg" and
  the like), so a participant meets one term throughout.
- en: "Reroute" → "Change route"; fr accordingly (needs a native check).
- Keys and `data-log` ids stay; only the wording changes.

### 5. Train names on the ZWL, just above the now-line

- **Now:** each train's name (from the scenario's `train_names`, e.g. ICE,
  IC3, IR35; `TrainIdentityService.nameFor`) is drawn at the end of its line
  (`zwl.component.ts:605-638`).
- **Change:** the name sits where the train's line crosses the now-line,
  slightly above it, and moves with the now-line. Trains whose line doesn't
  cross the now-line (not departed, arrived) get no label **(default)**. The
  label at the end of the line goes **(default)**; the delay suffix moves
  with the name.

### 6. Close "x" on the train pop-up in the Streckenspiegel

- **Now:** clicking a train opens the option strip (`.map-train-options`,
  `flatland-map.component.html:694-716`); it closes only by clicking the
  train again.
- **Change:** an "×" button in its top right corner that clears the
  selection, like the station pop-up next to it (`map-route-popover__close`).
  New key `map.trainOptions.close` (en/de/fr), used as `aria-label` and
  `data-log` id.

### 7. No "Nur diesmal" in the reflection (decided: Plan B reflection only)

- **Now:** the reflection prompt (`reflection-prompt.component.html:60-64`)
  offers "Ja, als Regel", "Nur diesmal" and "Nein", without `data-log` ids,
  so the click log records them as `button[0..2]`.
- **Change:**
  - Remove the "Nur diesmal" button from the reflection prompt; reword
    `reflectionPrompt.ruleHint` so it no longer mentions it.
  - Give the two remaining buttons fixed `data-log` ids (their existing
    translation keys). Without them, "Nein" would move from `button[2]` to
    `button[1]`, which used to mean "Nur diesmal", and old and new click
    logs would read differently.
  - The Co-Learning/Recommendation rationale capture and the Director
    strategy reflection keep the option; `'once'` stays in the types, the
    learning store and the shift review.

### 8. Times in steps (decided: only this part, not #183)

- **Now:** `MINUTES_PER_STEP` is 1, so the numbers are already steps; only
  the units say minutes. On the Plan B screen that's:
  - the ZWL's delay suffix ("+5′", `current-delay.service.ts`) and its time
    axis wording;
  - "in {{min}} min" for conflicts in the ZWL (`zwd.conflicts.inMin`);
  - " · {{delta}} min erwartet" in the Streckenspiegel (`map.predicted`);
  - any other "min" in the Plan B widgets (timetable, Lage, Handlungsoptionen,
    notifications, decision log, reflection), checked one by one in the app.
- **Change:** those say steps ("Schritte"). No `minutes_per_step`, no
  formatter service; that remains #183's job.
- **Note:** `feature/183-time-in-steps` (local, not pushed) will conflict
  with this PR in the i18n files, the ZWL and the map once it's revived.

### 9. Codebook with all questionnaires (decided)

- **Now:** the export (`core/survey/survey-export.ts`) builds the codebook
  from the post-session questionnaires of the three modes only. The Plan B
  questionnaire (`plan-b-final`: `pb_1` … `pb_37`, demographics) is missing.
  For the same reason the long sheet has no question text for Plan B
  answers and the wide sheet no Plan B item columns.
- **Change:**
  - The export knows every questionnaire the app can show: the three
    post-session ones plus `plan-b-final` (and any other survey part a
    study condition or tour enables).
  - Codebook: a `survey_id` column; scale labels and answer options for
    agreement scales, radios and numbers (`options`, `unit`, `step`).
  - Long and wide sheets find the Plan B items too.
  - Old items stay in the codebook, because other conditions still ask
    them.
  - Not included: scores for the Plan B subscales (none are defined), and
    the reflection questions (they're in the decision log, not a
    questionnaire). Whether `pb_23`–`pb_27` are reverse-keyed is a question
    for the study team.

### 10. The rightmost station name in the ZWL isn't cut off

- **Now:** station names are slanted at 45° up and to the right from their
  tick. The right gutter is 24 px, so the last name runs out of the
  header SVG, which clips it.
- **Change:** the right gutter grows to fit the last label's slanted
  width (measured, or estimated from its length), so every name is shown
  in full. The plot gets slightly narrower **(default)**.

### Also in this PR: the tutorial's station names

- `backend/app/fixtures/plan-b/tutorial/{draw.json, generator.json,
  scenario.pkl}`, regenerated with "Bahnhof A"/"Bahnhof B". Trains,
  timetable and the scheduled malfunction are unchanged.
- **Caution for later:** `main` has no UC2 model, but #196 pins the hash of
  every scenario `.pkl` (`uc2_bundle.py`). When `main` and #196 meet, the
  tutorial's hash must be re-pinned there, or the KI breaks in the tutorial.

## New files

| File | Purpose |
|---|---|
| `docs/plans/plan-b-small-changes.md` | This plan |

## Modified files

| File | Change (item) |
|---|---|
| `frontend/src/app/core/layout/layout-presets.ts` | Plan B tab-area height (1); hide `control.mapOpacity`, show `control.mapZoom` (2) |
| `frontend/src/app/features/view-tabs/*`, `features/layout/components/panel-shell/*` | Height of the tab area (1), if the preset settings don't suffice |
| `frontend/src/app/features/zwl/zwl.component.{ts,html,scss}` | `followNow` (1); names at the now-line (5); right gutter (10); step wording (8) |
| `frontend/src/app/features/flatland-map/flatland-map.component.{ts,html,scss}` | Zoom/opacity guards (2); close button (6); step wording (8) |
| `frontend/src/app/core/config/ui-config-items.ts` | `control.mapZoom`, `control.mapOpacity` (2) |
| `frontend/src/styles.scss` | `--layer-color-contentions` red (3) |
| `frontend/public/i18n/{en,de,fr}.json` | Wording (4, 7, 8); `map.trainOptions.close` (6) |
| `frontend/src/app/features/reflection-prompt/reflection-prompt.component.{html,ts,spec.ts}` | Without "Nur diesmal", `data-log` ids (7) |
| `frontend/src/app/core/timetable/current-delay.service.ts` | Delay suffix in steps (8) |
| `frontend/src/app/core/survey/survey-export.{ts,spec.ts}`, `survey-configs.ts` | All questionnaires, new columns (9) |
| `docs/experiment-logging.md` | Codebook columns, click-id table (6, 7, 9) |
| `backend/app/fixtures/plan-b/tutorial/*` | Station names |

## Checks

- `npm run lint:styles`, `npm run i18n:check`, production build, specs of
  the touched components, `pytest -q`.
- Each visible item checked in the running app on a Plan B leg with several
  trains (uc2-1), with screenshots for the PR's requirements table.
