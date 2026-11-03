# Play toolbar: under the guide strip, no step buttons, Plan B without playback (#167)

> **Status:** plan, 2026-11-03. Issue
> [#167](https://github.com/flatland-association/flatland-ui-hub/issues/167)
> ("\"Play\" Taskliste anpassen und verschieben", @CleverManu, label `plan b`).
> Branch `feature/167-play-tasklist`, off `main`. Open questions are in §7.

## 1. What the issue asks for

| # | Requirement (issue wording) | Scope | Where in this plan |
|---|---|---|---|
| 1 | "Die ganze Zeile [the play toolbar] soll in/unter der «Szenario» Zeile erscheinen" | wherever the guide strip is shown | §4.1 |
| 2 | "Schritte Buttons entfernen" (Schritt 1 / 10 / 50) | general, every run | §4.2 |
| 3 | "Play/Pause und Speed sollen nicht angezeigt werden" | the experiment, Plan B only | §4.3 |

The "Szenario" line is the guide strip (`app-tour-guide`): the leg label
"Walenstadt: Türstörung (1/3)", the Betrieb/Lernen steps and, below them, the
hint "Schritt 1 · Konflikt erkennen: …". The "Schritt n" there is a guide step,
not a simulation step, and stays.

### 1.1 Assumptions and exclusions

- **"allgemein" means every run**, not only experiments: the step buttons go
  from the toolbar for good. The scenario can still be advanced step by step
  nowhere else in the working screen; that is the point of the request.
- **The move applies wherever the guide strip is shown** (guided experiments
  and the tours that have a guide), since the issue lists it before the
  Plan B part. Without a guide strip the toolbar stays at the top as today.
- **`control.playback` is only safe on conditions that never leave the run
  paused for a human** (assumption; decided 2026-11-03). Plan B meets it
  (§2.1). Two existing behaviours do not, and stay excluded from this plan:
  Recommendation's conflict countdown (`impact-panel`,
  `decisionMoment: 'countdown'`) pauses globally and resumes only when the AI
  decides on timeout, not after a human decision; and `combined-actions`
  pauses once at the first conflict of a guided run and never resumes. A
  condition that hides playback **and** uses either would strand the
  participant at the first conflict. Such a condition needs an automatic
  resume after the decision, or must not use these pauses; that is not built
  here.
- **Out of scope:** `features/simulation-slider` also has +1/+10/+50 buttons,
  but the component is not used in any template (only its own selector
  exists), so it is left alone. The replay's own stepper is not the toolbar
  and is not touched.

## 2. Today (checked 2026-11-03 on `main`, `0ec3516`)

- `app.component.html:116-118` renders `<app-toolbar>` at the top of the
  working screen, above `<app-experiment-progress>` and `<app-tour-guide>`
  (`:150-155`).
- `features/toolbar/toolbar.component.html` holds, in this order: Play/Pause
  (`data-log` `toolbar.play` / `toolbar.pause`), the speed slider
  (`toolbar.speed`, with level label and "1 min = n s"), the three step buttons
  (`toolbar.step`, shown only while not playing), the policy select (only with
  more than one selectable policy, so hidden under Plan B's
  `policyAllowlist`), then the spacer, "Episode beendet", the loading/countdown
  indicator, the info message and the finish button ("Szenario abschliessen →
  …", `experimentRun.finishLabel()`).
- `features/layout/.../panel-plugin-host.component.html:43` also renders the
  toolbar, as a layout panel of type `toolbar`.
- Plan B's in-run restrictions are `PLAN_B_UI` in
  `core/layout/layout-presets.ts:695`, a `UiConfig` whose `hidden` ids come
  from `CONTROL_IDS` in `core/config/ui-config-items.ts` and are mirrored in
  `public/ui-config.schema.json` (docs/plans/configurable-ui-plan.md §4-§5).

### 2.1 Can a Plan B participant do without Play/Pause?

Yes, checked against everything that starts or stops the run:

- **Start:** the mode intro's «Szenario starten» plays the run when the
  briefing sets `autoStart` (`mode-intro.component.ts:76`);
  `colearning-experiment-2x`, which `plan-b-p01` uses, inherits
  `autoStart: true`. A reload resumes on a fresh session through the same
  intro (experiment-workflow.md §5.3).
- **Tempo:** a leg can pin `playSpeedLevel` (`ExperimentLeg`), so the study
  sets the speed per scenario without the slider.
- **Automatic pauses:** in Co-Learning the impact panel *holds* the affected
  trains and does not pause the world (`decisionMoment: 'hold'`,
  `impact-panel.component.ts:194`); the reason dialog pauses and resumes by
  itself (`tour-reason-dialog.component.ts:45-48`); the once-per-session pause
  in `combined-actions` is not in the Plan B layout. `endShift()` pauses, but
  `control.endShift` is hidden under Plan B and the finish button leaves the
  leg anyway.
- **End:** `episode_done` stops the run; the participant presses "Szenario
  abschliessen" (experiment-workflow.md §5.2), which stays.

So nothing leaves a Plan B run paused with no way on. A future condition that
hides playback **and** pauses for a decision (Recommendation's countdown,
`combined-actions`) would need its own resume; that is noted, not built (§7).

## 3. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | One new UI-config id, `control.playback`, covering Play/Pause and the speed control together | The `CONTROL_IDS` grain: one id per region, not per element (`ui-config-items.ts`). The issue names the two together |
| D2 | `control.playback` goes into `PLAN_B_UI.hidden`, not into the deployment file `ui-configs/plan-b.json` | It exists only inside a run, so it belongs to the preset block (configurable-ui-plan.md §5.1 vs §5.2) |
| D3 | The step buttons are deleted, not gated by an id | The issue asks for it in general; a config id nobody sets is dead weight |
| D4 | The `toolbar.step` key stays in `en/de/fr.json` | Earlier records carry `toolbar.step` as a click id (AGENTS.md: ids are study data). An unused en key does not fail `i18n:check` |
| D5 | When the guide strip is shown, the toolbar renders **directly under it** instead of at the top; one `<ng-template>` keeps a single copy of the `<app-toolbar>` binding (decided 2026-11-03: under, for now) | "unter" is met without content projection into `app-tour-guide` (`app.component.html:98-104` documents projection that silently fails inside nested `@if`) |
| D6 | Under Plan B the participant has **no Pause** either: `control.playback` hides Play and Pause alike, with no separate id for Pause (decided 2026-11-03) | Realistic time pressure: in operations the world does not stop while the dispatcher thinks, and delay keeps accruing while the participant reads and decides. The run still stops locally where the design wants it to (Co-Learning holds the affected trains; the reason dialog pauses and resumes itself, §2.1) |

## 4. Design

### 4.1 Placement (requirement 1)

`app.component.ts` gets one computed, `guideShown`, with the exact condition
that today gates `<app-tour-guide>`:

```ts
readonly guideShown = computed(() =>
  this.tourGuide.active() && (this.replay.active() ? this.replay.guideVisible() : this.experimentRun.guideVisible()));
```

In `app.component.html`:

- The `<app-toolbar …>` element with all its bindings moves into
  `<ng-template #toolbar>`.
- The top slot keeps its guard and adds `&& !guideShown()`, rendering
  `<ng-container [ngTemplateOutlet]="toolbar">`.
- Directly after `<app-tour-guide>` the same outlet renders when `guideShown()`.
- The guide's `@if` uses `guideShown()` too, so the two never disagree.

Result in a guided leg: stepper → guide strip → toolbar row → panels. Outside
a guide the toolbar stays at the top, unchanged.

Styling: the toolbar keeps its own row and styles; only its top margin/border
is adjusted where it follows the guide, with existing tokens (`--app-border`),
in `toolbar.component.scss` via a host class set from the template
(`[class.toolbar--under-guide]`) — no new colour token.

### 4.2 Step buttons (requirement 2)

- `toolbar.component.html`: delete the `@if (!store.playing())` block with the
  divider and the three `sbb-secondary-button`s.
- `toolbar.component.ts`: delete `step(n)`; `ClickLogService` stays injected
  only if something else uses it, otherwise the import and field go too.
- `SessionStore.step()` and `ApiService.step()` stay (used by
  `simulation-slider` and the backend contract).
- The `'step'` event kind in `session-record.ts` stays: it records the
  simulation's steps (`interaction-log.service.ts:176`), not the button.
- `docs/experiment-logging.md`: regenerate the click-id table
  (`node scripts/data-log-ids.mjs`); the three `toolbar.step` rows go.

### 4.3 Plan B: no Play/Pause, no speed (requirement 3)

- `ui-config-items.ts`: add
  `{ id: 'control.playback', label: 'Play/Pause and simulation speed (toolbar)', supports: ['hidden'] }`
  to `CONTROL_IDS`.
- `public/ui-config.schema.json`: add `"control.playback"` to the id enum.
- `toolbar.component.html`: wrap the Play/Pause `@if` and the `.speed-control`
  div in `@if (!uiConfig.isHidden('control.playback'))`; `uiConfig` becomes
  public on the component (it is `private` today).
- `layout-presets.ts`: add `'control.playback'` to `PLAN_B_UI.hidden` with an
  issue comment (`// #167 — Play/Pause and speed`).
- `configurable-ui-plan.md` §5.2: add the line to the `PLAN_B_UI` excerpt.

Under Plan B the toolbar row then holds only the right-hand side: status,
loading indicator and "Szenario abschliessen → …".

## 5. Files

### New files

| File | Adds |
|---|---|
| `docs/plans/toolbar-under-guide.md` | This plan |

### Modified files

| File | Change |
|---|---|
| `frontend/src/app/app.component.ts` | New `guideShown` computed (§4.1); `NgTemplateOutlet` import |
| `frontend/src/app/app.component.html` | Toolbar binding into `<ng-template #toolbar>`; top slot gated on `!guideShown()`; outlet after `<app-tour-guide>`; guide gated on `guideShown()` |
| `frontend/src/app/features/toolbar/toolbar.component.html` | Step-button block deleted; Play/Pause + speed gated on `control.playback` |
| `frontend/src/app/features/toolbar/toolbar.component.ts` | `step()` deleted; `uiConfig` public |
| `frontend/src/app/features/toolbar/toolbar.component.scss` | Spacing when under the guide; step-button styles, if any, removed |
| `frontend/src/app/features/toolbar/toolbar.component.spec.ts` | Tests: no step buttons; Play/Pause and speed absent with `control.playback` hidden, present without |
| `frontend/src/app/core/config/ui-config-items.ts` | `control.playback` in `CONTROL_IDS` |
| `frontend/public/ui-config.schema.json` | `control.playback` in the id enum |
| `frontend/src/app/core/layout/layout-presets.ts` | `control.playback` in `PLAN_B_UI.hidden` |
| `docs/experiment-logging.md` | Regenerated click-id table (no `toolbar.step`) |
| `docs/plans/configurable-ui-plan.md` | §5.2 excerpt of `PLAN_B_UI` |

Deliberately unchanged: `SessionStore.step/play/pause`, `simulation-slider`,
`tour-guide` (no projection slot), the `toolbar.step` translation key, the
trajectory compression, the scenario-refresh throttling and the
`_recoverPolicyAndRetry*` fallbacks.

## 6. Verification

- `npm run lint:styles`, `npm run i18n:check`, `npx ng build --configuration production`,
  the toolbar and ui-config specs; `pytest -q` is untouched by this change but run as CI does.
- In the running app (production build on :8000):
  - `plan-b-p01`: leg 1 starts on «Szenario starten» without Play; the toolbar
    row sits under the guide strip with only "Szenario abschliessen → …";
    the conflict holds trains and the run keeps going; the reason dialog
    resumes; leg 2 and the end screen are reached.
  - `colearning-experiment` (not Plan B): toolbar under the guide with
    Play/Pause and speed, no step buttons.
  - A free session without a guide: toolbar at the top, no step buttons.
- PR: a `### Requirements` table with one screenshot per requirement, taken on
  `plan-b-p01` (several scenarios), committed as
  `docs/plans/toolbar-under-guide/<N>-<slug>.png`.

## 7. Open questions

1. ~~**"in" or "unter"?**~~ Decided 2026-11-03: **under the guide box for
   now** (D5). Should it later have to sit *inside* the violet box,
   `app-tour-guide` gets a third row and the toolbar is projected into it — a
   larger change, and against the projection caveat in `app.component.html`.
2. ~~**Pause for the participant?**~~ Decided 2026-11-03: Plan B loses Pause
   too, as the issue says (D6).
3. ~~**Future conditions that hide playback and pause for decisions?**~~
   Decided 2026-11-03: excluded (§1.1).
