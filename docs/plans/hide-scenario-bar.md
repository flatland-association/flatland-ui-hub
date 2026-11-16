# Plan B without the guide strip and without scenario names (#198)

> **Status:** plan of 2026-11-16, draft. Based on `main` fd0c70cb (#164 merged). Issue
> [#198](https://github.com/flatland-association/flatland-ui-hub/issues/198) ("Szenario-Balken ausblenden", label
> `plan b`). Branch `feature/198-hide-scenario-bar`, off `main` (on request; contributors usually branch off
> `explore_db`), PR not opened yet. Q-1 to Q-4 decided 2026-11-16 (§9.2).
>
> **Why:** in the Plan B study the participant should see only where they are in the experiment, not which scenario
> comes next, and should work without the step-by-step guide strip. Finishing a scenario («Szenario abschliessen»)
> must stay possible.

## 1. Introduction and goals

*What the change is for: the requirements, the qualities that matter, who has a stake, and what it leaves out.*

### 1.1 Requirements overview (functional requirements)

*The issue's text and the numbered requirements the rest of the plan refers to.*

> - [ ] Experiment Balken: Szenarien-Namen entfernen (nur Ablauf)
> - [ ] Szenario Balken ausblenden, keep "Szenario abschliessen".

The issue's two screenshots sit one bullet off: under the first bullet is the guide strip ("Verschobene Kreuzung an
der Einspur (4/5) · Betrieb 1 Konflikt erkennen … Lernen 6 Reflexion"), under the second the experiment stepper
("Einführung · ↻ ×5 · Tutorial (1/5) · Türstörung (2/5) … Fragebogen · Ende · noch 1 Szenario"). This plan reads
"Experiment-Balken" as the stepper and "Szenario-Balken" as the guide strip, as the bullets' words say.

Requirements:

- **REQ-1** The experiment stepper ("Experiment-Balken", `app-experiment-progress`) shows the run's course (briefing,
  scenarios, questionnaire, end, how many scenarios are left) without the scenarios' names.
- **REQ-2** The guide strip ("Szenario-Balken", `app-tour-guide`) is not shown.
- **REQ-3** The participant can still finish a scenario: the toolbar's «Szenario abschliessen → …» button stays.
- **REQ-4** Only Plan B changes (label `plan b`); other experiments and tours keep both bars as they are (Q-1).
- **REQ-5** The finish button names the next scenario by its number only: «Szenario abschliessen → Szenario 2/5»
  (added by the maintainer on 2026-11-16, after the walk-through; Q-2 revisited).

The names stay in the footer and the intro card: only the stepper and the finish button lose them (Q-2).

### 1.2 Quality goals (non-functional requirements)

*The few qualities the design must reach, each with a concrete scenario.*

| ID | Priority | Quality goal | Scenario |
|---|---|---|---|
| NFR-1 | 1 | Study data stay comparable | A Plan B run logs the same ids, events and record fields as before (`legId`, guide ticks, `data-log` click ids); only what is drawn changes. |

### 1.3 Stakeholders

*Who asks for the change, decides on it, reviews it or works with the result, and what they expect.*

| Role | Name | Expectations |
|---|---|---|
| Study lead Plan B (FHNW & SBB), issue author | (issue author) | Participants see the course of the experiment in the stepper without scenario names, and no guide strip. |
| Participants | Plan B study | Can finish each scenario without the guide. |
| Maintainer | flatland-association | Small, configurable change; other conditions unchanged. |

### 1.4 Follow-ups (not in this PR)

*What this PR leaves out, why, and where it goes later.*

| Follow-up | Why not in this PR | From | Findings | Issue |
|---|---|---|---|---|
| Drop the names also from the footer and the intro card. | Decided out: only the stepper and the finish button (Q-2, revisited). | §2.1 | - | - |
| The scenario card of the intro (`scenarioCard`, the leg's own intro text) may name the scenario in its text. | Authored text, not the leg label; the study lead decides whether the cards change. | §2.1 | - | - |
| The hints of the Plan B guide (`PLAN_B_GUIDE_HINTS`) are no longer seen. | Requested by REQ-2; the strings stay for other uses (replay of older runs, a later decision to show the strip again). | §2.1 | - | - |

## 2. Constraints

*What limits the design from outside: platform, organisation and conventions.*

| ID | Constraint | Kind | Explanation |
|---|---|---|---|
| C-1 | Keep stored and logged ids | Convention | `AGENTS.md`: leg ids, `data-log` ids and UI-config ids must not change; the label is display only (`runContext()` records `legId`, not the label). |
| C-2 | No inline user-facing text | Convention | The unnamed label is a new key in `frontend/public/i18n/{en,de,fr}.json`; `npm run i18n:check` passes. |
| C-3 | UI restrictions of a condition travel with its layout | Technical | `UiConfigService.apply()` is called from `AppComponent.setRuntimeLayout()` with `LayoutPreset.ui` (`docs/plans/configurable-ui-plan.md` §4.1). |
| C-4 | The UI-config ids are listed in `ui-config.schema.json` | Technical | `ui-config-items.spec.ts` checks that the schema's `enum` matches `UI_CONFIG_ITEMS`. |

### 2.1 Limitations

*What the built code gets wrong or ignores, each with the TODO or issue that tracks it.*

- The footer ("Plan B · Teilnehmer:in 01 · Türstörung (4/5)") and the intro card still show the leg's name, by
  decision (Q-2, §1.4).
- The scenario card of a leg's intro is authored text and is left as it is; if it names the scenario, the name is
  still seen there (§1.4).
- Without the strip, the step hints and the closing hint ("Alle Schritte während der Fahrt sind abgeschlossen …")
  are not seen; the strip's «Reflexion öffnen» is gone, the decision log's «Reflexion nachtragen» stays (§4.4).

### 2.2 Assumptions

*What must hold for the design to be correct, but is not checked in code.*

Not checked in code; they hold by construction of `PLAN_B_UI` and `STUDY_CONDITIONS`.

- Every Plan B condition (`plan-b-p01` … `plan-b-p10`, and the test run `plan-b-uc2`) uses the layout
  `preset-plan-b`, so `PLAN_B_UI` reaches all of them and no other condition.
- A replay of a Plan B run applies the recorded layout's UI restrictions as a live run does; checked in S-2 (§4.2), a
  mismatch becomes a question.
- The `TourGuideService` keeps ticking the steps while the strip is hidden, so what it logs does not change (NFR-1).

## 3. Context and scope (checked 2026-11-16 on `main` fd0c70cb)

*The code on the base branch that the change works in, as it is before the change, and where the change stops.*

Context:

- **Stepper** `frontend/src/app/features/experiment-progress/`: shown for a run with more than one leg
  (`app.component.html:156`, `multiLeg()`). Each leg's box shows `ExperimentRunService.legLabel(i)` (live) or
  `ReplayService.legLabel(i)` (replay). While a leg runs and the guide is active, two lines join the current leg's box
  to the guide strip below (`connected()`, `measure()`).
- **Leg label** "⟨name⟩ (k/N)" (`experimentRun.legLabel`), built in three places from
  `TourContextService.legName(leg)`: `ExperimentRunService.legLabel()` (`experiment-run.service.ts:113`),
  `ReplayService` (`replay.service.ts:114` and `:149`). It is shown in the stepper, the guide strip's leg title,
  the toolbar's finish button («Szenario abschliessen → ⟨label⟩», `finishLabel`, `toLeg`), the footer
  (`app.component.html:1089`), the intro card (`mode-intro.component.html:7`) and the Schichtbilanz
  (`tour-debrief.component.ts:108`, not in Plan B, which has none).
- **Guide strip** `frontend/src/app/features/tour-guide/`: shown when `AppComponent.guideShown()` (guide active, and
  in a multi-leg run only while a leg runs). The toolbar moves under it (`toolbarUnderGuide()`, #167). Its buttons:
  «Reflexion öffnen» (`canReflect()`) and «Schicht beenden» (only with a Schichtbilanz, so never in Plan B).
- **«Szenario abschliessen»** is the toolbar's finish button (`toolbar.component.html:105-110`,
  `[finishLabel]="experimentRun.finishLabel()"`), not part of either bar.
- **UI restrictions:** `UiConfigService.isHidden(id)` with ids from `UI_CONFIG_ITEMS` (`ui-config-items.ts`), the
  schema `frontend/public/ui-config.schema.json`, and Plan B's block `PLAN_B_UI` in `layout-presets.ts:696`.

Before (`plan-b-p01`, de, scenario 4 running): the stepper, the guide strip joined to it by two lines, then the
toolbar with «Szenario abschliessen». Every stage of the run: §4.2.

![Stepper, guide strip and toolbar before](hide-scenario-bar/before-06c-bars.png)

Scope: the change gates what the stepper, the leg label and the guide strip draw. It does not change the run's
flow, the guide's ticking, the records or the logs.

## 4. Solution strategy

*The fundamental choices and why, the rules the design follows, how it is verified, and the design of each part.*

| Quality goal | Scenario | Solution approach | Details |
|---|---|---|---|
| NFR-1 | Same ids, events, records | Gate only the presentation, through the existing UI restrictions; the guide service, the leg ids, the leg label and the run phases are untouched. | §4.3, §4.4 |

### 4.1 Design principles

*The rules the design follows, each with its decision, the concepts it reuses instead of building new ones, and what
is not new on purpose.*

- **DP-1 What a condition removes from the screen is a UI restriction of its layout.** Two new `hidden` ids in
  `PLAN_B_UI`, not a `StudyCondition` field: the run's flow does not change, only what is drawn (Q-1).
- **DP-2 The course is shown by number, the shared leg label stays.** The name is dropped only where the run's course
  is shown: the stepper (`ExperimentProgressComponent`) and the finish button (`ExperimentRunService.finishLabel`).
  The shared leg label "⟨name⟩ (k/N)" and the other places that show it stay as they are (Q-2).
- **DP-3 Gate presentation, not behaviour.** The guide service keeps running and logging; only `app-tour-guide` and
  its connector lines are not drawn (NFR-1, `AGENTS.md` "Gate presentation in the frontend").

Reused concepts:

| Need | Reused concept | Instead of |
|---|---|---|
| Plan B turns a bar off | `UiConfig.hidden` + `UI_CONFIG_ITEMS` + `PLAN_B_UI` | A new `StudyCondition` flag (like `shiftSummary`) or a briefing flag |
| A label without the name | The existing `experimentRun.legLabel` pattern, as a sibling key | Hiding the stepper's leg boxes, or a gate in the shared leg label |
| A route to an open reflection without the strip | The decision log's «Reflexion nachtragen» (`reopenReflection()`) | A new button elsewhere |
| Finish a scenario | The toolbar's finish button (`finishLabel`) | A new button |

Not new on purpose: no new endpoint, record field, log event, setting or condition field; `TourGuideService`,
`ExperimentRunService`'s phases and `runContext()` stay as they are.

### 4.2 Verification

*How each requirement and quality goal is shown to work: tests, CI checks, before and after screenshots.*

Screenshots: Plan B `plan-b-p01` with `ui-configs/plan-b.json`, German, 1600×1000, production build served by the
backend; before on `main` fd0c70cb; proposal on the same build with the plan previewed in the page only (guide strip
and connector hidden, stepper legs "Szenario k/N", finish button «Szenario abschliessen → Szenario k/N», toolbar at
the top), all by
[`scripts/docshots-hide-scenario-bar.mjs`](../../scripts/docshots-hide-scenario-bar.mjs) (`before`, `proposal`).
After S-2 the same script takes `after` with `PREVIEW=0` on this branch, and the `after-*` files replace the
`proposal-*` ones in the table below.

| ID | Requirement | Test or check | Result | Screenshots |
|---|---|---|---|---|
| REQ-1 | Stepper without names | `experiment-progress.component.spec.ts`: with `control.legNames` hidden the legs read "Szenario k/N", live and in a replay | 💡 | 03c–07c below |
| REQ-2 | Guide strip hidden | `app.component.spec.ts`: with `control.guide` hidden no `app-tour-guide`; `experiment-progress.component.spec.ts`: no connector | 💡 | 03b–07b below |
| REQ-3 | «Szenario abschliessen» stays | Running app: the toolbar shows «Szenario abschliessen → …» and leads to the next scenario | 💡 | 03c–07c below |
| REQ-5 | Finish button by number | `experiment-run.service.spec.ts`: with `control.legNames` hidden `finishLabel` reads «Szenario abschliessen → Szenario k/N»; the last leg's «→ Fragebogen» unchanged | 💡 | 03c–07c below |
| REQ-4 | Only Plan B | `study-conditions.spec.ts` or `layout-presets` spec: only `preset-plan-b` hides the two ids; other conditions' specs unchanged | 💡 | - |
| NFR-1 | Same study data | Existing logging specs green; guide ticks still logged with the strip hidden (spec) | 💡 | - |

Walk-through of every Plan B stage (scenario order of `plan-b-p01`): before
[`before-walkthrough.gif`](hide-scenario-bar/before-walkthrough.gif), proposal
[`proposal-walkthrough.gif`](hide-scenario-bar/proposal-walkthrough.gif) (full screens, 1.8 s per stage).

| Stage | What | Before | Proposal |
|---|---|---|---|
| 01 | Start screen (unchanged) | [before](hide-scenario-bar/before-01-picker.png) | [proposal](hide-scenario-bar/proposal-01-picker.png) |
| 02 | Briefing (unchanged) | [before](hide-scenario-bar/before-02-briefing.png) | [proposal](hide-scenario-bar/proposal-02-briefing.png) |
| 03a | Scenario 1/5 (Tutorial): intro card (unchanged, Q-2) | [before](hide-scenario-bar/before-03a-intro.png) | [proposal](hide-scenario-bar/proposal-03a-intro.png) |
| 03b | Scenario 1/5: working screen | [before](hide-scenario-bar/before-03b-running.png) | [proposal](hide-scenario-bar/proposal-03b-running.png) |
| 03c | Scenario 1/5: the bars above the map | [before](hide-scenario-bar/before-03c-bars.png) | [proposal](hide-scenario-bar/proposal-03c-bars.png) |
| 04a | Scenario 2/5 (Verschobene Kreuzung an der Einspur): intro card (unchanged, Q-2) | [before](hide-scenario-bar/before-04a-intro.png) | [proposal](hide-scenario-bar/proposal-04a-intro.png) |
| 04b | Scenario 2/5: working screen | [before](hide-scenario-bar/before-04b-running.png) | [proposal](hide-scenario-bar/proposal-04b-running.png) |
| 04c | Scenario 2/5: the bars above the map | [before](hide-scenario-bar/before-04c-bars.png) | [proposal](hide-scenario-bar/proposal-04c-bars.png) |
| 05a | Scenario 3/5 (Mühlehorn - Tiefenwinkel): intro card (unchanged, Q-2) | [before](hide-scenario-bar/before-05a-intro.png) | [proposal](hide-scenario-bar/proposal-05a-intro.png) |
| 05b | Scenario 3/5: working screen | [before](hide-scenario-bar/before-05b-running.png) | [proposal](hide-scenario-bar/proposal-05b-running.png) |
| 05c | Scenario 3/5: the bars above the map | [before](hide-scenario-bar/before-05c-bars.png) | [proposal](hide-scenario-bar/proposal-05c-bars.png) |
| 06a | Scenario 4/5 (Türstörung): intro card (unchanged, Q-2) | [before](hide-scenario-bar/before-06a-intro.png) | [proposal](hide-scenario-bar/proposal-06a-intro.png) |
| 06b | Scenario 4/5: working screen | [before](hide-scenario-bar/before-06b-running.png) | [proposal](hide-scenario-bar/proposal-06b-running.png) |
| 06c | Scenario 4/5: the bars above the map | [before](hide-scenario-bar/before-06c-bars.png) | [proposal](hide-scenario-bar/proposal-06c-bars.png) |
| 07a | Scenario 5/5 (Blockierte Fahrbahn): intro card (unchanged, Q-2) | [before](hide-scenario-bar/before-07a-intro.png) | [proposal](hide-scenario-bar/proposal-07a-intro.png) |
| 07b | Scenario 5/5: working screen | [before](hide-scenario-bar/before-07b-running.png) | [proposal](hide-scenario-bar/proposal-07b-running.png) |
| 07c | Scenario 5/5: the bars above the map | [before](hide-scenario-bar/before-07c-bars.png) | [proposal](hide-scenario-bar/proposal-07c-bars.png) |
| 08 | Final questionnaire (unchanged) | [before](hide-scenario-bar/before-08-final-survey.png) | [proposal](hide-scenario-bar/proposal-08-final-survey.png) |
| 09 | End (unchanged) | [before](hide-scenario-bar/before-09-end.png) | [proposal](hide-scenario-bar/proposal-09-end.png) |

Scenario 4 (`06c`), before and proposal:

![Bars before](hide-scenario-bar/before-06c-bars.png)
![Bars proposal](hide-scenario-bar/proposal-06c-bars.png)

Read from the page (proposal):

| Where | Before | Proposal |
|---|---|---|
| Stepper, scenario 4 running | ✓ Tutorial (1/5) · ✓ Verschobene Kreuzung an der Einspur (2/5) · ✓ Mühlehorn - Tiefenwinkel (3/5) · **Türstörung (4/5)** · Blockierte Fahrbahn (5/5) | ✓ Szenario 1/5 · ✓ Szenario 2/5 · ✓ Szenario 3/5 · **Szenario 4/5** · Szenario 5/5 |
| Guide strip | shown, under the stepper | hidden |
| Finish button, scenario 4 | «Szenario abschliessen → Blockierte Fahrbahn (5/5)» | «Szenario abschliessen → Szenario 5/5» |
| Finish button, scenario 5 | «Szenario abschliessen → Fragebogen» | the same |
| Intro card, footer | "Türstörung (4/5)" | the same (Q-2) |

### 4.3 Scenario names in the stepper and the finish button (REQ-1, REQ-5; Q-2, Q-3)

- New UI-config id `control.legNames` ("Scenario names in the experiment stepper and the finish button; numbered
  only"). The footer and the intro card are not covered (§1.4); extending the id to them later would change what a
  stored `ui-config.json` hides, so that gets an id of its own (C-1).
- New i18n key `experimentRun.legUnnamed` ("Szenario {{k}}/{{n}}", en "Scenario {{k}}/{{n}}", fr
  "Scénario {{k}}/{{n}}", Q-3), the sibling of `experimentRun.legLabel`. With the id hidden it is used at two gate
  points:
  - `ExperimentProgressComponent.legs()`: each leg's box, for live runs and replays alike; else `run.legLabel(i)` /
    `replay.legLabel(i)` as today. The component gets `UiConfigService` and `LanguageService` injected.
  - `ExperimentRunService.finishLabel`, case `toLeg`: «Szenario abschliessen → Szenario k/N» for the next leg; the
    other cases («→ Fragebogen») are unchanged. The service gets `UiConfigService` injected (no cycle:
    `UiConfigService` depends only on `HttpClient` and `ui-config-items`).

### 4.4 Guide strip (REQ-2, REQ-3; Q-4)

- New UI-config id `control.guide` ("Guide strip: steps and hints of the running scenario").
- `AppComponent.guideShown()` adds `&& !uiConfig.isHidden('control.guide')`; with it `toolbarUnderGuide()` is false
  and the toolbar stays at the top, where it is in a run without a guide (Q-4).
- `ExperimentProgressComponent.connected()` adds the same check, so no connector lines point at a missing strip.
- The toolbar's finish button stays (REQ-3); only its text changes (§4.3). «Schicht beenden» is not shown in Plan B anyway (no
  Schichtbilanz). «Reflexion öffnen» goes with the strip; the decision log's «Reflexion nachtragen» stays the route
  (Plan B does not hide the decision log, `PLAN_B_UI`'s comment).

## 5. Building block view

*The components the change adds or changes: an overview, why the system is split this way, what each is responsible
for, the important interfaces, and the planned data model.*

### 5.1 Plan B working screen

*One white box: its building blocks, why it is split this way, and the interfaces between them.*

```mermaid
flowchart TD
  PLANB["PLAN_B_UI (layout preset ui block) 🟨"] --> UIC["UiConfigService ⬜"]
  UIC --> APP["AppComponent (guideShown) 🟨"]
  UIC --> XP["ExperimentProgressComponent (stepper) 🟨"]
  UIC --> RUN["ExperimentRunService (finishLabel) 🟨"]
  RUN --> XP
  REP["ReplayService (leg label) ⬜"] --> XP
  REP --> XP
  RUN --> TB["Toolbar finish button ⬜"]
  APP --> TG["TourGuideComponent (guide strip) ⬜"]
```

Notation: [flowchart in Mermaid](https://mermaid.js.org/syntax/flowchart.html); 🟩 added, 🟨 modified, ⬜ unchanged;
an arrow reads "is used by".

**Motivation:** the restriction is declared once, on the layout (DP-1); the stepper and the finish button drop the
names, the shared leg label stays (DP-2); the strip itself stays as it is and is just not placed (DP-3).

**Contained building blocks:**

| Component | Responsibility | Change |
|---|---|---|
| `PLAN_B_UI` | What the Plan B study removes from the screen. Not the run's flow (that is the `StudyCondition`). | 🟨 modified: Plan B participants see no guide strip and no scenario names. |
| `UI_CONFIG_ITEMS` / `ui-config.schema.json` | The ids a layout or deployment may hide. Not where they are applied. | 🟨 modified: two new ids, `control.guide` and `control.legNames`. |
| `AppComponent` | Places the working screen's bars. Not what they show. | 🟨 modified: leaves the guide strip out where it is hidden. |
| `ExperimentProgressComponent` | The stepper of a multi-leg run. Not the steps inside a leg. | 🟨 modified: numbers the scenarios ("Szenario 2/5") where names are hidden, and draws no lines to a hidden guide strip. |
| `ExperimentRunService` | The run's legs and phases, the leg label "⟨name⟩ (k/N)" and what the finish button says. Not the stepper. | 🟨 modified: the finish button names the next scenario by number where names are hidden. |
| `ReplayService` | The recorded run's legs and phases, and their labels. | ⬜ unchanged |
| `TourGuideComponent` | The steps and hints of the running leg. | ⬜ unchanged |
| Toolbar finish button | Finishes the scenario; shows `finishLabel`. | ⬜ unchanged |

## 8. Crosscutting concepts

*What the change introduces that other code will follow, and what it changes for existing callers.*

### 8.1 New patterns

*What is new compared with the base branch.*

Compared with `main` fd0c70cb. What is reused, and what is not new on purpose, is in §4.1.

| ID | New | Defined in |
|---|---|---|
| PAT-1 | A UI-config id that changes a text instead of removing an element (`control.legNames`: the label loses its name, the box stays). | §4.3, Q-2 |

### 8.2 Breaking changes

*What breaks for whom, and the migration path.*

None for callers: no signature changes, and without the new ids nothing is drawn differently. A `ui-config.json` that lists the new ids needs this version (the schema rejects unknown
ids before).

## 9. Decisions

*The decisions behind the plan: the questions still open, the decisions taken, and how each review finding was settled.*

### 9.1 Open questions

*Choices not made yet, each with its options and a proposal.*

All decided 2026-11-16 by the maintainer; the options stay for the record.

~~**(Q-1) Where does the change apply?**~~ **Decided 2026-11-16:** a), Plan B only.
- a) Plan B only, through `PLAN_B_UI` (the ten participant conditions and the test run `plan-b-uc2`); other
  experiments and tours unchanged.
- b) Every guided condition with several legs (a `StudyCondition` field or a code default).
- c) Everywhere, the guide strip removed for good.

*Proposal:* a): the issue is labelled `plan b`, and `PLAN_B_UI` is where Plan B's other removals already live (#145,
#167, #168).

~~**(Q-2) Where are the scenario names dropped?**~~ **Decided 2026-11-16:** b), only in the stepper. **Revisited
2026-11-16** after the walk-through: the stepper and the finish button («Szenario abschliessen → Szenario 2/5», REQ-5);
the footer and the intro card keep the name.
- a) Everywhere the leg label "⟨name⟩ (k/N)" shows: stepper, finish button («Szenario abschliessen → Szenario 3/5»),
  footer, intro card (and the hidden strip's title).
- b) Only in the stepper, as the issue's first bullet says; the finish button still names the next scenario
  («Szenario abschliessen → Blockierte Fahrbahn (3/5)»).

*Proposal:* a): with b) the next scenario's name is still one click away on the button, which defeats "nur Ablauf".

~~**(Q-3) What does a leg without its name read?**~~ **Decided 2026-11-16:** a), "Szenario 2/5".
- a) "Szenario 2/5" (en "Scenario 2/5", fr "Scénario 2/5"), the tutorial included.
- b) Only "2/5".
- c) The tutorial keeps its name ("Tutorial (1/5)"), the others read "Szenario k/N".

*Proposal:* a): reads well in the finish button and the footer; c) needs a per-leg flag for one leg.

~~**(Q-4) Where does the toolbar go without the guide strip?**~~ **Decided 2026-11-16:** a), at the top.
- a) At the top, above the stepper, as in a run without a guide (no code).
- b) Under the stepper, where it sits under the strip today (#167).

*Proposal:* a) for this PR; check in the running app (S-2) and switch to b) if the stepper then reads detached from
the map.

### 9.2 Decision log

*Every decision by date, with why it was taken and what follows from it.*

| Date | Decision | Why | Consequences |
|---|---|---|---|
| 2026-11-16 | ✅ Branch off `main`, not `explore_db`. | Asked for with the plan. | The PR targets `main`. |
| 2026-11-16 | ✅ Plan B only, through `PLAN_B_UI` (Q-1, §4.1). | The issue is labelled `plan b`; Plan B's other removals live there (#145, #167, #168). Not a `StudyCondition` field: the flow doesn't change. | Two new UI-config ids; other conditions unchanged (REQ-4). |
| 2026-11-16 | ~~✅ Names dropped in the stepper only (Q-2, §4.3).~~ Replaced by the decision below of the same day. | As the issue's bullet says. | - |
| 2026-11-16 | ✅ "Szenario 2/5", the tutorial included (Q-3, §4.3). | Reads as a course step; "2/5" alone is terse, a named tutorial needs a per-leg flag. | One new i18n key in en, de, fr. |
| 2026-11-16 | ✅ Toolbar at the top without the strip (Q-4, §4.4). | Where it is in any run without a guide; no code. | Checked in the running app in S-2. |
| 2026-11-16 | ✅ (Q-2) revisited: names dropped in the stepper and the finish button (REQ-5, §4.3). | The walk-through showed «Szenario abschliessen → Blockierte Fahrbahn (5/5)» naming the next scenario, which the stepper no longer does. The footer and the intro card were not asked for. | One id covers both (`control.legNames`); a second gate point in `ExperimentRunService.finishLabel`; footer and intro card stay a follow-up (§1.4). |

### 9.3 Code Review Findings

*Findings from code reviews, PR comments and TODOs, with their status and the commits that fix them.*

None yet.

| Fixed | ID | Source | Category | Severity | Finding | Commit message |
|---|---|---|---|---|---|---|

## 10. Glossary

*The domain and technical words the plan uses, with their code symbols.*

- **Experiment-Balken, stepper** (`app-experiment-progress`, `ExperimentProgressComponent`): the course of a guided
  run with several legs. Not the guide strip.
- **Szenario-Balken, guide strip** (`app-tour-guide`, `TourGuideComponent`, `TourBriefing.guide`): the numbered
  steps and the hint of the running leg. Not the toolbar.
- **Leg, Szenario** (`ExperimentLeg`): one scenario of a guided condition; logged by its `id`, shown by its label
  "⟨name⟩ (k/N)" (`experimentRun.legLabel`).
- **Leg name** (`TourContextService.legName()`): the leg's `nameKey` text, else the scenario's title. Not its id.
- **UI restriction** (`UiConfig.hidden`, `UiConfigService.isHidden()`): an id a layout or deployment removes from the
  screen. Not a setting the participant changes.
- **«Szenario abschliessen»** (`ExperimentRunService.finishLabel`, toolbar finish button): ends the running leg.

## 11. Execution plan and status

*The commits that build the change, in order, and which of them are done: the source of the PR's status.*

### 11.1 Steps

*One row per commit: what it does, the findings it fixes, its message, and its SHAs once committed.*

| ID | Findings | Step | Category | Severity | Commit message | Commit(s) | Needs | Blocked by |
|---|---|---|---|---|---|---|---|---|
| 💡 S-0 | - | This plan, with before and proposal screenshots and the walk-through script | docs | low | docs(plans): plan for #198, Plan B without the guide strip and the scenario names. |  | - | - |
| 💡 S-1 | - | `control.legNames`: id, schema, `ExperimentProgressComponent.legs()`, `ExperimentRunService.finishLabel`, i18n key (en, de, fr), `PLAN_B_UI`, README, specs (§4.3) | feature | medium | feat(experiment-run): let a condition number its scenarios in the stepper and the finish button, without their names. |  | S-0 | - |
| 💡 S-2 | - | `control.guide`: id, schema, `guideShown()`, `connected()`, `PLAN_B_UI`, README, specs; check the replay (§2.2) and the toolbar's place (Q-4) | feature | medium | feat(tour-guide): let a condition hide the guide strip and keep «Szenario abschliessen». |  | S-0 | - |
| 💡 S-3 | - | After screenshots (`PREVIEW=0`) in place of the proposal ones, and results in §4.2 | docs | low | docs(plans): screenshots of Plan B without the guide strip and the scenario names for #198. |  | S-1, S-2 | - |

## 12. Change inventory

*Every file the change adds, modifies, renames or removes, and what stays unchanged on purpose.*

### 12.1 New files

*The files the change adds, and what each adds.*

| File | Adds |
|---|---|
| `docs/plans/hide-scenario-bar.md` | This plan. |
| `docs/plans/hide-scenario-bar/*.png`, `*.gif` | Before, proposal and after screenshots and walk-throughs of every Plan B stage (§4.2). |
| `scripts/docshots-hide-scenario-bar.mjs` | The walk-through: every stage of `plan-b-p01`, `before`, `proposal` (CSS preview) or `after`. |

### 12.2 Modified files

*The files the change modifies, and what changes in each.*

| File | Changes |
|---|---|
| `frontend/src/app/core/config/ui-config-items.ts` | `CONTROL_IDS`: `control.guide`, `control.legNames`. |
| `frontend/public/ui-config.schema.json` | The two ids in `hidden`'s `enum`. |
| `frontend/src/app/core/layout/layout-presets.ts` | `PLAN_B_UI.hidden`: the two ids, with the issue. |
| `frontend/src/app/app.component.ts` | `guideShown()` checks `control.guide`. |
| `frontend/src/app/core/demo/experiment-run.service.ts` | `finishLabel` (`toLeg`) names the next leg by number where `control.legNames` is hidden; injects `UiConfigService`. |
| `frontend/src/app/features/experiment-progress/experiment-progress.component.ts` | `legs()` numbers the legs where `control.legNames` is hidden; `connected()` checks `control.guide`. |
| `frontend/public/i18n/{en,de,fr}.json` | `experimentRun.legUnnamed`. |
| `README.md` | The Plan B list of what is hidden: the two new ids (and drop "starts the Decision Log collapsed", which `PLAN_B_UI` no longer does). |
| `experiment-progress.component.spec.ts`, `experiment-run.service.spec.ts`, `app.component.spec.ts`, `study-conditions.spec.ts` | The checks of §4.2. |

Unchanged on purpose: `TourGuideComponent`, `TourGuideService`, the leg label (`ExperimentRunService.legLabel()`, `ExperimentRunService.currentLegLabel`,
`ReplayService.legLabel()`, `TourContextService.legName()`), the toolbar, `StudyCondition`, records, logs, the
backend.
