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
  - Plan B's tab area is taller (`minBodyHeight` 560 instead of 340).
  - The time axis has a fixed scale: the visible plot shows 60 steps
    (`STEPS_IN_VIEW`), and the rest scrolls. **(changed after testing)** A
    first version fitted the whole time range into the taller area, so the
    ZWL never scrolled; but then it squashed and stretched whenever the
    forecast grew or shrank. The scroll bar is what kept the scale steady.
  - The now-line stays 20 steps below the top of the view (`NOW_PAST_STEPS`),
    so two thirds of the view show the future, and the diagram scrolls up
    underneath it. **(added after testing)**
  - Once the reader scrolls by hand, the view stays where they put it (that
    ends the jump). It follows again when they scroll the now-line back near
    its place, or press "Zu jetzt", which shows while they're away (new key
    and click id `zwd.toNow`).

### 2. Zoom back in the Streckenspiegel, opacity slider gone

- **Now:** the zoom buttons were not removed, only hidden. In Plan B,
  `control.mapNavigation` hides both the pan arrows and the zoom +/−/%
  overlay (`flatland-map.component.html:789-805`). Mouse-wheel zoom and drag
  pan still work. The vertical slider ("25%") is the rail-tile **opacity**
  (`railOpacity`), not a contrast setting.
- **Change:**
  - One UI-config id per overlay control **(decided)**: `control.mapPan`
    (pan arrows), `control.mapZoom` (zoom +/−/%), `control.mapOpacity`
    (below). Plan B hides pan arrows, shows zoom.
  - `control.mapNavigation` is no longer offered, but it still works as a
    legacy alias for `control.mapPan` + `control.mapZoom` (`UI_CONFIG_ALIASES`),
    its old meaning: a `ui-config.json` or saved design that hides it behaves
    as before. The schema still accepts it.
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
  - One list for the export and the replay (`survey-configs.ts`). There are two kinds of questionnaire, both chosen
    by survey parts (a tour's or an experiment's `surveyParts`, or Settings):
    - **built from building blocks** (`mode`, `nasa-tlx`, `trust`, `understanding`, `ueq-s`, `open`), combined
      freely: the id is `post-session-<mode>`, and the content depends on the mode, the enabled parts and
      `afterLeg`;
    - **fixed questionnaires** (`FIXED_QUESTIONNAIRES`): one part stands for the whole questionnaire and replaces
      the building blocks; its id is its own (`plan-b-final`). Any tour, experiment or setting naming the part gets
      it. Only Plan B has one so far.

    `allSurveys()` lists both (the export), `surveyById()` finds one by a record's `surveyId` (the replay). The
    replay shows the recorded questionnaire by its `surveyId`, so it no longer needs the condition: before, a
    record whose condition no longer exists showed an empty Plan B questionnaire.
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

## Limitations

*What the built code does not handle. The code keeps no list of its own; there are no `TODO`s for these.*

- No scores for Plan B's questionnaire: none are defined (item 9). Untracked.
- Whether `pb_23`–`pb_27` are reverse-keyed is not known: the codebook says `reverse` false. The study team decides
  (item 9).
- Without a canvas, the ZWL's right gutter is estimated from the length of the last station name, not measured
  (item 10).
- French wordings ("Changer d'itinéraire", the step units) need a native check (items 4 and 8).
- The tutorial's new `.pkl` hash isn't pinned in #196's UC2 model; that must be re-pinned when #196 meets `main`
  (tutorial station names). Raised on #196:
  [comment](https://github.com/flatland-association/flatland-ui-hub/pull/196#discussion_r4611702299).
- `feature/183-time-in-steps` (not pushed) will conflict in the i18n files, the ZWL and the map (item 8).

## New patterns

*Compared with `main`.*

| ID | New | Defined in |
|---|---|---|
| PAT-1 | The time-vertical ZWL has a fixed scale (60 steps visible, `STEPS_IN_VIEW`) and scrolls, instead of fitting the time range into the panel. | Item 1 |
| PAT-2 | The ZWL follows the now-line (20 steps below the top, `NOW_PAST_STEPS`) until the reader scrolls by hand; "Zu jetzt" (`zwd.toNow`) or scrolling back resumes it. | Item 1 |
| PAT-3 | One UI-config id per map overlay control (`control.mapPan`, `control.mapZoom`, `control.mapOpacity`); a retired id lives on as a legacy alias (`UI_CONFIG_ALIASES`) that the config service expands. | Item 2 |
| PAT-4 | Train names at the now-line instead of at the end of the line. | Item 5 |
| PAT-5 | Buttons of the reflection prompt get fixed `data-log` ids (`rationale.yes`, `rationale.no`) instead of positional ones. | Item 7 |
| PAT-6 | Fixed questionnaires (`FIXED_QUESTIONNAIRES`, by survey part) beside the building-block ones; one list (`allSurveys`, `surveyById`) for the export and the replay; the codebook gains `survey_id`, `page`, `step`, `unit`, `options`. | Item 9 |
| PAT-7 | The replay finds a questionnaire by the record's `surveyId`, not by the condition's survey parts. | Item 9 |

## Breaking changes

*None for the stored data: ids, translation keys and the session record format stay. What changes is visible
behaviour outside Plan B and the export's columns.*

- **ZWL scale and scroll, in every mode (item 1).** Every time-vertical ZWL now shows 60 steps and scrolls, and
  keeps the now-line 20 steps below the top. Affects every preset and tour with a ZWL. No switch keeps the old
  fit-to-panel scale: deliberately, since it squashed and stretched as the forecast changed.
- **Map control ids (item 2).** None for configs: `control.mapNavigation` still hides pan arrows and zoom. New
  session records list `control.mapPan` and `control.mapZoom` in their recorded restrictions where older ones
  list `control.mapNavigation`; an analysis of both reads the old id as the two new ones.
- **Conflicts red on the map in every mode (item 3).** `--layer-color-contentions` is a shared token. Screenshots
  of other modes show red instead of orange.
- **Reflection prompt click ids (item 7).** Clicks on "Ja, als Regel" and "Nein" log as `rationale.yes`/`rationale.no`
  instead of `button[0]`/`button[2]`. Analyses that read the old positional ids must map both forms; records
  before this PR keep the positional ones. "Nur diesmal" (`'once'`) is no longer logged from the reflection prompt.
- **Codebook columns (item 9).** The codebook sheet gains `survey_id`, `page`, `step`, `unit` and `options`, and the
  column order changes. Scripts that read the codebook by position break; by column name they keep working. The
  long and wide sheets keep their columns and gain Plan B's items.
- **Replayed questionnaires (item 9).** The replay shows only the sections that were answered, also when the
  condition is known; before, it showed every section the condition asked. A section asked but left completely
  empty no longer shows (not possible in Plan B: `requireAll`). `ReplayService.surveyParts` is removed; it had no
  other user.
- **Wording (items 4, 8).** "Umleiten" → "Fahrweg ändern" and minutes → steps change only the text; keys and
  `data-log` ids stay.
- **Tutorial `.pkl` (tutorial station names).** New file hash; see Limitations for #196.

## Code Review Findings

*Code review findings (1-12) were added on 2026-11-18, at 8c2ba59f; their line numbers refer to it. Sources: `/code-review` (medium) and the custom review.*

| Fixed | ID | Source | Category | Severity | Finding | Commit message |
|---|---|---|---|---|---|---|
|  | F-1 | code review | bug | medium | `frontend/src/app/features/zwl/zwl.component.ts:226,242,511`: "Detached" doesn't keep the view still. From step 80 on, `stepDomain` starts at `now - 80`, so every step redraws the diagram one step higher under a fixed `scrollTop`; a reader who scrolled up to a past crossing sees it drift out of view within a few steps, while the doc comment and item 1 say "the view stays where they put it". Fix: while detached, shift `scrollTop` by the step's pixel change of the domain start (`(start - prevStart) * stepPx`), or freeze the domain start while detached. Open. | fix(zwl): keep a detached view on the same steps while the time window slides. |
|  | F-2 | code review | bug | medium | `frontend/src/app/features/zwl/zwl.component.ts:687-693`: with time running down, the unit label ("Schritt") sits at `plotY0 - 8` inside the scrolling plot. Following the now-line keeps `scrollTop` at about `y_now - 20 steps`, so after a few steps the label is above the visible area for the rest of the run; the axis shows bare numbers, while item 8 relies on the axis naming the unit. Fix: draw the unit in the sticky header (left corner, above the time column). Open. | fix(zwl): show the time unit in the sticky header, where it doesn't scroll away. |
|  | F-3 | code review | design | medium | `frontend/src/app/features/reflection-prompt/reflection-prompt.component.html:65`: "Nur diesmal" is removed from the reflection prompt everywhere it shows, i.e. in every decision log's inline reflection (`decision-log-panel.component.html:166`), e.g. the Co-Learning interview preset (`preset-ci-decisions`), not only in Plan B; item 7 says "decided: Plan B reflection only". Either the decision means "the reflection prompt, not the rationale capture" (then reword item 7), or the option needs a Plan B gate (a ui-config id such as `widget.reflection-prompt.once`). For the study lead. Open. | fix(reflection): offer "Nur diesmal" again outside Plan B, hidden by a ui-config id. |
|  | F-4 | code review | test-coverage | medium | `frontend/src/app/features/zwl/zwl.component.ts:207-255,705-770`, `frontend/src/app/features/flatland-map/flatland-map.component.ts:252-266`: no spec covers the new ZWL behaviour (follow, detach on a hand scroll, "Zu jetzt", fixed scale, names at the now-line, right gutter) or the map's "×"; neither component has a spec file. F-1, F-2, F-5 and F-7 would have shown up in such specs. Fix: a `zwl.component.spec.ts` with a fake clock and scroller, and a map spec for the close/reopen cycle. Open. | test(zwl): cover follow, detach, the fixed scale and names at the now-line. |
|  | F-5 | code review | bug | low | `frontend/src/app/features/zwl/zwl.component.ts:226,242-251`: `detached` is never reset when the orientation, the scenario or the session changes, so the next leg starts frozen with "Zu jetzt" showing. Also a scroll the browser makes on its own (panel resize, shorter diagram clamping `scrollTop`) reaches `onScroll` as if the reader scrolled, and detaches when the follow target is out of reach. Fix: reset `detached` in an effect on orientation and session; ignore scroll events while the content height just changed. Open. | fix(zwl): follow the now-line again on a new leg or orientation, and ignore scrolls the browser makes. |
|  | F-6 | code review | bug | low | `frontend/src/app/core/timetable/current-delay.service.ts:65`, `frontend/src/app/features/flatland-map/flatland-map.component.ts:290`: the delay suffix lost its unit sign, but the map uses it too and has no axis naming the unit: a late train reads "Zug 3 +5", also for screen readers. Fix: the map's label (and `aria-label`) uses `zwd.delaySteps`-style wording, or the suffix keeps a unit outside the ZWL. Open. | fix(map): name the unit of a train's delay on the map. |
|  | F-7 | code review | bug | low | `frontend/src/app/features/flatland-map/flatland-map.component.ts:2322-2326`: after "×" closes a train's option strip, clicking that train deselects it (`toggleAgentSelection`), so the strip needs a second click; item 6 says it "comes back on the next click on a train". Fix: in `toggleSelect`, when the strip of the selected train was closed, reopen it instead of toggling. Open. | fix(map): reopen a closed option strip on the first click on its train. |
|  | F-8 | code review | bug | low | `frontend/src/app/features/zwl/zwl.component.ts:214-221`: the follow scroll is set in a `requestAnimationFrame` after the render, so during the first 80 steps (domain start fixed at 0, now-line moving down) the diagram is drawn one frame at the old `scrollTop`: a small lag per frame. From step 80 on the now-line's content position is constant and nothing moves. Plausible, not seen in the app. Fix: set `scrollTop` in `afterRenderEffect`. Open. | fix(zwl): scroll with the render, not a frame later. |
|  | F-9 | code review | robustness | low | `frontend/src/app/features/zwl/zwl.component.ts:752-770`: `nowLabels` puts the name at the train's last past point and treats "no forecast and last point older than one step" as arrived. A trajectory with a gap or a train without a forecast loses its name or shows it at an old place. Plausible. Fix: interpolate the crossing from past and forecast; call a train arrived only from its state. Open. | fix(zwl): place train names where the line really crosses the now-line. |
|  | F-10 | code review | bug | low | `frontend/src/app/features/zwl/zwl.component.ts:687-693`: with time running across, the unit label ends at `plotX0 - 6` on the tick-label row, where the first tick's centred label reaches; the two overlap. Plausible. Fix: put it below the row, or left of the plot's gutter. Open. | fix(zwl): keep the time unit clear of the first tick label. |
|  | F-11 | code review | design | low | `frontend/src/app/features/zwl/zwl.component.ts:678`, `frontend/src/app/core/timetable/current-delay.service.ts:55`: the labels say steps, but the values are still multiplied by `MINUTES_PER_STEP`, documented as the one place to change for a real timescale; with 2 they would show minutes labelled "Schritte". Item 8 leaves the unit to #183; a `TODO(#183)` at the multiplications would keep this visible. Open. | docs(zwl): mark the step labels that still multiply by MINUTES_PER_STEP for #183. |
|  | F-12 | code review | docs | low | `docs/plans/plan-b-small-changes.md:93,250`: item 6 and the modified-files table name the close button's key `map.trainOptions.close`; the code and `docs/experiment-logging.md` use `map.closeTrainOptions`. Open. | docs(plans): name the close button's real key. |

## New files

| File | Purpose |
|---|---|
| `docs/plans/plan-b-small-changes.md` | This plan |

## Modified files

| File | Change (item) |
|---|---|
| `frontend/src/app/core/layout/layout-presets.ts` | Plan B tab-area height (1); hide `control.mapPan` and `control.mapOpacity`, show `control.mapZoom` (2) |
| `frontend/src/app/features/view-tabs/*`, `features/layout/components/panel-shell/*` | Height of the tab area (1), if the preset settings don't suffice |
| `frontend/src/app/features/zwl/zwl.component.{ts,html,scss}` | `followNow` (1); names at the now-line (5); right gutter (10); step wording (8) |
| `frontend/src/app/features/flatland-map/flatland-map.component.{ts,html,scss}` | Zoom/opacity guards (2); close button (6); step wording (8) |
| `frontend/src/app/core/config/ui-config-items.ts`, `.spec.ts`, `ui-config.service.ts`, `.spec.ts`, `public/ui-config.schema.json`, `README.md` | `control.mapPan`, `control.mapZoom`, `control.mapOpacity`; `control.mapNavigation` as a legacy alias (2) |
| `frontend/src/styles.scss` | `--layer-color-contentions` red (3) |
| `frontend/public/i18n/{en,de,fr}.json` | Wording (4, 7, 8); `map.trainOptions.close` (6) |
| `frontend/src/app/features/reflection-prompt/reflection-prompt.component.{html,ts,spec.ts}` | Without "Nur diesmal", `data-log` ids (7) |
| `frontend/src/app/core/timetable/current-delay.service.ts` | Delay suffix in steps (8) |
| `frontend/src/app/core/survey/survey-export.{ts,spec.ts}`, `survey-configs.ts`, `plan-b-final-survey.spec.ts` | All questionnaires, new columns, `FIXED_QUESTIONNAIRES`, `allSurveys`, `surveyById` (9) |
| `frontend/src/app/features/survey/survey.component.{ts,spec.ts}`, `app.component.html`, `core/replay/replay.service.ts` | Replay by `surveyId`; `ReplayService.surveyParts` removed (9) |
| `docs/experiment-logging.md` | Codebook columns, click-id table (6, 7, 9) |
| `backend/app/fixtures/plan-b/tutorial/*` | Station names |

## Checks

- `npm run lint:styles`, `npm run i18n:check`, production build, specs of
  the touched components, `pytest -q`.
- Each visible item checked in the running app on a Plan B leg with several
  trains (uc2-1), with screenshots for the PR's requirements table.
