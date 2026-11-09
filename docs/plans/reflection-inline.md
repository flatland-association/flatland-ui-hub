# Reflection in the decision log, without pausing the run (#160)

> **Status:** plan, 2026-11-05. S1-S5 and S7 are committed as one commit,
> f977f7c, S6 as 1221529; findings 1, 2, 4 and 13-17 are fixed. S8-S11 (findings
> 21, 12 with 10, 20 and 3) are fixed in 37659fd, d1e8adc, cadade1 and c491fb6; the PR
> comments 23 and 24 in S12 and S13, b484221 and a16424e (Q12; Q1 revisited:
> Plan B's log starts open, D4); 5-9, 11, 18 and 22 in S14-S20, 1e6151b to
> ba64e47 (§7.1). 19 is a follow-up (§9).
> Based on `main` 7eef0cb (rebased on 2026-11-06 from 1e33088,
> where the before pictures were taken), which has #150 ([PR #172](https://github.com/flatland-association/flatland-ui-hub/pull/172)):
> its decision log toggle covers what this plan first designed for opening
> the log (D4).
> Q1-Q5 decided 2026-11-05. Requirement 8 (a tour can still ask for the
> pause) added on 2026-11-06 by the maintainer, Q6-Q8 on it decided the same
> day. Q9 (with Q9 revisited), Q10 and Q11 decided 2026-11-06; Q12 and Q1
> revisited on 2026-11-07. Requirements 9-11 (the reflection moves from
> «Handlungsvergleich» into the decision log, renamed «Entscheidungsprotokoll
> und Reflexion», in the right column) added on 2026-11-09 by the maintainer,
> Q13 on them decided the same day (D20-D22; Q13 revisited), built in
> 044bd0b (S22, S23) with the pictures in S24. Requirements 12-16 (the
> decision panel back above the log, renamed «Handlungsoptionen», closed after
> a choice, and the decided options shown again in the reflection) added on
> 2026-11-09 by the maintainer, with Q14 and Q15 decided the same day,
> planned as S25-S28; no open questions (§8).
> Issue [#160](https://github.com/flatland-association/flatland-ui-hub/issues/160)
> ("Reflexions Overlay soll Szenario nicht pausieren", @CleverManu), with the
> requirements as edited on 2026-11-05 ("Beschreibung oben angepasst"). Branch
> `feature/160-reflection-non-blocking`, off `main`, like #167 and #168.
> Not only for Plan B: the issue asks for it in general, so the change applies
> to every tour that asks for a reason (`TourBriefing.reasonDialog`).
>
> **Why:** the reflection dialog stops the simulation, so a participant who
> reflects carefully is given extra time to think about the situation, and the
> run they see is not the run the clock would have played. In the decision log, below
> the decision panel, the reflection is part of the work instead of an
> interruption (requirement 10). It may then be answered later, so the scenario can only be
> finished once every decision has its reflection.

### Status

#### Carried out

| ID | Description | Category | Severity | Commit(s) |
|---|---|---|---|---|
| S0 | Plan for #160, with before screenshots of the reflection dialog, the decision panel, the decision log, the guide and the finish button on Plan B, and the screenshot script | docs | — | 211e75b |
| — | Align the plan with #150, now in `main`: the decision log can already be opened when it starts collapsed, so D4, §2 and the header part of §4.3 are stale | docs | low | acd472e |
| 14, 15 | Record the decisions: «Nein» counts as a reflection, every tour that asks for reasons is gated (the interview tour included), the log gets «Offene Reflexionen anzeigen», and the remaining decisions are confirmed with their reasons | docs | low | de9d762 |
| S1-S5, S7, 1, 2, 4, 13, 16, 17 | The reflection in «Handlungsvergleich» without pausing the run: the store keeps every open reflection and stamps when one is answered; the decision panel shows it at the top and the pausing dialog is gone; the decision log marks, counts and reopens open reflections; finishing is refused while any is open, with a message; a tour can still opt into pausing (none does) | feat | high | f977f7c |
| S6 | After screenshots, the pause tables and the pause design, and the findings brought up to date | docs | low | 1221529 |
| — | Record where a reflection shows and how its consumers react: the setups, how many places show a reflection in each, pictures of every place with their script | docs | low | ff69ec8 |
| — | Decide where a reflection is asked when a layout has several places or none, and how a waiting reflection is logged; plan S8-S11 | docs | low | aeb90c2 |
| S8, 21 | The short "why?" starts empty for a new decision instead of keeping the previous decision's reasons | fix | medium | 37659fd |
| S9, 10, 12 | The short "why?" and its hypothesis name the course actually taken, through one lookup shared with the reflection prompt and the record | fix | medium | d1e8adc |
| S10, 20 | Ask a "why?" only where the layout has a place to show it, collapsed or not; elsewhere (Recommendation study 3, the ZWL tours) the decision is logged without a reason | fix | medium | cadade1 |
| S11, 3 | A waiting reflection is logged as a detail of the working screen, in every mode, not as a screen of its own; clicks meanwhile keep the working screen as their view | fix | medium | c491fb6 |
| — | Record S8-S11 as built, and retake the two pictures of the short "why?" in Co-Learning study 3 with the fixed label | docs | low | 2c874f4 |
| — | Point the plan at the commits rebased on `main` 7eef0cb | docs | low | 036fb53 |
| — | The pictures script of the reflection places selects the time-distance diagram by its new element name, renamed in #173 | fix | low | d27a2f2 |
| — | Retake the Plan B pictures with the finish button and the stepper: since #174 its first scenario reads «Szenario abschliessen → Walensee Folgezug (2/2)» instead of «→ Fragebogen» | docs | low | fe65e1a |
| — | Retake the Q11 picture on Plan B with its stepper and finish button after #174; the recording below it stays the one from before S11 | docs | low | a4b1d09 |
| — | Plan S12 for the reflection's questions (Q12, D18) | docs | low | 8938c4e |
| — | Revise D4 by the PR comment of 2026-11-06 (Q1 revisited) and plan S13 | docs | low | ce89d54 |
| S12, 23 | The reflection shows all its questions, in every tour that asks for reasons; «Weitere Fragen» goes | fix | medium | b484221 |
| S13, 24 | Plan B's decision log starts open, as in every other setup already | feat | medium | a16424e |
| — | Plan S14-S20 for the open code review findings | docs | low | f4b89f7 |
| S14, 5 | The message after a refused finish counts the missing reflections down as they are answered | bug | medium | 1e6151b |
| S15, 9 | A new reflection scrolls only its panel, not the whole right column | robustness | low | b7fcacf |
| S16, 22 | The working screen logs which centre tab is shown, so ZWL and Streckenspiegel differ | robustness | low | c231013 |
| S17, 7, 11 | One check of open reflections before finishing, a spec for the toolbar's finish gate, and one tour stub for the specs | design | low | 215055b |
| S18, 6 | A spec that every tour asking for reasons runs a layout with the decision panel | test-coverage | low | c566b8f |
| S19, 8 | The code names the reopen case that drops typed text | docs | low | 6aed56c |
| S20, 18 | Code comments point at the plan's sections and decisions, not at the issue or its findings | docs | low | ba64e47 |
| — | Retake the after pictures with all questions and Plan B's log open, and record S14-S20 as built | docs | low | 473e9e8, 1d207f7 |
| S21, 25 | The plan, the logging doc and the code this PR adds say ZWL, not Zug-Weg; the logged view type `zug-weg-diagramm` stays and is named as the ZWL's (#173, D19) | docs | low | 6cb438b |
| — | Record D19 and the check against #173's kept ids | docs | low | 692e4c7 |
| — | Plan S22-S24 for requirements 9-11 (Q13), resolve findings 25 and 26, record 27 | docs | low | 3d18bcc |
| S22, S23 | The reflection is asked in «Entscheidungsprotokoll und Reflexion», below its entries, not in «Handlungsvergleich»; the log moves to the right column, above «Handlungsvergleich» (Q13 revisited) | feat | medium | 044bd0b |
| S24 | Retake the after pictures with the reflection in the decision log, record Q13 revisited and the results | docs | low | the commit that adds this row |

S1-S5 and S7 share files and hunks, so they went in as one commit, f977f7c,
with the message "feat(reflection): ask the reflection in «Handlungsvergleich»
without pausing the run." The planned messages were: S1 "feat(reflection): keep
every open reflection, not one.", S2 "feat(decision-log): mark open reflections
and let them be filled in later.", S3 "feat(proposal-compare): ask the
reflection in the decision panel without pausing the run.", S4
"feat(experiment): finish a scenario only once every decision has its
reflection.", S5 "feat(i18n): rename the decision panel to
«Handlungsvergleich».", S7 "feat(tour): let a tour pause the run while a
reflection is shown."

#### Remaining

S25-S28 are open (requirements 12-16); the follow-ups are not in this PR (§1.3).

| ID | Description | Category | Severity | Commit message |
|---|---|---|---|---|
| S25 | «Handlungsvergleich» is renamed «Handlungsoptionen» (de, en, fr) | feat | low | feat(i18n): rename «Handlungsvergleich» to «Handlungsoptionen». |
| S26 | «Handlungsoptionen» above the log again; it closes after a course is taken and opens for the next choice | feat | medium | feat(proposal-compare): close «Handlungsoptionen» after a choice and open it for the next one. |
| S27 | The reflection shows the decided options (train, PLAN / KI / MENSCH, comparison) read-only, marked as decided | feat | medium | feat(reflection): show the decided options above the reflection's questions. |
| S28 | Retake the after pictures; this plan's results | docs | low | docs(plans): retake the after pictures with the decided options in the reflection. |
| — | Follow-up: keep a typed but unsent reflection when switching to another one | feat | low | — |
| — | Follow-up: require a reason chip for «Nein» too (decided against for now) | feat | low | — |
| — | Follow-up: show open reflections in a replay | feat | low | — |
| — | Follow-up: the other Plan B items of the decision log ([#150](https://github.com/flatland-association/flatland-ui-hub/issues/150)) | feat | low | — |
| 19 | Follow-up: an order between the places that show a reflection, or one place per mode in hand-built layouts | design | low | — |
| — | Follow-up: a native review of the French title and texts | i18n | low | — |
| 26 | Follow-up: a fixed order of the reflection's questions ([#182](https://github.com/flatland-association/flatland-ui-hub/issues/182)) | design | low | — |
| 27 | Follow-up: open a past decision from the log and look at it again | feat | low | — |

### Design principles

- The run does not wait for a reflection; the participant answers it while
  the run goes on, now or later (requirement 1, D2). A tour can ask for the
  old pause with its own flag, off by default (requirement 8, D14).
- The store owns which decisions still need a reflection; panels only show
  that state and call the store (D3). The tour decides whether reflections
  are required (`reasonDialog`), so the store does not read the tour (§4.4).
- One rule for every `reasonDialog` tour, experiment run or not (Q4, D13).
- In a tour that asks for reasons, a reflection being typed is never replaced
  by a newer decision; the newer one waits (D3). Elsewhere a newer decision
  replaces the shown one, as on `main` (finding 4).
- The participant keeps control of the layout: nothing expands or moves a
  panel on its own (Q3, D10). One exception, by requirement 14: the decision
  panel closes once a course is taken and opens when the next choice is due
  (Q3 revisited, D25), as the guide already opens the panel it points at.
- The reflection is answered where the decisions are listed: in the decision
  log, one at a time, below its entries (D20). The log sits in the right
  column, where the layouts put what is acted on; the left column is for
  reading only (zone rule, `docs/plans/mode-layouts-three-zones.md`; D21).
  The move changes the two reason-tour layouts' columns, not `PLAN_B_UI`.
- Plan B removes things through `PLAN_B_UI`; this plan adds nothing to it and
  removes one item: the log no longer starts collapsed (Q1 revisited, D4).
  It keeps #150's toggle; this plan adds the open count next to it.

Reused concepts:

| Need | Reused concept | Instead of |
|---|---|---|
| The reflection's questions | `ReflectionPromptComponent`, unchanged in its questions (S12 shows all of them, Q12 a) | a new inline form |
| Where the reflection is answered | the decision log's entries and «Reflexion nachtragen» (§4.3), and S15's `scrollIntoPanel`, moved with the reflection (S22) | a reflection panel of its own, or keeping it in «Handlungsvergleich» |
| Closing and opening the decision panel | the panel shell's own open state (`PanelShellComponent.expanded`, which the guide already sets and the UI-state log records), reached through an injection token | a store flag the shell watches, or `LayoutStoreService.setCollapsed`, which the shell does not follow at runtime |
| The decided options in the reflection | `ProposalCompareComponent` itself, read-only, fed with a copy of its result taken when the course was applied | a second component drawing the same cards and bars, or simulating again (the run has moved on) |
| The "decided" look | the existing tokens `--app-surface-muted` and `--app-border` | a new colour |
| The log's new title | the existing key `panels.decisionLog`, new wording only (S23) | a new key, which would change the click id |
| Which decision a reflection belongs to | `PendingRationale.decisionSeq` = `DecisionLogEntry.seq` | a new reflection id |
| Showing that a reflection is missing | the toolbar's `role="alert"` pattern of `store.runError()` | a toast or a new notification type |
| Opening the log's entries under Plan B | #150's toggle in the log's head, "Einträge anzeigen (n)" / "Einträge ausblenden" (`log.showEntries` / `log.hideEntries`) | a toggle of our own in the head |
| Recording that the log was opened | the existing `ui_state` key `panel.decision-log.collapsed` (`UiStateRegistry`) | a new interaction event |
| Recording when a reflection was answered | optional fields on `DecisionLogEntry`, which `mergeDecisions` carries into the session record as they are | a new event type |
| Which tours require reflections | the existing `TourBriefing.reasonDialog` flag | a new flag or a UiConfig id |
| Which tours pause for a reflection | a `TourBriefing` flag next to `reasonDialog`, read by `AppComponent` as it reads `reasonDialog` for `queueReflections` | a UiConfig id (deployment-wide, not per tour), or a Settings switch like `autoPauseOnConflict` (per browser, not set by a tour) |
| Pausing and resuming for a reflection | the removed dialog's effect: pause on show, resume on close only if it was playing and the shift review is not open | a new pause rule |
| Telling every consumer that a reflection waits | the `SessionStore` signals, read by every consumer (§9, "Findings 19-21") | an `AppEvent` on `EventBusService` |
| Which panels show a reflection in a condition | the condition's layout, chosen by the study designer (D15) | an order between places at runtime |

### Terms

- **Reflection:** the "Warum diese Entscheidung?" questions after a decision
  (`ReflectionPromptComponent`, `features/reflection-prompt/`): reason chips,
  up to three guided questions, and the preference hypothesis with "Ja, als
  Regel / Nur diesmal / Nein". It is not `app-rationale-capture`, the
  shorter "why?" that the Recommendation panel and the Co-Learning reflection
  panel show (S8 and S9 fix two bugs in it). All places that show a
  reflection: §9, finding 3.
- **Reflection dialog:** `TourReasonDialogComponent`
  (`features/tour-reason-dialog/`), the modal over the whole screen that held
  the reflection on `main` when the tour set `reasonDialog`. Removed in S3.
- **Decision panel:** the `proposal-compare` panel (`ProposalCompareComponent`),
  titled «Handlungsvergleich» since S5 («Plan / KI / Mensch» on `main`). It is
  where a Plan B participant decides. It showed the reflection from S3 until
  S22 (D20). Titled «Handlungsoptionen» from S25 (D24).
- **Decided options:** what the decision panel showed for a decision when its
  course was taken (train, the courses PLAN, KI and MENSCH, the comparison),
  kept per decision (`ProposalSnapshot`) and shown read-only in its
  reflection (S27, D26). Not a new simulation, and not part of the record.
- **Decision log:** the `decision-log` panel (`DecisionLogPanelComponent`),
  titled «Entscheidungsprotokoll und Reflexion» since S23
  («Entscheidungsprotokoll» before, D22). In a reason tour it is also where
  the reflection is answered (S22, D20). Not the session record's decision
  list (`DecisionLogEntry`), which it shows.
- **Open reflection:** a decision that asked for a reflection and has none
  yet (`SessionStore.openReflections`). On `main` the store kept at most two
  (the shown one and one closed unanswered); in reason tours it now keeps all
  of them (D3).
- **Place:** a part of the screen that can show a reflection (§9, finding 3,
  and "Findings 19-21"). In a reason tour, the decision log since S22 (the
  decision panel before). Not the guide, which only leads back to one.
- **Answered:** `submitRationale` was called for the decision, with any of the
  three responses. «Nein» counts also without a reason chip (Q2, D12).
- **Reflection pause:** the run paused because a reflection is shown
  (`TourBriefing.pauseOnReflection`, §4.7). Not the conflict auto-pause
  (`autoPauseOnConflict`), which stops the run at a new conflict, before any
  decision.
- **Finish:** the toolbar's «Szenario abschliessen → …» (`finishDemoMode` →
  `advanceExperiment`), and the guide's «Schicht beenden» where a condition
  shows it. Plan B hides the latter (`control.endShift`).

### Components

| Component | Responsibility | Change | Before (`main` 1e33088) | After (this branch) |
|---|---|---|---|---|
| `SessionStore` (rationale part) | Holds the decisions that wait for a reason and records the reason on the decision. Not where the reason is asked, and not which panel shows it. | 🟨 modified: in reason tours keeps every open reflection, not one; reopens one by decision; stamps when it was answered; asks only where a place can show it (S10). | – | – |
| `OperatorModelBridge` | Reports decisions to the operator model once their reflection is settled. Not where a reflection is asked or shown. | 🟨 modified: holds back every open decision, not only the shown one (finding 1). | – | – |
| `ProposalCompareComponent` | Compares plan, AI and own choice for a train and applies one. Not where past decisions are listed (the decision log). | 🟨 modified: new title; showed the open reflection at its top in a tour that asks for reasons (S3), since S22 (D20) no longer, the log does. | <img src="reflection-inline/before-3-panel.png" width="260"> | <img src="reflection-inline/after-3-panel.png" width="260"> |
| `ProposalCompareComponent` (S25-S27) | as above | 🟨 planned: titled «Handlungsoptionen»; closes after a course is taken and opens for the next choice (D25); read-only for a decided choice, inside the reflection (D26). | – | – |
| `PanelShellComponent` | Frames a panel in a layout and opens or closes it. Not what the panel shows. | 🟨 planned (S26): a panel can ask its own frame to open or close. | – | – |
| `ReflectionPromptComponent` | Asks the reflection for the shown decision. Not where it is placed. | 🟨 modified: names the course actually taken (§2, related bug); planned (S12, Q12 a): shows all its questions, without «Weitere Fragen», in every reason tour. | <img src="reflection-inline/before-2-dialog-text.png" width="260"> (in the dialog) | <img src="reflection-inline/after-2-dialog-text.png" width="260"> (in the decision panel; in the log from S22) |
| `DecisionLogPanelComponent` | Lists the run's decisions and, in a tour that asks for reasons, asks the reflection of one of them below the list. Not where a decision is taken (the decision panel). | 🟨 modified: open reflections are marked, counted next to the toggle, and can be reopened; highlighted when finishing is refused; since S22 and S23: the reflection is answered here, below the entries, and the panel is titled «Entscheidungsprotokoll und Reflexion». | <img src="reflection-inline/before-4-log.png" width="200"> | <img src="reflection-inline/after-4-log.png" width="200"> |
| `SessionStore` (decided options) | Keeps, per decision, the options the decision panel showed when the course was taken. Not exported, and not where they are drawn. | 🟩 planned (S27): the reflection can show what was decided on. | – | – |
| `TourReasonDialogComponent` | The modal reflection that pauses the run. | 🟥 removed. | <img src="reflection-inline/before-1-dialog.png" width="320"> | – (removed) |
| `TourGuideComponent` | Leads through the tour's steps. Not where a scenario is finished in an experiment run (the toolbar). | 🟨 modified: «Reflexion öffnen» reopens the newest open reflection, now in the panel (the log from S22); «Schicht beenden» is refused while reflections are open. | <img src="reflection-inline/before-5-guide.png" width="360"> | <img src="reflection-inline/after-5-guide.png" width="360"> |
| `AppComponent.finishDemoMode` / `ToolbarComponent` | Finishes a scenario or tour leg from the toolbar. Not where the reflection is asked. | 🟨 modified: refuses while reflections are open, and says so next to the button. | <img src="reflection-inline/before-6-finish.png" width="360"> | <img src="reflection-inline/after-8-toolbar-refused.png" width="360"> (finish refused) |
| `TourBriefing` / `TourContextService` | Describe a tour and answer what it asks for (reasons, debrief, sandbox, …). Not where the run is paused (`AppComponent`). | 🟨 modified: a tour can ask for the run to pause while a reflection is shown (§4.7). | – | – |
| `RationaleCaptureComponent` | The short "why?" prompt with reason chips, in the Recommendation panel and the Co-Learning reflection panel, for sessions that are not a reason tour. Not the reflection of a reason tour (`ReflectionPromptComponent`). | 🟨 modified (S8, S9): starts empty for a new decision, and names the course actually taken; it still asks about the latest decision as on `main` (finding 4). | <img src="reflection-inline/before-9-rationale-capture.png" width="220"> | <img src="reflection-inline/after-9-rationale-capture.png" width="220"> |
| `AppComponent.reflectionPlaceInLayout` | Says whether the active layout has a panel that can show a "why?", expanded or collapsed. Not which one shows it (D15), and not the reflection itself (`SessionStore`). | 🟩 added (S10): a decision asks a "why?" only where the participant can see it; since S22: in a reason tour the decision log is the place, not «Handlungsvergleich». | – | –
| `preset-plan-b` (`PLAN_B_UI`) | Plan B's layout and the UI items it removes or collapses. Not the deployment-wide items (`ui-config.json`). | 🟨 modified (S13, D4): the decision log starts open, so the participant sees its entries without opening them. | – | – |
| `preset-plan-b`, `preset-colearning-interview` (columns) | Where the reason tours' panels sit. Not which UI items a condition removes (`PLAN_B_UI`). | 🟨 modified (S23, D21): the decision log moves from the left column to the right one, between «Lage: Risiko & Auswirkung» and «Handlungsvergleich». | – | – |

Pictures from `plan-b-p01`, leg 1, Plan B deployment config, except
`RationaleCaptureComponent`: `preset-colearning-study3` (English), after
«Plan behalten», at 1e33088 and f977f7c; both show the wrong label S9 fixes
(finding 12).

## 1. What the issue asks for

| # | Requirement | Source |
|---|---|---|
| 1 | The reflection opens in the widget where the decision is taken («Plan / KI / Mensch»), and the simulation is no longer stopped | issue, item 1 |
| 2 | «Plan / KI / Mensch» is renamed «Handlungsvergleich» | issue, item 2 |
| 3 | Past decisions can be opened from the decision log and their reflection filled in later | issue, item 3 |
| 4 | When finishing a scenario, all reflections must be filled in: report an error and highlight the open ones in the decision log | issue, item 4 |
| 5 | The first paragraph ("Die Simulation ist angehalten. Die KI lernt …") goes | issue, item 5 |
| 6 | The last sentence ("Danach läuft die Simulation weiter.") goes | issue, item 6 |
| 7 | All of this in general, not only for Plan B | issue, lead |
| 8 | A tour can still turn the pause for a reflection on, by a flag of its own; off unless set | maintainer, 2026-11-06 |
| 9 | The decision log is renamed «Entscheidungsprotokoll und Reflexion», wherever it is shown | maintainer, 2026-11-09 |
| 10 | The reflection is shown and answered in the decision log, below its entries, one at a time (also after «Reflexion nachtragen»), and no longer in «Handlungsvergleich»; this revises the place of requirement 1 | maintainer, 2026-11-09 |
| 11 | The decision log moves to the right column, in every setup that asks for reasons, not only Plan B | maintainer, 2026-11-09 |
| 12 | «Handlungsvergleich» sits above «Entscheidungsprotokoll und Reflexion» | maintainer, 2026-11-09 |
| 13 | «Handlungsvergleich» is renamed «Handlungsoptionen», in all languages | maintainer, 2026-11-09 |
| 14 | Once a course is taken («übernommen») the decision panel closes; it opens again when a new choice is due | maintainer, 2026-11-09 |
| 15 | A reflection that opens shows the decided options again: the train, PLAN / KI / MENSCH without the option buttons (Halten, Halten bis frei, …), and the comparison below | maintainer, 2026-11-09 |
| 16 | They sit between the reflection's heading («Co-Learning · Schritt 6 Reflexion») and «Warum diese Entscheidung?», on a background that marks them as decided, unlike the open choice in the decision panel | maintainer, 2026-11-09 |

### 1.1 Limitations

The code keeps no list of its own; these become comments at the places named.

- Switching the shown reflection on purpose («Reflexion nachtragen» for
  another decision) drops what was typed and not sent for the shown one:
  `ReflectionPromptComponent` resets on a new `decisionSeq`. The `TODO` is not
  in the code yet (finding 8).
- A replay shows neither the inline reflection nor the open marks: open
  reflections are not recorded, only `reflectedAt` on the answered decisions
  (§4.6). Replay does not read the rationale state today either.
- The French title and texts are drafts until a native reviewer has read them
  (D11).
- The guide's step «Reflexion» says the run keeps going, in every reason tour
  (finding 13). A tour that sets `pauseOnReflection` needs its own hint
  (§4.7, Q7).
- A hand-built layout with several places shows one reflection in each, with
  different forms (D15, finding 19).
- Where no place can show a "why?", the decision is logged without a reason
  (Q9; S10).
- A reflection that appears is scrolled into view inside the log only
  (`scrollIntoPanel`, finding 9), not the column around it. From S26 the log
  sits below the decision panel again, which closes as the reflection opens
  (D23, D25); on a screen too low for «Lage», the closed panel and the log,
  the participant scrolls the column.
- The decided options exist only for a course taken in the decision panel
  (D26). A decision from the map, the Fahrplan or the ZWL shows its reflection
  without them. They are kept in memory: after a reload, and in a replay,
  the reflection shows none.
- «Nein» without a reason chip counts as answered (Q2, D12), so requirement 4
  can be met without giving a reason. The record shows it:
  `hypothesisResponse: 'no'` and an empty `rationale`.

### 1.2 Assumptions

Not checked in code; they hold by construction of the `reasonDialog` tours and
the study setup.

- Every layout a `reasonDialog` tour runs has a decision panel and a decision
  log, the log in the right column (D21). True today: `preset-plan-b` and
  `preset-colearning-interview` are the only two (§2); S18's spec checks for
  the log from S22.
- `reasonDialog` tours run in Co-Learning only (`modes: ['co-learning']`, study
  conditions `mode: 'co-learning'`), so no open reflection is left behind in a
  mode without a decision log.
- No Plan B data recorded before this change has to be compared with data
  recorded after it on decision or reflection timing. Before, the clock stood
  while a participant reflected; after, it runs (§1.5).

### 1.3 Follow-ups (not in this PR)

| Follow-up | Why not in this PR | From | Findings | Issue |
|---|---|---|---|---|
| Keep a typed but unsent reflection when switching to another one | Rare in a run, and the decision stays open | Limitations (comment on `reopenRationale`, S19) | 8 | - |
| Require a reason chip for «Nein» too | Decided against for now: «Nein» stays as it is in every tour (Q2) | Limitations | - | - |
| Show open reflections in a replay | Needs recording the open list; no analysis asks for it yet | Limitations | - | - |
| Other Plan B items of the decision log (its buttons) | Part of #150 | issue #150 | - | [#150](https://github.com/flatland-association/flatland-ui-hub/issues/150) |
| An order between the places that show a reflection, or one place per mode in hand-built layouts (presets and Layout Designer layouts ignore mode availability) | Exists on `main` unchanged; until a study needs it, the study designer chooses the panels (Q10, D15). Per-mode gating is proposed in `docs/plans/mode-scoped-layouts-plan.md` (§2, P2), no issue | Limitations | 19 | - |
| A native review of the French title and texts | Needs a native speaker (AGENTS.md) | Limitations, D11 | - | - |
| A fixed order of the reflection's questions | Out of scope (decided 2026-11-09 by the maintainer): the order is drawn per decision since the prompt was built (1504c722), when it drew which questions to show; D18 shows all of them, so only the order is left to vary | PR comment | 26 | [#182](https://github.com/flatland-association/flatland-ui-hub/issues/182) |
| Open a past decision from the log and look at it again (its situation and options) | Not discussed yet; the product owner suggests a new PR after an oral discussion | PR comment | 27 | - |
| Get the initial bundle back under 2 MB, e.g. by lazy-loading features used only on some screens | A refactor outside #160; the budget is raised for now (D28) | Breaking changes (build) | - | - |

Unchanged on purpose: the questions of `app-rationale-capture`
(Recommendation panel, Co-Learning reflection panel; S8 and S9 fix two bugs,
not its questions) and the Director's strategy reflection; the
automatic pause on a new conflict («Auto-Pause»); which decisions ask for a
reflection (a human intervention in Co-Learning, a human override of an AI
suggestion, a choice in the decision panel).

### 1.4 New patterns

Compared with `main` 7eef0cb; the reused concepts are listed under the design principles.

| New | Reuses | Defined in |
|---|---|---|
| A list of open reflections, in decision order, instead of one slot | `PendingRationale`, unchanged | §4.1 |
| A panel that shows the reflection inline: the decision panel from S3, the decision log from S22 (D20) | the existing `app-reflection-prompt`, unchanged in its questions (S12 shows all of them, Q12 a) | §4.2 |
| A panel that closes and opens its own frame (the decision panel, D25) | the shell's `expanded` state, through a token in `core/layout` (no import of the shell, which imports the panels) | §4.8 |
| A read-only, decided view of the decision panel | `ProposalCompareComponent` with an input; the decision log embeds it as it embeds the reflection prompt | §4.8 |
| Per-decision copy of the options shown (`ProposalSnapshot`, in memory) | `PendingRationale`'s per-decision keying by `decisionSeq` | §4.8 |
| Finishing a scenario can be refused | the existing `finishDemoMode` entry point and the guide's «Schicht beenden» | §4.4 |
| `DecisionLogEntry.reflectedAt` / `reflectedAtStep` | the optional fields `rationale`, `reflection` next to them | §4.1 |
| `TourBriefing.pauseOnReflection`, off by default | the `reasonDialog` flag and the removed dialog's pause effect | §4.7 |
| `SessionStore.queueReflections`: the queue only in reason tours, set by `AppComponent` from the tour | the store's own signals; the store still does not read the tour | §4.1, finding 4 |
| `pendingRationale` derived (read-only) from the open list | `computed`, as elsewhere in the store | §4.1, finding 1 |
| A decision asks a "why?" only where a place can show it | the app setting a store flag from the layout, as it does for `queueReflections` (S10) | §9, "Findings 19-21", Q9 |

Not new on purpose: no new panel, no new UiConfig id, no new i18n key for the
log's title (S23) or the decision panel's (S25), no new colour token (S27), no change to the reflection's questions, no change to the payload sent to the backend.

### 1.5 Breaking changes

None for callers: no API, payload or file format changes; the decision log
gains two optional fields, which older readers ignore. Behaviour:

- A `reasonDialog` tour no longer pauses after a decision. Intended. Decision
  times and the number of decisions per run are not comparable with runs
  recorded before. A tour that needs the old behaviour sets
  `pauseOnReflection` (S7, §4.7).
- A scenario with an unanswered reflection can no longer be finished.
  Intended (requirement 4). Aborting a run (closing, leaving) is not blocked.
- `SessionStore.canReopenRationale` and `reopenRationale()` keep their names;
  `reopenRationale` gains an optional `seq`. `_dismissedRationale` (private)
  goes. `TourGuideComponent` and `DecisionLogPanelComponent` call them.
- `SessionStore.pendingRationale` becomes read-only (a `computed`, finding 1).
  Every reader keeps working; nothing outside the store wrote it (grepped
  2026-11-06), and the tests only read it.
- «Plan / KI / Mensch» reads «Handlungsvergleich» everywhere. The click id
  `panels.planAiHuman` stays; only the wording changes (AGENTS.md, click ids).
- S8: the short "why?" no longer carries the previous decision's chips and
  note over to a newer one. Records made before kept them by mistake
  (finding 21).
- S9: after «Plan behalten» the short "why?" and its hypothesis say
  "Weiterfahren", not "Umleiten" (finding 12). Study 3's Co-Learning records
  before and after differ in that text.
- S10: where no place can show a "why?" (Recommendation study 3, the
  ZWL tours), decisions no longer wait for one (Q9). Intended.
- S11: the screen `reflection` is no longer logged, in any mode; the
  working screen `session` carries `detail.reflection` instead, and clicks
  during a reflection say `view: 'session'` (D17). Records before and after
  differ in screen times and click views; an analysis of older records reads
  `reflection` as "a reflection waits" and takes the working screen from the
  last `session` entry. `docs/experiment-logging.md` says so.
- S12 (Q12 a): every reflection in a reason tour asks all three questions,
  not two drawn ones. Records keep their format (unanswered questions stay absent), but
  answer rates per question are not comparable with records made before.
- S13 (D4): Plan B's log starts open. Plan B's session records then list no
  `collapsedByDefault` in their UI snapshot; older ones list
  `widget.decision-log`. It departs from issue #145 item 2 ("Hide the
  Decision Log, or collapse it by default"), as the product owner asked.
- S22 (D20): the reflection is asked in the decision log, not in
  «Handlungsvergleich». The record keeps its format; the clicks of the
  reflection's buttons now come from the log's panel (`data-panel-type`
  `decision-log`). Records made before S22 have them from `proposal-compare`.
- S23 (D21, D22): in both reason-tour layouts the log is in the right column;
  UI snapshots made before list it in the left one. Panel ids
  (`preset-pb-decisions`, `preset-ci-decisions`) and the click id
  `panels.decisionLog` stay; only the wording changes, to «Entscheidungsprotokoll
  und Reflexion», everywhere the log is shown.
- S25 (D24): «Handlungsvergleich» reads «Handlungsoptionen» everywhere; the
  click id `panels.planAiHuman` stays.
- S26 (D23, D25): the log is below the decision panel again. The decision
  panel's `panel.<panelId>.expanded` entries in the UI-state stream are now
  also written without a click, when it closes after a choice and opens for
  the next one; an analysis of panel use tells them apart by the missing
  click before them.
- S27 (D26): nothing changes in the record; the decided options are not
  exported.
- Build (D28): the initial bundle's error budget goes from 2.00 MB to
  2.10 MB (`frontend/angular.json`). `main` 7eef0cb was 1,993,658 bytes, 6.3 kB
  under it; this PR adds about 6.8 kB, and S26 crossed it by 432 bytes. Every
  later PR gets the headroom too; the follow-up (§1.3) brings the bundle back
  under 2 MB.

## 2. Today (checked 2026-11-05 on `main`, 1e33088)

- `TourReasonDialogComponent` opens when the tour sets `reasonDialog`, the
  mode is not Director and `pendingRationale` is set
  (`tour-reason-dialog.component.ts:29-34`). An effect pauses a playing run
  on open and resumes it on close, unless the shift review is open (`:39-54`).
  Measured on `plan-b-p01`, leg 1: the footer stays at «Schritt: 8 / 180»
  while the dialog is open.
- `reasonDialog` is set on two briefings (`tour-briefings.ts:193, 480`) and
  inherited by six more built from them: eight briefings, four tours, two
  layouts (`preset-colearning-interview`, `preset-plan-b`), each with a
  decision panel and a decision log. All eight show the guide step
  `reflect` («Reflexion», step 6), whose hint said that the run pauses after
  a decision (finding 13). Table in §4.7.
- No other pause waits for a reflection. The conflict auto-pause is set per
  mode and by a per-browser Settings switch, never by a tour (§4.7).
- The dialog wraps `app-reflection-prompt` between `tourUi.reason.lead` ("Die
  Simulation ist angehalten. Die KI lernt nur aus Gründen, die du
  bestätigst.") and `tourUi.reason.note` ("Danach läuft die Simulation
  weiter."), under the eyebrow «Co-Learning · Schritt 6 Reflexion».
- **One open reflection at a time.** `pendingRationale` is one signal; a new
  decision overwrites it (`session.store.ts:697, 2134`). Closing the prompt
  moves it to `_dismissedRationale`, again one slot, which the guide's
  «Reflexion öffnen» brings back (`:1335-1355`). The pause hides this: while
  the dialog is open, no second decision can be taken. Without the pause it
  can, so one slot would lose reflections.
- **The decision log under Plan B** starts collapsed (`PLAN_B_UI`,
  `collapsedByDefault: ['widget.decision-log']`). Since #150 its head is a
  toggle, «▸ Einträge anzeigen (n)» / «▾ Einträge ausblenden»
  (`dl-toggle`, click ids `log.showEntries` / `log.hideEntries`), which opens
  every entry (`docs/plans/information-display.md` D1). #150 also hides the
  log's «JSON exportieren» and «Leeren» under Plan B
  (`widget.decision-log.actions`), so a participant cannot clear the decisions
  that carry the reflections (picture 4).
- Log entries show no reflection state; `DecisionLogEntry` holds `rationale`,
  `preferenceHypothesis`, `hypothesisResponse`, `reflection` once answered.
- Finishing does not look at reflections. The toolbar's button and the
  debrief call `finishDemoMode()` (`app.component.ts:1282`), which goes to
  `advanceExperiment` in an experiment run and to the next leg or the survey in
  a tour. The guide's «Schicht beenden» calls `store.endShift()`, which pauses
  the run; in an experiment run an effect then calls
  `advanceExperiment('endShift')` (`app.component.ts:1204-1211`). The end of the
  episode itself opens the shift review (`shiftReviewOpen`) but finishes
  nothing.
- «Plan / KI / Mensch» is the wording of `panels.planAiHuman` (de, en "Plan /
  AI / human", fr "Plan / IA / humain"), and appears in text in
  `de.json` (`handoff`, `compareTitle`), in four texts of
  `tour-briefings.ts` (hints and briefing lines), and in comments and internal
  labels elsewhere.
- **Related bug:** after «Plan behalten» the reflection's header and
  hypothesis say "Umleiten". `ReflectionPromptComponent.strategyLabel()` and
  `hypothesis` call `strategyLabelForAction(p.action, t)` without the logged
  choice; `recordProposalChoice` passes action 2, which reads as "Reroute".
  `submitRationale` passes it and stores the right label, so only what the
  participant sees is wrong (picture 2).

### Pictures (before, `plan-b-p01`, leg 1, Plan B deployment config)

Taken with `scripts/docshots-reflection-inline.mjs` on a production build of
`main` 1e33088: the first train in the Fahrplan, «Plan behalten». Retaken
after the rebase onto #150; picture 4 changed with it.

| # | Element | Before |
|---|---|---|
| 1 | Working screen with the reflection dialog; run paused at step 8 | ![before](reflection-inline/before-1-dialog.png) |
| 2 | The dialog: the first paragraph and the last sentence that go (requirements 5, 6), and "Umleiten" for a kept plan | <img src="reflection-inline/before-2-dialog-text.png" width="420"> |
| 3 | The decision panel and its title (requirements 1, 2) | <img src="reflection-inline/before-3-panel.png" width="420"> |
| 4 | The decision log after one decision, opened with #150's toggle: no mark for the missing reflection (requirements 3, 4) | <img src="reflection-inline/before-4-log.png" width="320"> |
| 5 | The guide after closing the reflection: «Reflexion öffnen» | ![before](reflection-inline/before-5-guide.png) |
| 6 | The finish button, with the reflection unanswered: it finishes (requirement 4) | ![before](reflection-inline/before-6-finish.png) |

## 3. Decisions

All decisions are ✅: D4, D5 and D10-D13 from the answers to Q1-Q5 (D4 revised by the PR comment of 2026-11-06, Q1 revisited), the others confirmed on 2026-11-05; D14 with Q6-Q8, D15 with Q10, D16 with Q9 and D17 with Q11 on 2026-11-06; D18 with Q12 on 2026-11-07; D19 with finding 25, D20-D22 with Q13 on 2026-11-09; D23-D27 with requirements 12-16, Q14 and Q15 the same day.

| ID | Decision | Why |
|---|---|---|
| D1 | ✅ The dialog is removed for every `reasonDialog` tour; the reflection shows at the top of the decision panel instead. The flag keeps its name and now means "this tour asks for a reason after each decision, in the decision panel, and before finishing" (confirmed 2026-11-05). Place revised 2026-11-09: the decision log (D20) | Requirement 7; renaming the flag touches every briefing for no behaviour |
| D2 | ✅ Nothing pauses or resumes the run for a reflection (confirmed 2026-11-05). Revisited 2026-11-06 by requirement 8: holds for every tour that does not set `pauseOnReflection` (D14) | Requirement 1 |
| D3 | ✅ The store keeps every open reflection, keyed by `decisionSeq`, in decision order. A new decision is shown at once if no reflection is shown; otherwise it waits and is shown when the shown one is answered (confirmed 2026-11-05) | Without the pause, decisions overlap (§2); replacing the shown reflection would drop what the participant is typing |
| D4 | ✅ Under Plan B the log starts open (revised 2026-11-06 by the product owner's [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#issuecomment-6694427791), finding 24; recorded 2026-11-07 as Q1 revisited a; S13). It is closed and opened with #150's toggle; this plan adds the count of open reflections next to the toggle. Until then: collapsed by default (decided 2026-11-05, Q1) | Requirement 3 needs the entries, not only the open ones; since #160 they carry «Reflexion nachtragen», so the product owner wants them shown (finding 24) |
| D5 | ✅ An entry with an open reflection carries «Reflexion nachtragen», which shows it in the decision panel; an answered one a ✓ (decided 2026-11-05 with Q1). Since D20 it shows it below the log's entries | Requirement 3 |
| D6 | ✅ Finishing with open reflections is refused: the run goes on, a message under the finish button names the count, and the log opens with the open entries highlighted (confirmed 2026-11-05) | Requirement 4 |
| D7 | ✅ `reflectedAt` (clock time) and `reflectedAtStep` (sim step) are stamped on the decision when its reflection is answered (confirmed 2026-11-05) | Without the pause a reflection can come at once or just before finishing, and the analysis has to tell them apart; the decision only records when it was taken. Not the click log (`ClickLogService`): the reflection's buttons have no click id and no link to their decision, and the click log is only written with study logging on, while the decision log is in every export. The time sits next to the answers it describes; older readers ignore the fields |
| D8 | ✅ The reflection names the course actually taken: the prompt reads the logged choice from the decision log, as `submitRationale` already does, so «Plan behalten» reads "Weiterfahren" and the AI plan "den KI-Vorschlag" instead of "Umleiten" (confirmed 2026-11-05) | A panel choice stores the placeholder action 2 ("Umleiten") and puts the real choice on the log entry; the saved learning record is right, only what the participant sees is wrong (§2). In S3 rather than a separate fix: S3 moves the prompt next to the choice, where a contradicting label invites wrong answers, and the fix is two lines in code S3 touches. The participant's own choice («Mensch») goes through the override path and is already right |
| D9 | ✅ `tourUi.reason.lead` and `.note` are deleted in de/en/fr; `tourUi.reason.eyebrow` («Co-Learning · Schritt 6 Reflexion») stays as the heading of the reflection in the panel (confirmed 2026-11-05) | Requirements 5, 6. Only the removed dialog uses the two keys, and they are paragraph text, not click ids, so AGENTS.md allows deleting them; kept, they would be dead text that `i18n:check` never flags. The heading links the reflection to step 6 of the guide |
| D10 | ✅ A collapsed decision panel stays collapsed when a reflection arrives. A button «Offene Reflexionen anzeigen» next to the open count opens the log's entries and highlights the open ones, the same view D6 shows when finishing is refused; built in S4 (decided 2026-11-05, Q3). Since D20 the same holds for a collapsed log | The participant keeps control of the layout; the open count says that one is waiting |
| D11 | ✅ Titles: de «Handlungsvergleich», en «Action comparison», fr «Comparaison des actions» (decided 2026-11-05, Q5); the French one still goes to a native reviewer | Requirement 2 |
| D12 | ✅ «Nein» counts as an answered reflection, with or without a reason chip; the prompt is unchanged (decided 2026-11-05, Q2 a) | Keeps the reflection the same in every tour; the record tells a bare «Nein» apart (§1.1) |
| D13 | ✅ Every `reasonDialog` tour refuses to finish with open reflections, the interview tour included (decided 2026-11-05, Q4 a) | One rule (requirement 7); the interviewer can answer for the interviewee |
| D14 | ✅ A new `TourBriefing.pauseOnReflection` flag, off by default, pauses the run while a reflection is shown and resumes it as the removed dialog did (decided 2026-11-06, requirement 8). It pauses while a reflection is shown, not while any is open (Q6 a); no tour sets it yet (Q7 a); it has effect only together with `reasonDialog` (Q8 a) | Keeps the old behaviour available per tour without bringing back the dialog |
| D15 | ✅ No order between the places that show a reflection. Which panels a condition shows, and with them where its reflection is asked, stays the study designer's choice (presets, study conditions); no shipped setup shows a reflection twice. An order can follow if a study needs one (decided 2026-11-06, Q10) | The problem exists on `main` unchanged and #160 does not worsen it in any shipped setup (§9, "Findings 19-21"); a runtime order would be a new mechanism |
| D16 | ✅ Where no place can show a "why?", none is asked; the decision is logged without a reason. A place counts while its panel is in the layout, expanded or collapsed; in the system layout, the mode's own panel (decided 2026-11-06, Q9 b and Q9 revisited a). Since D20 the place of a reason tour is the decision log, not «Handlungsvergleich» | A "why?" nobody sees leaves the decision waiting and the screen log saying "reflection" (finding 20) |
| D17 | ✅ A waiting reflection is logged as part of the working screen, in every mode and condition: the screen `reflection` is no longer written, `session`'s detail gets `reflection: <kind>` while one waits, and clicks meanwhile carry `view: 'session'` (decided 2026-11-06, Q11 a) | Since #160 no reflection is a screen of its own; one meaning for all data (§9, finding 3) |
| D18 | ✅ The reflection of a reason tour shows all its questions (reason chips, gut feeling, missing information, drawback), in the order drawn per decision; «Weitere Fragen» goes. For every reason tour, not only Plan B; `reflectionQuestionLimit` then only applies to the Co-Learning reflection panel (decided 2026-11-07 by the maintainer, Q12 a; S12) | Participants overlooked the collapsed question (finding 23); one rule for every reason tour (D13), no new setting |
| D19 | ✅ `detail.centerView` logs the centre tab by its widget type, as stored: `zug-weg-diagramm` for the ZWL, not a new `zwl`. The same value as `panel.view-tabs.tab` and the layouts; #173 keeps the stored and logged ids until the study is over (its D1), and renames them all at once then. Prose says ZWL (#173's D3) (decided 2026-11-09 by the maintainer, finding 25; S21) | A second name for the same widget in the logs would need a mapping in every analysis until #173's rename, and again after it |
| D20 | ✅ A reason tour's reflection is shown and answered in the decision log, below its entries, and no longer in «Handlungsvergleich». One at a time: a new decision shows its reflection at once if none is shown; otherwise it only joins the open ones and their count (D3 unchanged). «Reflexion nachtragen» and the guide's «Reflexion öffnen» show the chosen one there (decided 2026-11-09 by the maintainer, requirement 10, Q13 a; S22) | The reflection opened above the decision panel's options and did not match them ([PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#issuecomment-6734371702), finding 26); in the log it sits with the decision it is about and the button that brings it back |
| D21 | ✅ The decision log moves to the right column, between «Lage: Risiko & Auswirkung» and «Handlungsvergleich», in both reason-tour layouts (`preset-plan-b`, `preset-colearning-interview`); `preset-guide-mode-light` has it on the right already (decided 2026-11-09 by the maintainer, requirement 11, Q13 b; revised the same day, Q13 revisited) | Answering is acting, and the zone rule keeps the left column for reading. Above «Handlungsvergleich», not below: below it the log got almost no height at 1600×1000 and the reflection opened out of view (Q13 revisited). The order is revised by D23, which closes the decision panel after a choice (D25) |
| D22 | ✅ Title: de «Entscheidungsprotokoll und Reflexion», en «Decision log and reflection», fr «Journal des décisions et réflexion», wherever the log is shown, as the wording of `panels.decisionLog` (key and click id stay). Texts that only mention the log («… im Entscheidungsprotokoll markiert», the guide hints) keep the short name (decided 2026-11-09 by the maintainer, requirement 9; S23); the French one goes to a native reviewer | One name for one panel (requirement 9: everywhere, not only in reason tours); AGENTS.md keeps click ids; the full title in running text reads badly |
| D23 | ✅ The decision panel sits above the log again: «Lage», «Handlungsoptionen», «Entscheidungsprotokoll und Reflexion» (decided 2026-11-09 by the maintainer, requirement 12; revises D21's order; S26) | The panel closes after a choice (D25), so the log moves up as the reflection opens; the order follows the work: assess, decide, reflect |
| D24 | ✅ Title: de «Handlungsoptionen», en «Action options», fr «Options d'action» (decided 2026-11-09 by the maintainer, requirement 13, Q15; revises D11); the French one goes to a native reviewer. Key and click id `panels.planAiHuman` stay | The panel offers options; the comparison is one part of it |
| D25 | ✅ The decision panel closes when a course is taken (plan, KI or the participant's own) and opens when the next choice is due: when the selected train changes, or a new train appears in «Lage: Risiko & Auswirkung»; in every layout that shows the panel. The participant can still open and close it (decided 2026-11-09 by the maintainer, requirement 14, Q14 a; Q3 revisited; S26) | The log needs the room while the reflection is answered; the closed panel says the choice is made |
| D26 | ✅ A reflection shows the decided options of its decision: the train, the courses PLAN, KI and MENSCH as they were when the course was taken, which one was taken, and the comparison; no option buttons, no «übernehmen», no alternatives. Only for a course taken in the decision panel; kept in memory per decision, not exported (decided 2026-11-09 by the maintainer, requirement 15; S27) | The participant reflects on what they saw when deciding, not on a later situation; the copy is what the panel already holds |
| D27 | ✅ The decided options sit between the reflection's heading and «Warum diese Entscheidung?», on the muted surface (`--app-surface-muted`) with a label «Entschieden · Schritt n», so they read as a past decision, unlike the open choice in the decision panel on the plain surface (decided 2026-11-09 by the maintainer, requirement 16; S27) | Existing tokens only (AGENTS.md); the label says it in words, not only by colour |
| D28 | ✅ The initial bundle's error budget is raised from 2.00 MB to 2.10 MB, for now (decided 2026-11-09 by the maintainer, a) of three: raise, shave bytes, lazy-load a feature first; S26) | The limit is unchanged since 2026-06-05 and `main` was 6.3 kB under it; shaving bytes only postpones the next PR's failure, lazy loading is a refactor outside #160 |

## 4. Design

### 4.1 Store: open reflections (D3, D7)

- `SessionStore`:
  - `openReflections = signal<PendingRationale[]>([])`, in decision order,
    replacing `_dismissedRationale`. The two places that ask for a reflection
    (`recordProposalChoice`, the override path in `setOverride`) append the
    decision, and show it only when none is shown. In a session without
    `queueReflections` (no reason tour) a new decision replaces the list and
    × drops it, as on `main` (finding 4).
  - `pendingRationale` stays the reflection *shown*, so `rationale-capture`
    and the reflection prompt keep reading it. It is derived (a `computed`
    from the list and a private `_shownSeq`), so an answered or cleared
    reflection cannot stay shown (finding 1).
  - `submitRationale` removes the decision from the list, stamps
    `reflectedAt = Date.now()`, `reflectedAtStep = elapsedSteps()` on its
    `DecisionLogEntry`, and shows the next waiting one: the oldest open
    decision the operator has not closed.
  - `dismissRationale` keeps the decision open, remembers it as closed (so it
    is not shown again on its own), and shows the next waiting one, if any.
  - `reopenRationale(seq?)` shows the given open decision, or the newest one.
    `canReopenRationale` = list not empty and nothing shown.
  - `openReflectionSeqs` (computed set of `decisionSeq`) for the log.
  - `reflectionsMissing = signal<number>(0)` and
    `refuseFinishForOpenReflections(): boolean`: sets it to the open count and
    returns `true` when the list is not empty. The caller decides whether
    reflections are required (§4.4); an effect sets it back to 0 once the
    list is empty.
  - `clearDecisionLog()` clears the list, the closed set, `pendingRationale`
    and `reflectionsMissing`: a reflection patches its decision, so with the
    decisions gone nothing is left to ask. `newSession`, `endSession` and
    `reset` all call it, so a new leg starts without open reflections; so
    does the log's «Leeren», where a condition shows it.
- `DecisionLogEntry` (`core/decision-log.ts`): optional `reflectedAt`,
  `reflectedAtStep`. The session record carries the log as it is
  (`mergeDecisions` replaces an archived entry by the patched one), so the
  fields reach the export without a schema change (§4.6).

### 4.2 The reflection in the decision log (requirements 1, 5, 6, 10; D1, D2, D8, D9, D20)

- Planned in S22 (D20): `DecisionLogPanelComponent`, when `tour.reasonDialog()`,
  the mode is not Director and `pendingRationale()` is set, shows below its
  entries a section: the eyebrow «Co-Learning · Schritt 6 Reflexion» and
  `<app-reflection-prompt />`. One reflection at a time, the one the store
  shows (D3). It shows also while #150's toggle hides the entries: the toggle
  is for the list, not for the reflection. The reflection names its train, so
  a decision taken for another train (on the map) is still clear.
- `ProposalCompareComponent` loses that section, its scroll effect and its
  styles; from S3 until S22 the section sat at the top of this panel.
- `ReflectionPromptComponent`: its `role="dialog"` becomes `role="region"`
  (it no longer is one); `strategyLabel()` and `hypothesis` pass the logged
  action from `decisionLog()` like `submitRationale`.
- `TourReasonDialogComponent` and its tag in `app.component.html:1077` are
  removed, with the pause effect; S7 brings the effect back behind a tour
  flag (§4.7).
- When a reflection is shown, the log scrolls it into view inside its own body
  (`scrollIntoPanel`, S15, moved out of `proposal-compare.component.ts` with
  the section); when the log is collapsed, it stays collapsed (D10).
- Planned in S12 (D18), in every reason tour (scope in Q12): `ReflectionPromptComponent` shows every question
  of its pool (`REFLECTION_QUESTION_POOL`: gut feeling, missing information,
  drawback) in the order `pickQuestions` draws for the decision. `more`,
  `showMore`, the «Weitere Fragen (n)» button and the key
  `reflectionPrompt.more` go (no click id). `reflectionQuestionLimit` then
  only applies to the Co-Learning reflection panel, its other user.

### 4.3 Decision log (requirement 3; D4, D5)

- The entries are opened with #150's toggle (`dl-toggle` in the embedded
  head), unchanged. The open badge and the button below sit next to
  it in `.dl-panel-head--embedded`, not inside it (no button in a button).
- In `reasonDialog` tours, each entry whose `seq` is open shows a small button
  «Reflexion nachtragen» (click id `log.reflectionOpen`) calling
  `store.reopenRationale(e.seq)`, which shows it below the entries (S22); answered entries show ✓ with the title
  «Reflexion erfasst». The header's count gets a second badge for the open
  ones («2 offen»), so the open reflections are visible while the entries are
  collapsed.
- Next to that badge, while reflections are open, «Offene Reflexionen
  anzeigen» (click id `log.showOpenReflections`; en «Show open reflections»,
  fr «Afficher les réflexions ouvertes») opens the entries and highlights the
  open ones (D10, built in S4).
- One highlight for both ways in: the panel's `highlightOpen` is true after a
  click on that button or while `store.reflectionsMissing() > 0` (§4.4). An
  effect then sets `collapsed` to false, and open entries get the class
  `dl-entry--missing` (colour from an `--app-*` token). It ends when no
  reflection is open. The button does not show the toolbar's message; only a
  refused finish does.
- Planned in S13 (D4): `PLAN_B_UI` drops
  `collapsedByDefault: ['widget.decision-log']`, so the log starts open under
  Plan B, as in every other setup already. The toggle, the open count and
  «Offene Reflexionen anzeigen» stay; a participant can still close the
  entries. The verb `collapsedByDefault` stays for other conditions.
- Planned in S23 (D21): `preset-pb-decisions` and `preset-ci-decisions` move
  from the left column to the right one, between «Lage» and the decision
  panel (D21),
  with their ids, `expanded` and `minHeight` unchanged; their comments say
  why (the reflection is answered there).

### 4.4 Finishing (requirement 4; D6)

- Two gates, both only when `tour.reasonDialog()` is set:
  - `AppComponent.finishDemoMode()`, first thing: if
    `store.refuseFinishForOpenReflections()`, return. Covers the toolbar's
    button in experiment runs and tours, and the debrief's finish.
  - `TourGuideComponent`'s «Schicht beenden»: the same check before
    `store.endShift()`, so the run is neither paused nor the shift ended. The
    `advanceExperiment('endShift')` effect then never fires with open
    reflections.
- `store.reflectionsMissing() > 0`:
  - shows left of the finish button, in the toolbar, `role="alert"` like
    `toolbar.runError`: «Noch {{n}} Entscheidung(en) ohne Reflexion. Sie sind
    im Entscheidungsprotokoll markiert.» (key `toolbar.reflectionsMissing`);
  - opens the decision log's entries and highlights the open entries, with
    the same highlight as the log's button (§4.3).
- Not gated: `'aborted'`, `finishExperiment()` and `nextLegOrReview()`, which
  only run after the leg is finished, and the Director's own «Schicht
  beenden». The end of the episode finishes nothing (§2), so it needs no gate.

### 4.5 Rename (requirement 2)

- `panels.planAiHuman`: de «Handlungsvergleich», en «Action comparison», fr
  «Comparaison des actions» (needs the native review AGENTS.md asks for).
- The texts that quote the title: `de.json` (`handoff`, `compareTitle`; en and
  fr likewise), the hints in `tour-briefings.ts`, `widget-catalog.ts`'s name.
  Code comments and the preset `title:` strings stay: the latter are lookup
  keys for `panel-titles.ts`, not shown text. `STOCK_PANEL_TITLES` maps the
  new name to the same key too, so a panel added from the catalog under
  «Handlungsvergleich» is translated as well.
- Planned in S23 (D22): `panels.decisionLog`: de «Entscheidungsprotokoll und
  Reflexion», en «Decision log and reflection», fr «Journal des décisions et
  réflexion». `STOCK_PANEL_TITLES` maps the new German and English titles to
  the same key, next to the old ones. `widget-catalog.ts` keeps its name
  "Decision Log & Accountability Strip": it is the internal widget name of
  the gallery and the UI-config labels, which stay English (AGENTS.md).
  The preset `title:` strings stay (lookup keys). `toolbar.reflectionsMissing`
  and the guide hints keep the short name (D22).

### 4.6 Data model

Current: `DecisionLogEntry` in `core/decision-log.ts`, `PendingRationale` and
the rationale state in `core/session.store.ts`, the session record in
`core/interaction-log/session-record.ts`.

```mermaid
classDiagram
  class SessionRecord {
    «unchanged»
    decisions: DecisionLogEntry[]
    decisionsDropped
  }
  class DecisionLogEntry {
    «unchanged»
    seq · t · simStep · handle · action · …
    rationale?
    hypothesisResponse?
    reflection?
  }
  class PendingRationale {
    «unchanged»
    decisionSeq
    handle · action · simStep · context · …
  }
  SessionRecord *-- "0..*" DecisionLogEntry : decisions
  PendingRationale ..> DecisionLogEntry : decisionSeq = seq
  style SessionRecord fill:#f1f3f5,stroke:#868e96,color:#000
  style DecisionLogEntry fill:#f1f3f5,stroke:#868e96,color:#000
  style PendingRationale fill:#f1f3f5,stroke:#868e96,color:#000
```

Planned: two optional fields on the decision; the open list stays in the
client and is not recorded.

```mermaid
classDiagram
  namespace Record {
    class SessionRecord {
      «unchanged»
      decisions: DecisionLogEntry[]
      decisionsDropped
    }
    class DecisionLogEntry {
      «modified»
      seq · t · simStep · handle · action · …
      rationale?
      hypothesisResponse?
      reflection?
      +reflectedAt?
      +reflectedAtStep?
    }
  }
  namespace Client {
    class PendingRationale {
      «unchanged»
      decisionSeq
      handle · action · simStep · context · …
    }
  }
  SessionRecord *-- "0..*" DecisionLogEntry : decisions
  PendingRationale ..> DecisionLogEntry : decisionSeq = seq
  style SessionRecord fill:#f1f3f5,stroke:#868e96,color:#000
  style DecisionLogEntry fill:#fff3bf,stroke:#e67700,stroke-width:2px,stroke-dasharray:4 2,color:#000
  style PendingRationale fill:#f1f3f5,stroke:#868e96,color:#000
```

Legend: grey «unchanged», yellow «modified» with new fields marked `+`.

One decision in the session record's `decisions`, answered 37 steps after it
was taken (values illustrative):

```diff
 {
   "seq": 3,
   "t": 1793872031512,
   "simStep": 7,
   "handle": 0,
   "accountableOwner": "human",
   "action": "proceed",
   "origin": "proposals",
   "rationale": "Schützt Anschluss",
   "hypothesisResponse": "once",
   "reflection": { "gut": "fit" },
+  "reflectedAt": 1793872093240,   // added
+  "reflectedAtStep": 44           // added
 }
```

Nothing is removed from the record.

### 4.7 When the run pauses (requirement 8; D2, D14)

**Tours that ask for reasons** (`reasonDialog`, checked 2026-11-06). All eight
briefings show the guide step `reflect`.

| Tour | Briefings | Layout | `pauseOnReflection` |
|---|---|---|---|
| Interview (`colearning-interview`) | `co-learning-cost-benefit`, `-en` | `preset-colearning-interview` | no (Q7) |
| Plan B experiment | `colearning-experiment`, `colearning-experiment-2x` | `preset-plan-b` | no (Q7) |
| Walkthrough with survey | `colearning-walkthrough-survey`, `-en` (via `withoutInterview`) | `preset-colearning-interview` | no (Q7) |
| Advanced Co-Learning | `colearning-advanced`, `-en` (via `withoutInterview`) | `preset-colearning-interview` | no (Q7) |

**Pause for a reflection:**

| Setup | `main` 1e33088 | This branch | This branch, tour sets `pauseOnReflection` |
|---|---|---|---|
| Reason tour, not Director | Pauses (modal dialog); no second decision while it is open | Runs; the shown reflection stays, a new one waits (D3) | Pauses while a reflection is shown (Q6) |
| Reason tour, Director | Runs (the dialog skipped Director) | Runs | Runs |
| Any other tour, the sandbox | Runs; a new decision replaces the shown prompt | Same as `main` (finding 4) | Runs: the flag needs `reasonDialog` (Q8) |

**Other pauses**, none waiting for a reflection, none changed by this plan:

| Pause | Where | When | Set by |
|---|---|---|---|
| Conflict auto-pause, impact panel | `impact-panel.component.ts:282` | A new conflict, in a tour, while playing, Co-Learning or Recommendation | The mode, and the Settings switch `autoPauseOnConflict` (per browser, saved locally) |
| Conflict auto-pause, combined actions | `combined-actions.component.ts:170` | A new forecast contention, once per session, not Director | The same |
| End of the shift | `session.store.ts:292` (`endShift`) | «Schicht beenden» | - |
| Leaving Director | `session.store.ts:1138` | A mode switch away from Director | - |
| Replay | `replay.service.ts:226, 264, 285` | Seeking, the end of the replay | - |

No tour or experiment sets the conflict auto-pause; making it per tour is not
asked for.

**The flag (S7):**

- `TourBriefing.pauseOnReflection?: boolean`, documented next to
  `reasonDialog`; `TourContextService.pauseOnReflection` is true only when
  the briefing sets both (Q8). Off unless a briefing sets it; none does
  (Q7).
- `AppComponent` gets back the effect the removed dialog had
  (`tour-reason-dialog.component.ts:39-54` on 1e33088), next to
  `_queueReflections`, as the computed `reflectionPauses` (the flag is set,
  the mode is not Director, `store.pendingRationale()` is set) and the method
  `syncReflectionPause(shown)` that the effect calls (the spec calls it
  directly: rendering the whole app in a spec runs every other effect too):
  - not shown → shown: remember whether the run was playing, and pause it;
  - shown → not shown: play again with `activePolicy() || defaultPolicy()` at
    `playSpeed()`, only if the effect paused it and `shiftReviewOpen()` is
    false.
- With the queue (D3), answering one reflection shows the next waiting one,
  so the run stays paused until none is shown. Closing with × resumes;
  «Reflexion nachtragen» pauses again.
- Inline, the participant can press play while a reflection is shown (the
  dialog was modal). The effect does not pause again until the next
  reflection is shown.
- The store does not read the tour (design principles); the app reads the
  flag, as it does for `queueReflections`.
- Pausing and resuming call `store.pause()` / `store.play()`, as the conflict
  auto-pause does; no new event.
- The guide's `reflect` hint says the run keeps going (finding 13). A tour
  that sets the flag later gets its own hint then (Q7, §1.1).

### 4.8 «Handlungsoptionen» after a choice, and in the reflection (requirements 12-16; D23-D27)

Planned in S25-S27.

- **Rename (S25, D24).** `panels.planAiHuman`: de «Handlungsoptionen», en
  «Action options», fr «Options d'action». The texts that quote it
  (`handoff`, `compareTitle`; the hints in `tour-briefings.ts`;
  `widget-catalog.ts`'s name) likewise; `STOCK_PANEL_TITLES` maps the new
  names to the same key, next to the old ones.
- **Order (S26, D23).** `preset-pb-decisions` and `preset-ci-decisions` move
  below `preset-*-whatif`; the reason-tour spec checks "below" again.
- **Close and open (S26, D25).** A token `PANEL_FRAME` in `core/layout`
  (`{ setExpanded(open: boolean): void }`), provided by `PanelShellComponent`
  with `useExisting`; `setExpanded` sets `expanded` and `panel.collapsed`, as
  `toggleExpanded` does. `ProposalCompareComponent` injects it optionally:
  - after `take('plan' | 'ai')` succeeds and after `commit()`:
    `setExpanded(false)`;
  - when the next choice is due (Q14 a): the selected train changes, or a
    train enters `store.impact()` that was not in it before:
    `setExpanded(true)`;
  - not in its read-only form, not during a replay (`ReplayService.active`),
    and nothing outside a panel shell.
- **Decided options (S27, D26).** `ProposalSnapshot = { handle, result,
  applied: 'plan' | 'ai' | 'human', option: ProposalOption | null }`, `result`
  without `trajectories` (the map preview only). `SessionStore.proposalSnapshots`
  (`Map<decisionSeq, ProposalSnapshot>`, a signal) and
  `keepProposalSnapshot(snapshot)`, which files it under the newest decision
  of that train with origin `proposals` (both ways in: `recordProposalChoice`
  after `take`, and `setOverride` after `commit`). `clearDecisionLog()` clears
  it with the open reflections.
- **Read-only form (S27).** `ProposalCompareComponent` gets an input
  `decided: ProposalSnapshot | null`. With it, the component takes its
  result, applied course and option from the snapshot, loads nothing, draws
  no map preview, and leaves out the note, the option buttons, the
  «übernehmen» buttons (the taken course keeps «✓ übernommen»), an empty
  MENSCH column, the alternatives and the caveats. Its train line and the
  comparison stay.
- **In the reflection (S27, D27).** `DecisionLogPanelComponent`'s reflection
  section: the eyebrow, then, when `proposalSnapshots()` has the shown
  decision, `<section class="dl-decided">` with the label «Entschieden ·
  Schritt {{n}}» (new key `log.decidedAt`, de / en «Decided · step {{n}}» /
  fr «Décidé · pas {{n}}») and `<app-proposal-compare [embedded]="true"
  [decided]="…">`, then `<app-reflection-prompt />`. `.dl-decided`:
  `--app-surface-muted` background, `--app-border` frame.

## 5. Files

### New files

| File | What it adds |
|---|---|
| `frontend/src/app/features/proposal-compare/proposal-compare.component.spec.ts` | The reflection shows in a `reasonDialog` tour after a decision, not otherwise; the new title |
| `scripts/docshots-reflection-inline.mjs` | Before/after screenshots (§2, §6) |
| `scripts/docshots-reflection-hosts.mjs` | Pictures of each place that shows a reflection, and how many show one (§9); the short "why?" of the components table |
| `frontend/src/app/core/operator-model-bridge.service.spec.ts` | Open decisions are held back and reported once answered (finding 1) |
| `frontend/src/app/features/rationale-capture/rationale-capture.component.spec.ts` | S8: a newer decision empties the short "why?"; S9: its label after «Plan behalten» |
| `docs/plans/reflection-inline/*.png` | Before pictures (§2), after pictures |
| `frontend/src/app/testing/tour-context-stub.ts` | S17: `provideTourContextStub(reasonDialog)`, the tour context the specs share |
| `frontend/src/app/core/demo/reason-tours.spec.ts` | S18: every reason tour's layout places the decision panel; S22: the decision log instead, S23: in the right column |

### Modified files

| File | What changes |
|---|---|
| `frontend/src/app/core/session.store.ts` | `openReflections`, `queueReflections`, `_shownSeq`, `pendingRationale` as a `computed`, `openReflectionSeqs`, `reopenRationale(seq?)`, `reflectionsMissing`, `refuseFinishForOpenReflections()`, the stamps, the resets; S10: ask only where a place can show it |
| `frontend/src/app/core/operator-model-bridge.service.ts` | holds back every open decision (finding 1) |
| `frontend/src/app/features/rationale-capture/rationale-capture.component.ts` / `.spec.ts` | S8: reset when `decisionSeq` changes; S9: the logged label |
| `frontend/src/app/core/decision-log.ts` | `reflectedAt`, `reflectedAtStep` |
| `frontend/src/app/features/proposal-compare/proposal-compare.component.ts` / `.html` / `.scss` | the reflection section; S15: scroll the panel body only; S22: the section and its scroll go (D20) |
| `frontend/src/app/features/reflection-prompt/reflection-prompt.component.ts` / `.html` | logged label; `role`; S12: all questions, no `more`/`showMore`, the docstring without "more questions" |
| `frontend/src/app/features/reflection-prompt/reflection-prompt.component.spec.ts` | label after «Plan behalten»; S12: all questions shown, no «Weitere Fragen» button |
| `frontend/src/app/features/decision-log/decision-log-panel.component.ts` / `.html` / `.scss` / `.spec.ts` | open/answered marks, open count next to the toggle, «Offene Reflexionen anzeigen», `highlightOpen` and its specs; S22: the reflection section below the entries, its scroll and styles, specs (shown in a reason tour, not otherwise; shown while the entries are hidden) |
| `frontend/src/app/features/tour-guide/tour-guide.component.ts` / `.html` / `.spec.ts` | `canReflect` from the list; «Schicht beenden» gated (`endShift()`) |
| `frontend/src/app/features/toolbar/toolbar.component.html` / `.scss` / `.spec.ts` | the refusal message |
| `frontend/src/app/app.component.ts` / `.html` | the gate in `finishDemoMode()`; the dialog removed; the `queueReflections` sync (finding 4); `shiftScreenOpen()` waits for open reflections (finding 2); the reflection pause effect (S7); S10: `reflectionPlaceInLayout`; S22: `decision-log` instead of `proposal-compare` as a reason tour's place |
| `frontend/src/app/core/demo/tour-briefings.ts` | `reasonDialog` doc comment; hints with the new title; the `reflect` hint without the pause (finding 13); `pauseOnReflection` (S7); S22: the `reflect` hint (de, en) says the decision log asks for the reason |
| `frontend/src/app/core/demo/tour-context.service.ts` | `pauseOnReflection` (S7); S17: `refuseFinish()` |
| `frontend/src/app/app.component.spec.ts` | the reflection pause: pauses on show, resumes on close only if it paused, not in Director, not after the shift review (S7); S10: a place in the system layout, in presets with and without one, and «Handlungsvergleich» only in a reason tour; S22: the decision log instead |
| `frontend/src/app/core/widgets/widget-catalog.ts` | the panel's name; S25: «Handlungsoptionen» |
| `frontend/src/app/features/layout/components/panel-shell/panel-shell.component.ts` | S26: provides `PANEL_FRAME`, `setExpanded(open)` |
| `frontend/src/app/core/layout/panel-frame.ts` (new) | S26: the `PANEL_FRAME` token and its interface |
| `frontend/src/app/features/proposal-compare/proposal-compare.component.ts` / `.html` / `.scss` / `.spec.ts` | S26: closes after a choice, opens for the next (specs with a stub frame); S27: the `decided` input and the read-only template (specs: no buttons, the taken course marked) |
| `frontend/src/app/core/session.store.ts` / `.spec.ts` | S27: `proposalSnapshots`, `keepProposalSnapshot`, cleared with the log (spec) |
| `frontend/src/app/features/decision-log/decision-log-panel.component.html` / `.scss` / `.spec.ts` | S27: the decided options between the heading and the prompt, only with a snapshot (spec) |
| `frontend/src/app/core/i18n/panel-titles.ts` | «Handlungsvergleich» → `panels.planAiHuman`, next to the old title; S25: «Handlungsoptionen», "Action options"; S23: «Entscheidungsprotokoll und Reflexion» and "Decision log and reflection" → `panels.decisionLog` |
| `frontend/src/app/core/layout/layout-presets.ts` | the interview preset's comment: the reason is asked in the decision panel; S13: `PLAN_B_UI` without `collapsedByDefault`, and the comments on it and on `preset-pb-decisions`; S23: `preset-pb-decisions` and `preset-ci-decisions` to the right column, above the decision panel (D21) |
| `frontend/src/app/core/config/ui-config.service.spec.ts` | S13: Plan B's block leaves the decision log open; a condition can still collapse it |
| `docs/plans/configurable-ui-plan.md` | S13: item 2 under Plan B, "collapsed" becomes "open since #160" |
| `frontend/public/i18n/{de,en,fr}.json` | new title; S23: `panels.decisionLog` (D22); S25: `panels.planAiHuman`, `handoff`, `compareTitle` (D24); S27: `log.decidedAt`; new keys (de / en / fr): `log.reflectionOpen` «Reflexion nachtragen» / "Add reflection" / «Ajouter la réflexion», `log.reflectionDone` «Reflexion erfasst» / "Reflection recorded" / «Réflexion enregistrée», `log.openCount` «{{n}} offen» / "{{n}} open" / «{{n}} ouverte(s)», `log.showOpenReflections` «Offene Reflexionen anzeigen» / "Show open reflections" / «Afficher les réflexions ouvertes», `toolbar.reflectionsMissing` «Noch {{n}} Entscheidung(en) ohne Reflexion. …» / "{{n}} decision(s) still without a reflection. …" / «Encore {{n}} décision(s) sans réflexion. …»; `tourUi.reason.lead`/`.note` deleted; S12: `reflectionPrompt.more` deleted |
| `frontend/src/app/core/session.store.spec.ts` | a second decision waits while one is shown; dismiss keeps it open; submit stamps and shows the next; the refusal; the resets |
| `docs/experiment-logging.md` | the click id table, regenerated with `node frontend/scripts/data-log-ids.mjs`: `log.reflectionOpen`, `log.showOpenReflections`; S11: the screen table (`reflection` goes, `session` gains `reflection`) and how to read older records |
| `frontend/src/app/core/interaction-log/view-tracker.service.ts` / `.spec.ts` | S11: a waiting reflection as `detail.reflection` on `session`; S16: `detail.centerView` |
| `frontend/src/app/features/view-tabs/view-tabs.component.ts` | S16: sets `SessionStore.centerView` from the active tab |
| `frontend/src/app/features/proposal-compare/proposal-compare.component.spec.ts` | S15: the scroll stays inside the panel; S17: the shared stub |
| `frontend/src/app/features/decision-log/decision-log-panel.component.spec.ts` | S17: the shared stub |

### Removed files

| File | Why |
|---|---|
| `frontend/src/app/features/tour-reason-dialog/tour-reason-dialog.component.{ts,html,scss}` | D1 |

## 6. Verification

- Specs as in §5; the four CI checks (`lint:styles`, `i18n:check`, production
  build, `pytest -q`).
- In the running app (production build, Plan B deployment config), on
  `plan-b-p01`, leg 1: a decision in «Handlungsvergleich» shows the reflection
  at its top and the footer step keeps counting; a second decision before
  answering leaves the first open in the log; «Reflexion nachtragen» brings it
  back; «Szenario abschliessen» with one open is refused with the message and
  the highlight; after answering it, also with a bare «Nein», it finishes. The exported session record has
  `reflectedAt`/`reflectedAtStep` on the answered decision.
- `colearning-experiment` and the interview tour: the same, in their layout, including the guide's «Schicht beenden».
- A Recommendation tour: `rationale-capture` in its panel as today.
- S7: a briefing with `pauseOnReflection` set: the footer step stands while
  the reflection is shown and counts on after answering or ×; without the
  flag it counts on (picture 1).
- After pictures with the script, prefix `after`, next to the before ones.
- S22-S24 (D20-D22), on `plan-b-p01`, leg 1, and the interview tour: the log
  is the second panel of the right column and titled «Entscheidungsprotokoll
  und Reflexion»; a decision in «Handlungsvergleich» shows the reflection
  below the log's entries and none in «Handlungsvergleich»; a second decision
  only raises the open count; «Reflexion nachtragen» shows the chosen one
  there; the refused finish highlights the open entry. S24 retakes
  after pictures 1-4, 7 and 8 and the host pictures of §9.
- S25-S28 (D23-D27), same run: the right column reads «Lage»,
  «Handlungsoptionen», «Entscheidungsprotokoll und Reflexion»; taking a
  course closes «Handlungsoptionen» and the reflection opens in view with the
  decided options above its questions, marked «Entschieden · Schritt n»;
  «Handlungsoptionen» opens again for the next choice (Q14); a decision from
  the map shows its reflection without them. S28 retakes after pictures 1-4
  and 7.
- S8: a spec that a newer decision empties the short "why?". S9: a spec for
  the label after «Plan behalten». S10: specs that a decision asks a "why?"
  with a place in the layout and not without one, and the counting script
  on Recommendation study 3. S11: the Plan B recording of §9, finding 3,
  repeated: no `view_enter` with `view: 'reflection'`, and the clicks of
  steps 9-12 carry `view: 'session'`.

**Results (2026-11-05).** `i18n:check` (43 click ids, all keys), `lint:styles`
and the production build pass; the build's two warnings (the survey
component's `??`, the bundle budget) come from code this plan does not touch.
The frontend suite passes: 661 specs, 1 skipped. `pytest -q` was not run: no
backend change. In the running app, `plan-b-p01`, leg 1, with
`scripts/docshots-reflection-inline.mjs` on a production build of the working
tree:

| | Before (`main` 1e33088) | After (this branch) |
|---|---|---|
| Where the reflection is | dialog over the screen | top of «Handlungsvergleich» (S3); below the entries of «Entscheidungsprotokoll und Reflexion», between «Lage» and «Handlungsvergleich» (S22, S23) |
| Run while it is open | paused (step 8 → 8) | runs (step 10 → 11) |
| Label after «Plan behalten» | "Umleiten" | "Weiterfahren" |
| Decision log | count only | "1 offen", «Offene Reflexionen anzeigen», «Reflexion nachtragen» on the entry |
| «Szenario abschliessen» with one open | finishes | refused: «Noch 1 Entscheidung(en) ohne Reflexion. …», entry highlighted, run goes on |

| # | Before | After |
|---|---|---|
| 1 | ![before](reflection-inline/before-1-dialog.png) | ![after](reflection-inline/after-1-dialog.png) |
| 2 | <img src="reflection-inline/before-2-dialog-text.png" width="420"> | <img src="reflection-inline/after-2-dialog-text.png" width="420"> |
| 3 | <img src="reflection-inline/before-3-panel.png" width="420"> | <img src="reflection-inline/after-3-panel.png" width="420"> |
| 4 | <img src="reflection-inline/before-4-log.png" width="320"> | <img src="reflection-inline/after-4-log.png" width="320"> |
| 5 | ![before](reflection-inline/before-5-guide.png) | ![after](reflection-inline/after-5-guide.png) |
| 6 | ![before](reflection-inline/before-6-finish.png) | ![after](reflection-inline/after-6-finish.png) |
| 7 | – | ![after: finish refused](reflection-inline/after-7-refused.png) |

After 1, 6, 7 and the toolbar picture `after-8-toolbar-refused.png` (the
components table, cut from 7) are retaken on the rebased branch (`main` 7eef0cb): since
#174, Plan B asks no questionnaire after a scenario, so the stepper and the
finish button of its first scenario read «Szenario abschliessen → Walensee
Folgezug (2/2)» instead of «→ Fragebogen». The refusal is unchanged.

**S7 (2026-11-06).** The frontend suite passes with 670 specs; `i18n:check`,
`lint:styles` and the production build pass. In the running app, with
`pauseOnReflection` set on `colearning-experiment` in a local build only:
the step stands while the reflection is shown (7 → 7) and counts on after ×
(8 → 10). Without the flag it counts on (table above).

**S8-S11 (2026-11-06).** The frontend suite passes with 678 specs;
`i18n:check`, `lint:styles` and the production build pass. In the running
app:

- S11, the Plan B recording of §9 (finding 3) repeated: no `view_enter` with
  `view: 'reflection'`; the working screen gets `reflection: rationale` at
  step 7 and loses it after the answer at step 11; all clicks of steps 8-11
  (tab, Fahrplan, the answer) carry `view: 'session'`.
- S9, Co-Learning study 3 after «Plan behalten»: the short "why?" reads
  "IC_703 → Proceed", and its hypothesis "you prefer Proceed" (before:
  "Reroute"). Retaken in `host-1-co-learning-reflection.png` and
  `after-9-rationale-capture.png`.
- S8 and S10: specs only. Not checked in the running app: Recommendation
  study 3 asking nothing after an override.

**S22-S24 (2026-11-09).** The frontend suite passes with 716 specs (1
skipped); `i18n:check`, `lint:styles` and the production build pass, with
the same two warnings. In the running app, `plan-b-p01`, leg 1, Plan B
deployment config, 1600×1000: the reflection opens in the decision log, not
in «Handlungsvergleich», and the run goes on (step 9 → 11); the refused
finish names one open reflection and highlights its entry. With the log
below «Handlungsvergleich» (Q13 a) it was out of view right after the
decision; above it (Q13 revisited) the log and the reflection are in view,
and the options are one scroll down. The title is cut to
«Entscheidungsprotokoll und Reflex…» in the 30 % column (D22). After
pictures 1-4, 6 and 7 are retaken; 5 and 8 are unchanged.
`scripts/docshots-reflection-inline.mjs` finds the reflection in either
panel and scrolls an element into view for its picture, then back.

Not yet checked in the running app: a second decision while one is open,
finishing after a bare «Nein», the exported record's `reflectedAt`, leg 2,
`colearning-experiment`, the interview tour and a Recommendation tour. The
specs cover the first three.

## 7. Steps

| Done | ID | Step | Needs |
|---|---|---|---|
| ✅ | S1 | Store: open reflections, reopen by decision, stamps, refusal state, with specs | - |
| ✅ | S2 | Decision log: open/answered marks, open count, reopen | S1 |
| ✅ | S3 | Decision panel: inline reflection, dialog removed, logged label fix, texts | S1 |
| ✅ | S4 | Finish gates (toolbar, guide), message, highlight; «Offene Reflexionen anzeigen» in the log | S1, S2 |
| ✅ | S5 | Rename to «Handlungsvergleich» (de, en, fr, briefings, catalog) | - |
| ✅ | S6 | Docs and after screenshots | S2-S5, S7 |
| ✅ | S7 | `pauseOnReflection`: flag, the pause effect in `AppComponent`, spec; no tour sets it (Q7) | S1, S3 |
| ✅ | S8 | Short "why?" starts empty for a new decision, with a spec (finding 21) | - |
| ✅ | S9 | Short "why?" names the logged course, through one lookup shared with the reflection prompt (findings 12, 10), with a spec | - |
| ✅ | S10 | Ask a "why?" only where a place can show it: a panel in the layout, expanded or collapsed (finding 20, D16) | - |
| ✅ | S11 | Log a waiting reflection as `session` with `detail.reflection`, in every mode; specs for the screen log and a click's `view`; the table in `docs/experiment-logging.md` (finding 3, D17) | - |
| ✅ | S12 | The reflection shows all its questions, without «Weitere Fragen», in every reason tour; spec; retake `after-2-dialog-text.png` (finding 23, D18) | - |
| ✅ | S13 | Plan B's decision log starts open; spec; retake `after-4-log.png` (finding 24, D4) | - |
| ✅ | S22 | The reflection of a reason tour in the decision log, below its entries; «Handlungsvergleich» without it; the log as a reason tour's place (`reflectionPlaceInLayout`, S18's spec); the `reflect` hints; specs (D20) | - |
| ✅ | S23 | The log in the right column, above «Handlungsvergleich», in both reason-tour layouts; title «Entscheidungsprotokoll und Reflexion» (de, en, fr, `STOCK_PANEL_TITLES`); S18's spec checks the column (D21, D22) | - |
| ✅ | S24 | Retake the after pictures (the host pictures show other places and stay); this plan's results | S22, S23 |
| | S25 | Rename «Handlungsvergleich» to «Handlungsoptionen» (de, en, fr, the texts that quote it, catalog, `STOCK_PANEL_TITLES`) (D24) | - |
| | S26 | The decision panel above the log again; it closes after a course is taken and opens for the next choice, through `PANEL_FRAME`; specs (D23, D25) | - |
| | S27 | Decided options: `ProposalSnapshot` in the store, the read-only form of the decision panel, shown in the reflection with «Entschieden · Schritt n»; specs (D26, D27) | S26 |
| | S28 | Retake the after pictures; this plan's results | S25-S27 |

Each step passes the CI checks on its own. S1-S5 and S7 went in as one
commit (Carried out). Finding 13's fix is in S3, which removes the pause.
Findings 21, 12 (with 10), 20 and 3 are fixed in S8-S11, 23 and 24 in S12
and S13, 5-9, 11, 18 and 22 in S14-S20, 25 in S21 (§7.1); 19, 26 and 27
are follow-ups. S22-S24 build requirements 9-11 (Q13); S22 and S23 share hunks and went in
as one commit, 044bd0b. S25-S28 build requirements 12-16.

### 7.1 Refactorings and cleanup ✅

The open code review findings, one commit each; fixes first, then the
refactoring, then tests and comments.

| Done | ID | Finding | Change | Tests |
|---|---|---|---|---|
| ✅ | S14 | 5 | `SessionStore.reflectionsMissing` becomes a `computed`: how many of the reflections open at the refused finish are still open (`_refusedSeqs`). It counts down as they are answered, is 0 once all are, and a decision taken after the refusal does not bring the message back. The effect that zeroed it goes. | Store spec: refused with three open, two answered, the count says 1 (it said 3). The existing refusal and reset specs. |
| ✅ | S15 | 9 | `ProposalCompareComponent` scrolls the panel body (`.layout-panel-shell__body--scroll`) to the reflection, only when it is out of view, instead of `scrollIntoView`, which moved every scrolling ancestor. The timer is cleared in the effect's cleanup, so it cannot fire after the panel is gone. Outside a panel shell nothing scrolls. | Spec of the exported helper: the panel body scrolls, the column around it does not. |
| ✅ | S16 | 22 | `SessionStore.centerView`, set by `ViewTabsComponent` from its active tab (`zug-weg-diagramm`, `flatland-map`, …). The working screen `session` gets `detail.centerView` while it is set; `centerTab` stays as it is, since the replay reads it. `docs/experiment-logging.md` lists the field. | View tracker spec: the tab id is logged, and switching tabs writes a new screen entry. The existing specs, which have no tab, are unchanged. |
| ✅ | S17 | 7, 11 | `TourContextService.refuseFinish()`: in a tour that asks for reasons, refuse while reflections are open. `finishDemoMode()` and the guide's `endShift()` call it; its comment names the ways to end that need no gate (Director's «Schicht beenden», `finishExperiment` after the leg). The specs share `provideTourContextStub(reasonDialog)` in `src/app/testing/`. | App spec: `finishDemoMode()` is refused with an open reflection and goes on once it is answered. The guide, log and decision panel specs on the shared stub. |
| ✅ | S18 | 6 | New spec: every tour and study condition whose briefing sets `reasonDialog` pins a layout with the decision panel (`proposal-compare`) and does not run Director, so «Reflexion nachtragen» always has a place (§1.2). | The new spec. |
| ✅ | S19 | 8 | The comments on `openReflections` and `reopenRationale` say that a new decision never replaces the reflection being typed, but reopening another one from the log does, and the prompt then starts empty (§1.1, follow-up in §1.3). No `TODO`: the follow-up has no issue yet. | None (comments only); the existing specs. |
| ✅ | S20 | 18 | Code comments, specs and the screenshot scripts name the plan's sections and decisions (§4.1, D3, D16) instead of #160 or a finding number, and say in words what changed ("before the reflection moved into the panel"). | None (comments only); the existing specs. |
| ✅ | S21 | 25 | Prose this PR adds says ZWL, as #173 (now in `main`) does everywhere else: "the ZWL tours" (Carried out, §1.5, finding 20), "ZWL" in the table of decision sources (finding 3), the app spec's `withContext`. Where the logged view type `zug-weg-diagramm` is named (`docs/experiment-logging.md` for `centerView` and `panel.view-tabs.tab`, the `SessionStore.centerView` comment), it is called the ZWL's and the value stays, as the stored and logged ids of #173 do (AGENTS.md). Ids in the plan (`preset-olten-zug-weg`, tour ids, `views.zugWeg`) stay. | None (prose and a spec's context text); the existing specs. |

## 8. Open questions

- ✅ ~~**(Q14) When does «Handlungsoptionen» open again after a choice?**~~
  **Decided 2026-11-09** by the maintainer: a), in every layout, whenever
  new options come up (D25, S26).
  (requirement 14, D25.) It closes once a course is taken. "When a new
  choice is due" needs a signal the panel can see.
  - a) When the selected train changes (another train, or the same one
    picked again in the map, Fahrplan or ZWL), or when a new train appears
    in «Lage: Risiko & Auswirkung» (a new conflict, the rule that panel
    already opens itself by).
  - b) Only when the selected train changes.
  - c) Only on a new conflict.
  - Scope: in every layout that shows the panel, or only in tours that ask
    for reasons.

  *Proposal:* a), in every layout: picking a train is how a participant
  starts a choice, and a new conflict is a choice due even before they pick
  one; one rule wherever the panel is.
- ✅ ~~**(Q15) The English and French titles of «Handlungsoptionen»?**~~
  **Decided 2026-11-09** by the maintainer: as proposed (D24, S25).
  (requirement 13, D24.) *Proposal:* en «Action options», fr «Options
  d'action» (native review as D11).
- ✅ ~~**(Q3) revisited: may a panel open or close on its own?**~~
  **Decided 2026-11-09** by requirement 14: the decision panel closes after a
  choice and opens for the next one (D25). D10 stays for the log: a
  collapsed log stays collapsed when a reflection arrives.

- ✅ ~~**(Q13) Where is the reflection asked, now that it leaves «Handlungsvergleich»?**~~
  **Decided 2026-11-09** by the maintainer (requirements 9-11): when it
  appears a) (D20, S22); where in the right column a), revisited the same
  day to b) (D21, S23). The
  maintainer asked to move the log to the right column, rename it
  «Entscheidungsprotokoll und Reflexion», and show and answer the reflection
  there, below the entries, and no longer in «Handlungsvergleich»; in
  general, not only for Plan B. Two points were open:
  - **When it appears.** a) By itself when no reflection is shown, else it
    only joins the open ones and their count; one at a time below the
    entries (D3 unchanged). b) Only on «Reflexion nachtragen»: about three
    store lines, and `detail.reflection` would mean "a form is open"
    instead of "a reflection waits" (D17).
  - **Where in the right column.** a) Below «Handlungsvergleich»: assess,
    decide, reflect; the form may open below the visible part of the column
    (§1.1). b) Between «Lage» and «Handlungsvergleich». c) At the top.
    Each is a reordering of the preset's panels.
  - **Revisited 2026-11-09, b).** Built as a), the pictures at 1600×1000
    showed the log below the visible part of the column right after a
    decision, with almost no height, so the reflection opened out of view.
    Of b), scrolling the column to the log (the movement finding 9
    removed), shrinking the panels above, or another place for the log,
    the maintainer chose b): both the reflection and the options stay in
    view without anything moving on its own; the options move down by the
    log's height.

- ✅ ~~**(Q12) Does the reflection show all its questions?**~~ **Decided
  2026-11-07** by the maintainer: a), in every reason tour (D18, S12).
  (finding 23; asked by the product owner, @CleverManu, on 2026-11-06.) Today the
  prompt shows the reason chips and two of three questions, drawn per
  decision; the third sits behind «Weitere Fragen (1)», which participants
  overlook. The number is the per-browser Setting `reflectionQuestionLimit`
  (2), shared with the Co-Learning reflection panel.
  - **Scope.** The prompt (`ReflectionPromptComponent`) is shown only in the
    tours that ask for reasons, so any change applies to all of them, not
    only Plan B: the interview tour (`co-learning-cost-benefit`), the
    `colearning-experiment` and Plan B, with their English variants (§2),
    and the catalog panel `reflection-prompt` in a hand-built layout. The
    short "why?" (`rationale-capture`) and the Co-Learning reflection panel
    have their own questions and stay as they are.
  - **What is configurable today.** Only the Setting «Angezeigte
    Reflexionsfragen» (Session Settings, 1-5, stored per browser in
    `localStorage`). Set to 3, it already shows all three questions and no
    «Weitere Fragen», without code, but it is set by hand on each machine, the
    deployment file (`ui-config.json`) cannot set it, and it also changes the
    Co-Learning reflection panel. Nothing sets it per tour or per condition.
  - a) Show all three in every reason tour, in the drawn order; «Weitere
    Fragen» goes (S12). The reflection gets longer, every question stays
    optional.
  - b) Keep the code, and set the Setting to 3 on the lab machines. No
    change in this PR; Plan B and the interview tour only differ by machine.
  - c) Show all three only under Plan B: a new per-tour field next to
    `reasonDialog` (e.g. `TourBriefing.allReflectionQuestions`). Not built;
    a new setting for one condition.
  - d) Keep it, and answer the comment with the reason ("a few questions, so
    a run is not a questionnaire").

  *Proposal:* a). It is what the comment asks, it applies the same way in
  every reason tour (one rule, D13), and it needs no new setting.
- ✅ ~~**(Q1) revisited: Plan B's decision log open by default?**~~
  **Decided 2026-11-06** by the product owner's PR comment, recorded
  2026-11-07: a), the log starts open under Plan B (D4, S13). (finding 24;
  @CleverManu, 2026-11-06: "Now that the content is relevant for the
  reflection, it should be shown by default."). Q1 decided "collapsed" (D4),
  following issue #145 item 2 ("Hide the Decision Log, or collapse it by
  default"), so Plan B shows no readback of past decisions to reason from
  (`configurable-ui-plan.md` §5.2). Since #160 the entries carry «Reflexion
  nachtragen», which requirement 3 needs.
  - **Scope and what is configurable today.** The verb `collapsedByDefault`
    is built (issue #145, PR #146): a preset's `ui` block or the deployment
    file (`ui-config.json`) can name `widget.decision-log`. The default
    everywhere is open; only `PLAN_B_UI` collapses it, and
    `ui-configs/plan-b.json` does not. So a) changes Plan B only: every other
    setup already starts open. A deployment can still collapse it, for every
    condition at once.
  - a) Start open: `PLAN_B_UI` drops `collapsedByDefault`. The
    participant sees past decisions and their reasons, which #145 item 2 left
    out; the design principle "this plan adds nothing to `PLAN_B_UI`" changes
    to "removes one item".
  - b) Open only while reflections are open. Moves the layout on its own,
    against D10.
  - c) Keep D4, and answer the comment: the open count and «Offene
    Reflexionen anzeigen» lead to the open entries.

  *Proposal:* a), taken.

- ✅ ~~**(Q9) What happens to a "why?" asked where no place can show it?**~~
  **Decided 2026-11-06:** b), don't ask there; the decision is logged without
  a reason, like an AI or system decision (finding 20, D16). The layouts stay
  as they are. Not taken: a) keep asking a "why?" nobody sees; c) add the
  short "why?" to those layouts.
- ✅ ~~**(Q9) revisited: what counts as a place that can show it?**~~
  **Decided 2026-11-06:** a), a panel in the layout counts, expanded or
  collapsed: the panel itself is on screen even when its content is not
  rendered (D16). Q9 b was
  worded "while a place is rendered". A collapsible panel renders its content
  only while it is expanded (`panel-shell.component.html:51`). So «Handlungsvergleich»
  collapsed in Plan B (which D10 keeps collapsed) or the Co-Learning
  reflection panel collapsed in study 3 (its default) would stop the
  questions: a participant could skip reflections by collapsing a panel, and
  requirement 4 would no longer hold.
  - a) A place counts while its panel is in the layout, expanded or
    collapsed: the panel types `proposal-compare` (reason tours only),
    `reflection-prompt`, `co-learning-reflection`, `recommendations` in the
    active layout, and in the system layout the mode's own panel. Needs the
    active layout's panel types; how the system layout appears there is still
    to be checked.
  - b) A place counts only while rendered (expanded), as worded.

  *Proposal:* a). It keeps D10 and requirement 4; b) lets collapsing a panel
  switch reflections off.
- ✅ ~~**(Q11) Log a shown reflection as part of the working screen?**~~
  **Decided 2026-11-06:** a), everywhere (D17, S11). (finding
  3; changes the logs of every condition, so the study lead, @SamiraAPS,
  decides).
  - a) Everywhere: the working screen `session` gets `detail.reflection =
    <kind>`; the screen `reflection` goes.
  - b) Only in reason tours.
  - c) Keep the screen `reflection`, and document that it means "a reflection
    waits", not "a reflection screen".

  *Proposal:* a), as a breaking change for the analysis in §1.5.
- ✅ ~~**(Q10) Which place shows a "why?" when several are rendered?**~~
  **Decided 2026-11-06:** no order in this PR (D15). The problem exists on
  `main` unchanged and #160 does not worsen it in any shipped setup, so which
  panels a condition shows stays the study designer's choice; an order can
  follow if a study needs one (§1.3). Not taken: a fixed order, the
  decision's own panel, the code's per-mode rule, or fixing only the label
  and the self-opening panel. Facts and pictures: §9, "Findings 19-21".

- ✅ ~~**(Q6) When does `pauseOnReflection` pause?**~~ **Decided 2026-11-06:**
  a), while a reflection is shown (D14).
  - a) While a reflection is shown, as the dialog did. × resumes the run and
    leaves the reflection open in the log.
  - b) While any reflection is open, shown or not. × no longer resumes, so the
    run stands until every decision is answered.

  *Proposal:* a). It is the old behaviour, and b) makes × pointless.
- ✅ ~~**(Q7) Which tours set it?**~~ **Decided 2026-11-06:** a), none for now
  (D14). For the product owner (@CleverManu) or the study lead to change.
  - a) None for now: #160 asks for no pause, and the flag waits for a study
    that needs it.
  - b) The interview tour (`co-learning-cost-benefit`, `-en`), where the
    interviewer may want the run to stand while the interviewee explains.
  - c) Others from the table in §4.7.

  *Proposal:* a). A tour that sets it also needs its own `reflect` hint,
  because the shared one says the run keeps going.
- ✅ ~~**(Q8) Does the flag work without `reasonDialog`?**~~ **Decided
  2026-11-06:** a), only together with `reasonDialog` (D14).
  - a) Only together with `reasonDialog`: the reflection then has its place in
    the decision panel, and the finish gate applies.
  - b) In any tour. Outside reason tours the short prompt
    (`rationale-capture`) sits in a panel that may be collapsed or missing, so
    the run could stand with no visible reason.

  *Proposal:* a).

- ✅ ~~**(Q2) Does «Nein» count as a reflection?**~~ **Decided 2026-11-05:**
  a), «Nein» counts as it is now, with or without a reason chip (D12). A
  participant can therefore clear an open reflection without a reason; the
  record shows it (§1.1).
- ✅ ~~**(Q4) Does the interview tour (`co-learning-cost-benefit`) also refuse
  to finish?**~~ **Decided 2026-11-05:** a), yes, like every `reasonDialog`
  tour (D13). It is a tour, not an experiment run, so the gate sits in
  `finishDemoMode()` and the guide (§4.4).
- ✅ ~~**(Q1) Plan B's decision log: open or collapsed by default?**~~
  **Decided 2026-11-05:** collapsed by default with all entries reachable, a
  header that opens them and a count of open reflections (D4). The header
  toggle came with #150; the count is this plan's.
- ✅ ~~**(Q3) What if the decision panel is collapsed when a reflection
  arrives?**~~ **Decided 2026-11-05:** it stays collapsed, and a button
  «Offene Reflexionen anzeigen» next to the log's open count opens the
  entries and highlights the open ones, built in S4 (D10, §4.3).
- ✅ ~~**(Q5) English and French title.**~~ **Decided 2026-11-05:** «Action
  comparison» / «Comparaison des actions», French to a native reviewer (D11).

## 9. Code Review Findings

PR [#176](https://github.com/flatland-association/flatland-ui-hub/pull/176),
based on `main` 7eef0cb (1e33088 until the rebase on 2026-11-06; the SHAs
below are the rebased ones). Code review findings (1-11) were added on 2026-11-05,
at de9d762 with steps S1-S6 not yet committed; their line numbers refer to
that working tree. Finding 12 (2026-11-06) was found while taking the
component screenshots, finding 13 (2026-11-06) while checking which setups
pause. PR review comments (14-17) were added on 2026-11-06; finding 18
(2026-11-06, at f977f7c) comes from checking the code for references to the
issue, findings 19-21 (2026-11-06, at f977f7c) from checking that each
reflection shows in one place and that every consumer reacts the same way,
finding 22 (2026-11-06) from the recording for Q11. Findings 23 and 24
(added 2026-11-07) are comments of 2026-11-06 in the PR's conversation, not
review threads: each is a checkbox, "resolved" once it is ticked. Finding
25 (added 2026-11-09) is a PR review thread of 2026-11-08; 26 and 27
(added 2026-11-09) are conversation comments of 2026-11-09. Status
checked on 2026-11-07 at a16424e: no new review threads or comments, both
checkboxes ticked, and the PR adds no `TODO` lines in the code. Sources: a
`/code-review` pass, a review against this plan, and the PR's review threads
and conversation comments.

Fixed: ✅ fixed; ⏭️ open and taken over by a follow-up (§1.3); — dropped;
⚠️ resolved on GitHub without a code change and without a reason; empty:
open. "resolved" in Source marks threads resolved and checkboxes ticked on
GitHub, and conversation comments answered with a decision (26); ❌ next to ✅ marks a finding fixed in the code whose PR comment is
not resolved on GitHub yet.

| Fixed | ID | Source | Category | Severity | Finding | Commit message |
|---|---|---|---|---|---|---|
| ✅ | 1 | code review | bug | low | `frontend/src/app/core/operator-model-bridge.service.ts:24,92`, `frontend/src/app/core/session.store.ts:892`: the bridge holds back only the reflection *shown* (`pendingRationale`) before it reports a decision to the operator model. A decision that waits in `openReflections`, or was closed with ×, is reported at once without its answer and marked reported, so a later «Ja, als Regel» never calls `recordLearning`. The cause is two writable signals for one fact, kept in step by hand at 13 places. Low because only the Director-only `co-learning-effect` panel creates the bridge: Plan B and the interview tour never run it, and a new leg starts with no open reflections. On `main` a closed reflection answered later was lost the same way. Fix: `openReflections` the only stored list, `pendingRationale` derived from it, the bridge holding back every open decision (diagram and fix below the table). Fixed in f977f7c: `pendingRationale` is derived from `openReflections` and `_shownSeq`, and the bridge holds back every open decision; new `operator-model-bridge.service.spec.ts`. | feat(reflection): ask the reflection in «Handlungsvergleich» without pausing the run. |
| ✅ | 2 | code review | bug | high | `frontend/src/app/app.component.ts:1283`, `frontend/src/app/features/tour-debrief/tour-debrief.component.ts:268`: in a tour that is not an experiment run (the interview tour, gated since Q4), the episode ending on its own opens the debrief, which hides the panels (`is-behind`), and its way back is off once `episodeDone`. With a reflection still open, the finish is refused and the reflection can no longer be reached: the tour cannot be finished. Plan B is not affected (no debrief between legs while `running`). Fix: show the open reflection in the debrief, or let the debrief's finish open the shift again while reflections are open. Fixed in f977f7c, option a): `AppComponent.shiftScreenOpen()` stays closed while `reflectionsMissing() > 0`, so a refused finish brings the working screen back; the debrief opens again once all are answered. No spec: `AppComponent` has none for the shift screen (finding 11). | feat(reflection): ask the reflection in «Handlungsvergleich» without pausing the run. |
| ✅ | 3 | code review | design | medium | `frontend/src/app/core/interaction-log/view-tracker.service.ts:68-70`, `frontend/src/app/core/interaction-log/click-log.service.ts:72`: a reflection that is shown counts as a screen of its own, `reflection`, in every mode and for all three kinds (`rationale`, `co-learning`, `strategy`). Since #160 none of them is an overlay: each sits in a panel while the participant goes on working. The screen log books that time as "reflection" and drops map/Marey switches and guide steps, every click made meanwhile carries `view: 'reflection'`, and the replay misses those switches. Outside the reason tours this was so on `main` too. Proposal: the working screen `session` with `detail.reflection = <kind>`, everywhere (details and tables below). Changes the logs of every condition. Fixed in c491fb6 (S11): `session` with `detail.reflection`; checked with the Plan B recording. | fix(view-tracker): log a shown reflection as part of the working screen. |
| ✅ | 4 | code review | design | medium | `frontend/src/app/core/session.store.ts:1403`: the queue applies in every session, not only in `reasonDialog` tours. With `rationale-capture` (Recommendation, the Co-Learning reflection panel) a new decision no longer replaces the shown prompt, and closing one shows an older one out of context. The plan says these stay unchanged (§1.3). Fix: keep the old replace-and-forget behaviour unless the tour asks for reasons, e.g. `_askReflection` taking a `queue` flag set by a store signal the app syncs from `tour.reasonDialog()`. Fixed in f977f7c: `SessionStore.queueReflections`, set by `AppComponent` from `tour.reasonDialog()`; off, a new decision replaces the shown one and × drops it, as on `main`. | feat(reflection): ask the reflection in «Handlungsvergleich» without pausing the run. |
| ✅ | 5 | code review | bug | medium | `frontend/src/app/core/session.store.ts:1379,1389`, `frontend/src/app/features/toolbar/toolbar.component.html:101`: `reflectionsMissing` freezes the count at the refused click, so after answering two of three the message still says 3. It is also stored state with an effect only to zero it. Fix: a `finishRefused` flag and `computed(() => finishRefused() ? openReflections().length : 0)`, no effect. Fixed in 1e6151b (S14): `reflectionsMissing` is a `computed` over the reflections open at the refusal, with a spec. | fix(reflection): count the missing reflections live after a refused finish. |
| ✅ | 6 | code review | robustness | low | `frontend/src/app/features/proposal-compare/proposal-compare.component.ts:93`: a reflection reopened from the log only shows in the decision panel, and not in Director. After a mode switch, or with the panel collapsed or absent, «Reflexion nachtragen» does nothing visible while finishing is refused. Covered by §1.2's assumptions (Co-Learning only, the panel is in the layout), which are not checked in code. Proposal: keep the assumption, and expand nothing (D10); add a test that the `reasonDialog` layouts place the panel. Fixed in c566b8f (S18): `core/demo/reason-tours.spec.ts` checks every reason tour's layout. | test(layout): assert that every reasonDialog layout places the decision panel. |
| ✅ | 7 | code review | design | low | `frontend/src/app/app.component.ts:1283`, `frontend/src/app/features/tour-guide/tour-guide.component.ts:77`: the finish guard is repeated in the two callers. Other ways to end a shift (`director-directive`'s «Schicht beenden», `finishExperiment`) do not check it; today they run only in Director or after the leg is finished. Proposal: one `canFinish()` on `TourContextService`, used by both, with a comment naming the paths that need no gate. Fixed in 215055b (S17): `TourContextService.refuseFinish()`, used by both, with a comment on the paths that need no gate. | refactor(tour): check open reflections in one place before finishing. |
| ✅ | 8 | code review | robustness | low | `frontend/src/app/core/session.store.ts:1356,1369`: `reopenRationale(seq)` replaces a reflection being typed, and the prompt resets, contradicting the comment that typed text is never replaced. Listed in §1.1 as a limitation, without the `TODO` it promises. Fix: add the `TODO` and say "a new decision never replaces" in the comment. Fixed in 6aed56c (S19): the comments on `openReflections` and `reopenRationale` name the case; no `TODO`, as the follow-up in §1.3 has no issue yet. | docs(reflection): name the reopen case that drops typed text. |
| ✅ | 9 | code review | robustness | low | `frontend/src/app/features/proposal-compare/proposal-compare.component.ts:133`: `scrollIntoView` scrolls every scrolling ancestor, so a new reflection can move the right column (seen in the after screenshots: the panel above loses its title), and the uncleared `setTimeout` can fire after the panel is destroyed. Fix: scroll only the panel's own body, or drop the scroll. Fixed in b7fcacf (S15): `scrollIntoPanel` scrolls the panel body only, and the timer is cleared in the effect's cleanup. | fix(proposal-compare): scroll only the panel when a reflection appears. |
| ✅ | 10 | code review | refactor | low | `frontend/src/app/features/reflection-prompt/reflection-prompt.component.ts:113,143`, `frontend/src/app/core/session.store.ts:1277`: the logged-label lookup is written twice (prompt and `submitRationale`), and `strategyLabel()` only wraps `label()`. Fix: one store method `strategyLabelFor(pending)` used by both. Fixed in d1e8adc (S9): `SessionStore.rationaleLabel`. | fix(rationale-capture): name the course actually taken. |
| ✅ | 11 | code review | test-coverage | low | `frontend/src/app/app.component.ts:1283`: the gate in `finishDemoMode()` has no test, and the `TourContextService` stub is repeated in four spec files. Fix: a spec for the gate, and a shared `provideTourContextStub(reasonDialog)` in `src/testing/`. Fixed in 215055b (S17): the app spec covers the gate in `finishDemoMode()`, and the specs share `provideTourContextStub`. | refactor(tour): check open reflections in one place before finishing. |
| ✅ | 12 | screenshots | bug | medium | `frontend/src/app/features/rationale-capture/rationale-capture.component.ts:73,78`: the short "why?" prompt shows the same wrong label as D8 fixed in the reflection: after «Plan behalten» in the decision panel it says "IC_703 → Reroute" and "you prefer Reroute", because it calls `strategyLabelForAction(p.action, t)` without the logged choice. Seen on 2026-11-06 in `preset-colearning-study3`, a study condition, so participants of that condition read a hypothesis about a course they did not take. On `main` too. Fix: the same lookup as the reflection, best through the one store method of finding 10. Fixed in d1e8adc (S9): one lookup, `SessionStore.rationaleLabel`, for both prompts and the record; checked in the running app. | fix(rationale-capture): name the course actually taken. |
| ✅ | 13 | review against this plan | docs | low | `frontend/src/app/core/demo/tour-briefings.ts:241,597`: the guide step «Reflexion» still said "Nach deiner Entscheidung hält die Simulation an" (and "the simulation pauses" in English). All eight `reasonDialog` briefings show it (§2), so after #160 the guide contradicts the running clock. Fixed in f977f7c: both hints now say the decision panel asks while the simulation keeps running, and that the decision log shows open reflections, all of which must be answered before finishing. | feat(reflection): ask the reflection in «Handlungsvergleich» without pausing the run. |
| ✅ | 14 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#discussion_r4483074726), resolved | design | medium | `docs/plans/reflection-inline.md:524` (at de9d762): which option for Q2, does «Nein» count as a reflection? @CleverManu: a), leave it as it is; the module will be rephrased, and «Nein» may go. Fixed in de9d762: recorded as Q2 a and D12. | docs(plans): record the decisions on Q2, Q3 and Q4 for #160. |
| ✅ | 15 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#discussion_r4483076853), resolved | design | medium | `docs/plans/reflection-inline.md:533` (at de9d762): which option for Q4, does the interview tour refuse to finish too? @CleverManu: a). Fixed in de9d762: recorded as Q4 a and D13. | docs(plans): record the decisions on Q2, Q3 and Q4 for #160. |
| ✅ | 16 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#discussion_r4485910809), resolved | design | medium | `docs/plans/reflection-inline.md:260` (at de9d762): D6, finishing with open reflections is refused; @CleverManu agreed. Fixed in f977f7c: built as decided (§4.4). | feat(reflection): ask the reflection in «Handlungsvergleich» without pausing the run. |
| ✅ | 17 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#discussion_r4485915765), resolved | design | medium | `docs/plans/reflection-inline.md:261` (at de9d762): D7, `reflectedAt` and `reflectedAtStep` stamped on the decision; @CleverManu agreed. Fixed in f977f7c: built as decided (§4.1). | feat(reflection): ask the reflection in «Handlungsvergleich» without pausing the run. |
| ✅ | 18 | code review | docs | low | `frontend/src/app/app.component.ts:462,1207-1208,1216`, `frontend/src/app/core/demo/tour-briefings.ts:120`, `frontend/src/app/core/i18n/panel-titles.ts:51`, `frontend/src/app/core/operator-model-bridge.service.ts:51`, `frontend/src/app/core/operator-model-bridge.service.spec.ts:12-14,64`, `frontend/src/app/core/session.store.ts:893,1354-1355,1369,1376`, `frontend/src/app/core/session.store.spec.ts:137`, `scripts/docshots-reflection-inline.mjs:1,6`: comments name issue #160, which the PR closes, and the plan's finding numbers ("finding 1", "finding 4"). Once merged they point at a closed issue and at table rows that are not a stable reference. Fix: name the plan's sections and decisions (§4.1, D3, §4.7) instead, and say what happened before in words ("as before the reflection moved into the panel"). Fixed in ba64e47 (S20): no comment names #160 or a finding number any more. Before: at a4b1d09 the S8-S11 commits added more of them, now also at `app.component.ts:1229-1230,1263`, `session.store.ts:1364-1365,1379,1386`, `session.store.spec.ts:146` and `scripts/docshots-reflection-hosts.mjs:1`. | docs(reflection): point code comments at the plan's sections, not at the issue or its findings. |
| ✅ | 20 | code review | robustness | medium | `frontend/src/app/core/session.store.ts:2209`, `frontend/src/app/core/layout/layout-presets.ts` (`preset-recommendation-study3`, `preset-olten-zug-weg`, `preset-zug-weg-corridor`): in Recommendation a human override with an AI suggestion asks a "why?", but these layouts (and the `recommendations-classic` variant) have no place to show it. The participant never sees it, the screen log says "reflection" until the next decision replaces it (finding 3), and the decision gets no reason. Affects the study condition "Recommendation · User Study 3" and the two ZWL tours. From the code, not checked in the browser. On `main` too. Fixed in cadade1 (S10): `AppComponent.reflectionPlaceInLayout` sets `SessionStore.reflectionPlaceInLayout`; specs for the system layout, presets with and without a place, and Plan B. | fix(reflection): ask a reflection only where a place can show it. |
| ✅ | 21 | code review | bug | medium | `frontend/src/app/features/rationale-capture/rationale-capture.component.ts:61-63,124-130`: the short "why?" keeps its chips and note until it is answered or closed. Outside reason tours a newer decision replaces the shown one (finding 4), so the reasons picked for the first decision are still selected for the second and are saved with it. `ReflectionPromptComponent` starts empty for a new decision (`reflection-prompt.component.ts:128`). On `main` too. Fix: the same reset when `decisionSeq` changes, with a spec. Fixed in 37659fd (S8): the same reset when `decisionSeq` changes, with a spec. | fix(rationale-capture): start empty for a new decision. |
| ✅ | 22 | Q11 recording | robustness | low | `frontend/src/app/core/interaction-log/view-tracker.service.ts:89`: the working screen's `centerTab` is `marey`, `map` or `other`, and Plan B's two tabs, ZWL and Streckenspiegel, both log `map` (recorded 2026-11-06: `centerTab: map` while ZWL was shown). So the screen log cannot say which of the two a participant looked at; the click stream has the tab clicks (`views.zugWeg`, `views.map`). On `main` too. Fix: log the selected tab id. Fixed in c231013 (S16): the working screen logs `detail.centerView`; `centerTab` stays for the replay. | fix(view-tracker): log which centre tab is shown. |
| ✅ | 23 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#issuecomment-6694219338), resolved | design | medium | `frontend/src/app/features/reflection-prompt/reflection-prompt.component.ts:102`, `reflection-prompt.component.html:55-57`: the reflection shows the suggested questions and hides the rest behind «Weitere Fragen (1)» (`showMore` starts `false` and is reset for each decision, `:188`). @CleverManu: it should be expanded; collapsed, the question is not visible and will be overlooked. Fixed in b484221 (S12, Q12 a, D18): all three questions show, in every reason tour. | fix(reflection-prompt): show all questions of a reflection without «Weitere Fragen». |
| ✅ | 24 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#issuecomment-6694427791), resolved | design | medium | `frontend/src/app/core/layout/layout-presets.ts:709`: under Plan B the decision log starts collapsed (`collapsedByDefault: ['widget.decision-log']`, from #150), so its entries are hidden behind «Einträge anzeigen». @CleverManu: now that the entries matter for the reflection, they should be shown by default. This reverses D4 (Q1, decided 2026-11-05: collapsed by default). Fixed in a16424e (S13, D4, revised by this comment): Plan B's log starts open. | feat(layout): show the decision log's entries by default under Plan B. |
| ✅ | 25 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#discussion_r4508198676), resolved | docs | low | `docs/experiment-logging.md:181`: "zug-weg should be renamed (see #178)" (@CleverManu, 2026-11-08). #178 (for #173) renamed the Zug-Weg-Diagramm to the ZWL in code and docs on `main`; this PR, rebased on it, still adds "Zug-Weg" in prose (`docs/plans/reflection-inline.md:46,293,1048,1359`, `frontend/src/app/app.component.spec.ts:188`). The `centerView` value `zug-weg-diagramm` is the widget type, a logged id that #173 keeps until the study is over (its D1), so it stays and is named as the ZWL's (D19). Fixed in 6cb438b (S21). Checked 2026-11-09 against `docs/plans/zwl-rename.md` at 6cb438b: every "zug-weg", "zugweg" and "Zug-Weg" left in the tree is a kept id of its §4.3 (widget type, UI-config id, ActionOrigin, tour, briefing, preset and panel ids, i18n keys, the legacy title, all pinned by `stored-ids.spec.ts`) or history it keeps on purpose (§4.4: `tours-experiments-cleanup.md` §4, `zwl-improvements-briefing.md` §7.2, `widget-b4-zwl.md:9`, `docs/delegation/`). This PR adds only kept ids. Still open in #173, not here: the uses only on `explore_db` (its Q2) and the id rename after the study (its D1). | docs(zwl): say ZWL in what #160 adds, now that #173 is in main. |
| ⏭️ | 26 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#issuecomment-6734371702), resolved | design | low | `frontend/src/app/features/reflection-prompt/reflection-prompt.component.ts:49,99`: "Weshalb ist die Reihenfolge im Reflexionsmodul unterschiedlich?" (@CleverManu, 2026-11-09). `pickQuestions` shuffles the gut feeling, missing information and drawback questions, seeded by the decision's timestamp: fixed per decision, different between decisions. Built that way in 1504c722 (2026-09-19), where it drew two of the three questions per decision and put the third behind «Weitere Fragen»; since D18 shows all of them, the shuffle only changes their order. Taken over by a follow-up (§1.3, [#182](https://github.com/flatland-association/flatland-ui-hub/issues/182)), decided 2026-11-09 by the maintainer, out of scope for this PR; answered in the [reply](https://github.com/flatland-association/flatland-ui-hub/pull/176#issuecomment-6736907460). The comment's second point, that the reflection opens above the options it does not match, is taken up by requirement 10 (D20, S22). | fix(reflection): ask the reflection's questions in a fixed order. |
| ⏭️ | 27 | [PR comment](https://github.com/flatland-association/flatland-ui-hub/pull/176#issuecomment-6734412086) | design | low | `frontend/src/app/features/decision-log/decision-log-panel.component.html`: "Und ev. wäre es hilfreich die Entscheidungen anklicken und nochmals anschauen zu können" (@CleverManu, 2026-11-09), related to finding 26, "evtl. in neuem PR (mündliche Besprechung noch ausstehend)". An entry shows its train, choice and time, but nothing opens the situation it was taken in. Taken over by a follow-up (§1.3) until the oral discussion. | feat(decision-log): open a past decision and look at it again. |
| ⏭️ | 19 | code review | design | low | `frontend/src/app/features/reflection-prompt/reflection-prompt.component.ts:94`, `frontend/src/app/features/rationale-capture/rationale-capture.component.ts:66`, `frontend/src/app/features/co-learning-reflection/co-learning-reflection.component.ts:73`, `frontend/src/app/features/proposal-compare/proposal-compare.component.ts:93`: every place that can show a "why?" shows it as soon as `pendingRationale` is set; nothing decides which one. In a layout no preset ships (the catalog panel `reflection-prompt` next to «Handlungsvergleich» in a reason tour, the recommendations panel next to the Co-Learning reflection panel) the same reflection shows twice, with different questions. The Co-Learning reflection panel also opens itself for a reflection another panel shows. On `main` the same, and #160 does not worsen it in any shipped setup (reason tours pin layouts with the decision panel only). "One place per mode" is an existing intent (`PANEL_MODE_AVAILABILITY`), enforced only by the system layout; the saved-layout gap is documented in `docs/plans/mode-scoped-layouts-plan.md` §1. Taken over by a follow-up (§1.3): no order in this PR, the study designer chooses the panels (Q10, D15). | fix(reflection): show a reflection in one place only. |

**Issue references.** The PR closes #160 ("Closes #160" in its description).
No code comment names it or a finding number any more (finding 18, fixed in
ba64e47; checked at ba64e47 in the `main..HEAD` diff).

### Finding 1

`SessionStore` keeps two things about reflections, and they answer different
questions:

- **`openReflections`:** which decisions still lack a reflection. Many, in
  decision order (new in #160).
- **`pendingRationale`:** which reflection the prompt shows right now. One,
  because one form is on screen. On `main` it was "the decision waiting for
  its reason"; since #160 it is only one of possibly several open ones.

All six readers of `pendingRationale` need exactly one value:

- `rationale-capture`, `reflection-prompt` and `ProposalCompareComponent` show
  one form;
- `co-learning-reflection` and `ViewTracker` ask "is one being shown?";
- `OperatorModelBridge` uses it to hold a decision back, and this is where it
  goes wrong: it is the one reader that needs the whole list.

Making `pendingRationale` a list would make every reader pick the entry to
show, copying the store's "oldest not closed, unless reopened" rule six times.
The weakness is elsewhere: both are writable signals the store keeps in step
by hand (13 writes in `session.store.ts`), and two copies of one fact are how
the bridge came to read the wrong one.

| Component | Responsibility in this flow | Lifetime |
|---|---|---|
| Operator | The participant who decides and reflects. | A person, not code. |
| `ProposalCompareComponent` | The decision panel «Handlungsvergleich»: compares plan, AI and own choice for a train, applies one, and shows the open reflection at its top. | Component: one instance per panel the layout places, created and destroyed with the layout; every instance shows the same reflection. |
| `SessionStore` | Holds the session's decision log and the reflections still open, and records an answer on its decision. | Singleton (`providedIn: 'root'`). |
| `OperatorModelBridge` | Watches the decision log and reports each human decision once to the operator model, after its reflection is settled. | Singleton (`providedIn: 'root'`), created lazily: only the Director panel `co-learning-effect` injects it, so it does not exist in Plan B; once created, it lives as long as the page and first reports the whole log so far. |
| `OperatorModelService` | The client of the backend operator model: `recordSignal` for a decision, `recordLearning` for a confirmed rule. | Singleton (`providedIn: 'root'`). |

```mermaid
sequenceDiagram
  actor Operator
  participant Panel as ProposalCompareComponent (decision panel)
  participant Store as SessionStore (store)
  participant Bridge as OperatorModelBridge (bridge)
  participant Model as OperatorModelService (operator model)

  Note over Store: pendingRationale = the one reflection shown<br/>openReflections = every decision without one (new in #160)

  Operator->>Panel: decides train A
  Panel->>Store: recordProposalChoice(A)
  Store->>Store: log entry A, openReflections = [A], pendingRationale = A
  Store-->>Bridge: log changed, pending is A
  Bridge->>Bridge: A is pending, hold it back

  Operator->>Panel: decides train B while A is still open
  Panel->>Store: recordProposalChoice(B)
  Store->>Store: log entry B, openReflections = [A, B], pendingRationale stays A
  Store-->>Bridge: log changed, pending is A
  Bridge->>Model: recordSignal(B) without a reason
  Note over Bridge,Model: ⚡ bug: B is reported before its reflection exists
  Bridge->>Bridge: B marked reported for good

  Operator->>Panel: answers A
  Panel->>Store: submitRationale(A)
  Store->>Store: openReflections = [B], pendingRationale = B
  Store-->>Bridge: log changed, pending is B
  Bridge->>Model: recordSignal(A) with its reason

  Operator->>Panel: answers B with Ja, als Regel
  Panel->>Store: submitRationale(B)
  Store->>Store: entry B gets its reason and the confirmed rule
  Store-->>Bridge: log changed, nothing pending
  Bridge->>Bridge: B already reported, skipped
  Note over Bridge,Model: ⚡ bug: recordLearning(B) is never sent, the rule is lost
```

Fix (built in f977f7c):

```ts
readonly openReflections = signal<PendingRationale[]>([]);   // the only stored list
private readonly _shownSeq = signal<number | null>(null);    // which one the prompt shows
readonly pendingRationale = computed(() =>                   // read-only, derived
  this.openReflections().find((r) => r.decisionSeq === this._shownSeq()) ?? null);
```

- Readers stay as they are: still one value.
- Writers (ask, answer, close, reopen) only update the list and `_shownSeq`;
  the three `pendingRationale.set(null)` in the resets
  (`session.store.ts:1740, 1982, 2011`) go, because emptying the list empties
  the derived value.
- An answered reflection leaves the list, so it can no longer be the one
  shown.
- `OperatorModelBridge.drain()` holds back every seq in
  `store.openReflectionSeqs()`, so B is reported once, in the last block,
  with its reason and its rule.

Where the fix goes (`ProposalCompareComponent` and the other readers do not
change; they keep reading one `pendingRationale`):

| File | Change |
|---|---|
| `frontend/src/app/core/session.store.ts` | `_shownSeq`; `pendingRationale` computed; ask, answer, close, reopen and `clearDecisionLog()` write the list and `_shownSeq` only; the three resets drop their `pendingRationale.set(null)` |
| `frontend/src/app/core/session.store.spec.ts` | the shown reflection follows the list (answered → gone, list emptied → `null`) |
| `frontend/src/app/core/operator-model-bridge.service.ts` | the effect passes `store.openReflectionSeqs()` to `drain()` instead of the shown seq |
| `frontend/src/app/core/operator-model-bridge.service.spec.ts` (new) | the diagram's flow: B waits behind A, is not reported, and is reported with its rule once answered |

### Finding 2

Only tours that are not an experiment run are affected, e.g. the interview
tour `co-learning-cost-benefit` (`debrief: true`, gated since Q4). Plan B is an
experiment run: while a leg is `running` its shift screen stays closed, so the
panels stay visible after the episode ends and the reflection can be answered.

- The episode ends on its own (`episodeDone`), so `shiftReviewOpen` is true and
  `AppComponent.shiftScreenOpen()` opens the debrief.
- The debrief hides the layout (`is-behind` → `display: none`): the decision
  panel with the reflection and the decision log are gone.
- The guide hides «Reflexion öffnen» while `shiftReviewOpen`.
- «Zurück zur laufenden Schicht» shows only while the episode still runs
  (`TourDebriefComponent.canReopen`, `tour-debrief.component.ts:268`).
- The debrief's finish and the toolbar's button call `finishDemoMode()`, which
  refuses while a reflection is open (`app.component.ts:1283`).

So the open reflection cannot be reached, and the tour cannot be finished:

```mermaid
stateDiagram-v2
  direction TB
  [*] --> Running
  state "Running: panels shown, reflection reachable in the decision panel" as Running
  state "Shift screen (debrief), episode still running: panels hidden, «Zurück zur laufenden Schicht» shown" as DebriefLive
  state "Shift screen (debrief), episode over: panels hidden, no way back" as DebriefDone
  state "Next leg or questionnaire" as Next
  state "⚡ Stuck: finish refused, open reflection unreachable" as Stuck

  Running --> Running: Szenario abschliessen or Schicht beenden with reflections open (refused, log highlighted)
  Running --> DebriefLive: Schicht beenden, all answered
  DebriefLive --> Running: Zurück zur laufenden Schicht
  DebriefLive --> Next: finish
  Running --> DebriefDone: episode ends on its own
  DebriefDone --> Next: finish, all answered
  DebriefDone --> Stuck: ⚡ finish with a reflection still open
  Stuck --> Stuck: ⚡ finish again, refused again
  Next --> [*]

  classDef bug fill:#ffe3e3,stroke:#c92a2a,stroke-width:2px,color:#000
  class Stuck bug
```

Legend: ⚡ and red mark the bug.

| Component | Responsibility in this flow | Lifetime |
|---|---|---|
| `AppComponent` | The shell: shows the working screen or the shift screen, and finishes a leg (`finishDemoMode`). | The application root, one for the page. |
| `TourDebriefComponent` | The shift screen of a tour with `debrief`: what the shift amounted to, and its finish. | Component: created while the shift screen is open. |
| `TourGuideComponent` | The tour's step strip, with «Reflexion öffnen» and «Schicht beenden». | Component: one, while a guided tour runs. |
| `SessionStore` | Knows whether the episode is over (`episodeDone`) and which reflections are open. | Singleton (`providedIn: 'root'`). |

Fix, two options (a) built in f977f7c):

- a) While reflections are open, the debrief's finish reopens the working
  screen (`shiftScreenOpen` false while `reflectionsMissing`), with the
  message and the highlighted log, also after the episode ended. Small: one
  condition in `shiftScreenOpen()`.
- b) The debrief shows the open reflections itself. Larger: a second place to
  answer, against D1 (the reflection is asked in the decision panel).

Built: a).

### Finding 3

**What `ViewTracker` logs.** It writes a `view_enter` event when the screen
changes; time on a screen is the gap to the next one. It picks the screen by
priority, and a shown reflection ranks above the tour opening, the mode
intro, the experiment phases, the shift review and the working screen
(`view-tracker.service.ts:61-90`):

```ts
if (this.store.reflectionRequested()) return { view: 'reflection', detail: { kind: 'co-learning' } };
if (this.store.pendingRationale()) return { view: 'reflection', detail: { kind: 'rationale' } };
if (this.store.pendingStrategyReflection()) return { view: 'reflection', detail: { kind: 'strategy' } };
```

**The three kinds and their modes.** A kind says what is shown, not the mode:

| Kind | Set by | Modes |
|---|---|---|
| `rationale` (`pendingRationale`) | A human decision that asks "why?": an override of an AI suggestion, any intervention in Co-Learning, a choice in «Handlungsvergleich» (`session.store.ts:2209`, `recordProposalChoice`) | Recommendation and Co-Learning; never Director |
| `co-learning` (`reflectionRequested`) | The Co-Learning reflection panel being opened: from its header, or by the impact panel after a decision when nothing else waits (`impact-panel.component.ts:484`, `reflectAfterDecision`) | Co-Learning only (`panel-mode-availability.ts:26`) |
| `strategy` (`pendingStrategyReflection`) | The Director committing to a strategy (`session.store.ts:949`) | Director only (`panel-mode-availability.ts:74`) |

Co-Learning knows two kinds, sometimes at once (the Co-Learning reflection
panel holds the "why?" prompt; the log then writes `co-learning`). So the mode,
which every click and decision already carries, cannot replace the kind.

**Where a reflection is shown.** Four components, all panels or parts of
panels; none is an overlay since the dialog is gone:

| Component | Shows | Reads | Placed in | Modes | Picture |
|---|---|---|---|---|---|
| `ReflectionPromptComponent` | Reason chips, guided questions, the preference hypothesis | `pendingRationale` | the top of «Handlungsvergleich» in a reason tour (§4.2); the catalog panel `reflection-prompt` (first cut, in no preset) | Co-Learning | <img src="reflection-inline/after-2-dialog-text.png" width="240"> (decision panel, Plan B) |
| `RationaleCaptureComponent` | The short "why?": reason chips, the preference hypothesis | `pendingRationale` | the recommendations panel; the Co-Learning reflection panel | Recommendation, Co-Learning | <img src="reflection-inline/host-2-rationale-capture-rec.png" width="240"> (recommendations panel, tour `walensee-recommendation-trust`) |
| `CoLearningReflectionComponent` | A panel with the "why?" prompt and the moments worth reflecting on | `reflectionRequested`, `pendingRationale`, the episode's end | the system layout; presets with `co-learning-reflection` (`preset-s2-reflection`, `preset-c3-reflection`) | Co-Learning | <img src="reflection-inline/host-1-co-learning-reflection.png" width="240"> (Co-Learning study 3) |
| `StrategyReflectionComponent` | The strategy reflection after a Director commitment | `pendingStrategyReflection` | the system layout; `preset-director-three-zones` | Director | <img src="reflection-inline/host-3-strategy-reflection.png" width="240"> (tour `corridor-director`) |

Pictures with `scripts/docshots-reflection-hosts.mjs` (default deployment
config) and, for the first row, `scripts/docshots-reflection-inline.mjs`, on a
production build of f977f7c; the Co-Learning study 3 picture retaken on
c491fb6, with the label fixed in S9 (finding 12).

The decision log's «Reflexion nachtragen», the guide's «Reflexion öffnen» and
the toolbar's refusal are ways back to a reflection, not places that show one.
The store's three signals say that a reflection is waiting, not which
component shows it, nor whether that panel is visible: with the panel
collapsed or missing, the log still says "reflection". Neither reason-tour
layout has `reflection-prompt` or `co-learning-reflection`, so a reason tour
shows the reflection once; a layout that adds either would show it twice
(finding 19).

**What reads the screen** (the blast radius):

| Reader | What it does with the screen | Today, while a reflection is shown | With the fix |
|---|---|---|---|
| Screen log (`view_enter`) | Time per screen | Booked as "reflection"; map/Marey switches and guide steps are not logged | The working screen with `reflection` in its detail; switches logged |
| Click log (`click-log.service.ts:72`) | Every click carries `view` | Every click says `view: 'reflection'`, also on the map, the timetable or the decision panel | Clicks say `session` |
| Pointer log (`pointer-log.service.ts:76`) | Only checks that the screen is not `start` | - | - |
| Replay (`replay.service.ts:332-342`) | Map or Marey chart and the guide step from the `session` detail | Switches made meanwhile are missing | Shown |
| Screen priority (`view-tracker.service.ts:61-90`) | A reflection outranks most screens | Hides the tour opening, the mode intro, the experiment phases and the shift review (`replay.service.ts:61` notes it for the shift review) | Only on `session`, so those screens are logged |
| Backend | Does not read `view` or `view_enter` | - | - |
| `docs/experiment-logging.md` | Documents `reflection {kind}` as an overlay | Stale since #160 | The row goes; `reflection` added to `session`'s detail |

**Recorded on Plan B** (`plan-b-p01`, leg 1, 2026-11-06, production build of
f977f7c, the session record and click stream read from the browser): the
participant takes «Plan behalten», switches the map tab and selects another
train while the reflection waits, answers it, and switches back.

<img src="reflection-inline/q11-working-during-reflection.png" width="720">

The participant works on the Streckenspiegel and in the Fahrplan (ICE_42
selected); the reflection waits in «Handlungsvergleich» (red frame). The log
calls all of this "reflection". The picture is retaken on fe65e1a, with
Plan B's stepper and finish button after #174; the table is the recording
from f977f7c, before S11.

| Step | What the participant did | Screen log today (`view_enter`) | Click `view` today | a) / b) on Plan B | c) |
|---|---|---|---|---|---|
| 8 | Takes «Plan behalten»; the reflection appears | `reflection {kind: rationale}` | `session` (`proposals.keepPlan`) | `session {…, reflection: rationale}` | as today |
| 9 | Switches to the Streckenspiegel tab | - | `reflection` (`views.map`) | - | as today |
| 10 | Selects ICE_42 in the Fahrplan | - | `reflection` (timetable) | `session` | as today |
| 11-12 | Picks a reason, answers «Nein» | `session {centerTab: map, …}` at step 12 | `reflection` (decision panel) | `session {…}` without `reflection` | as today |
| 13 | Switches back to the ZWL tab | - | `session` (`views.zugWeg`) | - | as today |

**The options of Q11:**

- a) **Everywhere:** the screen `reflection` is no longer written; the working
  screen's detail gets `reflection: <kind>` while one waits. Clicks during a
  reflection say `session`. Applies to every mode and condition, so the
  Recommendation, Director and other Co-Learning records change too.
- b) **Only in reason tours:** as a) in Plan B and the interview, walkthrough
  and advanced tours; elsewhere the screen `reflection` stays. Two meanings
  of `reflection` in one data set, told apart by the tour.
- c) **Keep the data, fix the documentation:** `reflection` means "a
  reflection waits", not "a reflection screen". An analysis then takes the
  working screen from the last `session` entry and the place of a click from
  its `panel`, not its `view`.

On Plan B a) and b) give the same record. With any option, Plan B's map tab
switch is not visible in the screen log: `centerTab` knows only `marey`,
`map` and `other`, and logs `map` for both ZWL and Streckenspiegel (steps 2,
12; finding 22).

**Fix (proposed):**

- `currentView` no longer returns the screen `reflection`. The working
  screen's detail gets `reflection: 'rationale' | 'co-learning' | 'strategy'`
  while one is waiting, with the same priority as today. A new key in an
  existing, free-form detail; the values are today's `kind`.
- Everywhere, not only in reason tours: the kinds are panels in every mode,
  so a limit to reason tours would keep the wrong screen elsewhere. It changes
  the logs of Recommendation, Director and the other Co-Learning conditions,
  so they no longer compare with older records: a breaking change for the
  analysis (§1.5, Q11 a, D17).
- A reflection that waits at the episode's end no longer hides the shift
  review in the log.

**Verification:** specs in `view-tracker.service.spec.ts`: a waiting
reflection gives `session` with `detail.reflection`, the view the click log
reads is `session` meanwhile, and a waiting reflection hides no other screen.
In the running app: the recording above, repeated (S11 results in §6).

### Findings 19-21: one reflection, one place, the same reaction

`SessionStore` is the app's event bus for reflections: a decision writes the
store's reflection state, and every consumer reads the same signals.
`EventBusService` carries no reflection event (its `AppEvent` union has none).
So "published to every consumer" holds by construction: a rendered consumer
sees each change. What can differ is which consumer *shows* the reflection,
and how each one reacts. Checked 2026-11-06 at f977f7c, from the code; the
setup rows marked "measured" were counted in the running app with
`scripts/docshots-reflection-hosts.mjs`.

**Producers** (who writes the reflection state):

| Producer | Writes | When |
|---|---|---|
| `setOverride`, through `TrainActionService` (map, Fahrplan, ZWL, impact panel, table, …) | `openReflections`, and with it `pendingRationale` | A human override, not in Director, with an AI suggestion on screen or in Co-Learning (`session.store.ts:2209`) |
| `recordProposalChoice` («Handlungsvergleich») | the same | Every choice, not in Director (`session.store.ts:689`) |
| `recordStrategyChoice` (Director's strategy tiles) | `pendingStrategyReflection` | Every applied strategy (`session.store.ts:927`) |
| `ImpactPanelComponent` | `reflectionRequested` | After a decision, when nothing else waits, where `reflectAfterDecision` (Co-Learning) (`impact-panel.component.ts:484`) |
| `recordCoordinatedAction`, `clearOverride`, `systemHold`, the AI's own decisions | nothing | - |

**Consumers** (who reads it, and how each reacts):

| Consumer | Reads | Reaction | Same as the others? |
|---|---|---|---|
| `ReflectionPromptComponent` | `pendingRationale` | Shows it; starts empty for a new decision and keeps typed text for the same one; answer and × go to the store | The reference |
| `RationaleCaptureComponent` | `pendingRationale` | Shows it; answer and × go to the store | **No:** keeps the chips and note of the previous decision when a newer one replaces it (finding 21); wrong label (finding 12) |
| `CoLearningReflectionComponent` | `reflectionRequested`, `pendingRationale` | Opens itself while a "why?" waits, also when another panel shows it | **No:** opens for a reflection it may not be the one to show (finding 19) |
| `ProposalCompareComponent` | `pendingRationale` | Holds the reflection prompt in a reason tour, not in Director | Yes |
| `StrategyReflectionComponent` | `pendingStrategyReflection` | Shows it; its own answer and × | Yes (its own kind) |
| `DecisionLogPanelComponent` | `openReflectionSeqs` | Marks open and answered decisions, in reason tours | Yes |
| `TourGuideComponent` | `canReopenRationale` | «Reflexion öffnen» | Yes |
| `AppComponent` | `openReflections`, `pendingRationale` | The finish gate (reason tours), the pause (`pauseOnReflection`), the queue flag | Yes |
| `ToolbarComponent` | `reflectionsMissing` | The refusal message | Yes |
| `OperatorModelBridge` | `openReflectionSeqs`, `pendingStrategyReflection` | Holds open decisions back from the operator model | Yes |
| `ViewTracker`, `ClickLogService` | all three | The screen `reflection` | See finding 3 |
| `InteractionLogService` | `reflectionRequested` | `reflection_open` / `reflection_close`; nothing for a "why?" | Yes (only that kind) |

Every consumer keeps the open reflections the same way, because none keeps a
list of its own: in a reason tour the store keeps them all (D3), elsewhere a
newer decision replaces the shown one (finding 4). The exception is
`RationaleCaptureComponent`'s typed chips and note (finding 21).

**Setups** (mode × layout × configuration): how many places show a "why?".

| Setup | Mode | Layout | Places that can show it | Shown |
|---|---|---|---|---|
| Reason tours: Plan B, interview, walkthrough, advanced | Co-Learning | `preset-plan-b`, `preset-colearning-interview` | the decision panel | 1 (from the layout; on Plan B the reflection was seen in the decision panel, not as a dialog) |
| Co-Learning study 2 | Co-Learning | `preset-colearning-study2` | the Co-Learning reflection panel | 1 |
| Co-Learning study 3 | Co-Learning | `preset-colearning-study3` | the Co-Learning reflection panel (the decision panel holds none outside reason tours) | 1 (measured); the panel stays collapsed until opened |
| Recommendation study 2 | Recommendation | `preset-recommendation-study2` | the recommendations panel | 1 |
| Tour `walensee-recommendation-trust` | Recommendation | `preset-recommendation-trust` | the recommendations panel | 1 (measured) |
| **Recommendation study 3** | Recommendation | `preset-recommendation-study3` | none | **0** (finding 20) |
| **Tours `olten-zug-weg`, `walensee-zug-weg`** | Recommendation | `preset-olten-zug-weg`, `preset-zug-weg-corridor` | none | **0** (finding 20) |
| Tours `three-modes-original`, `director-only` | all three | system layout | one per mode: the recommendations panel, the Co-Learning reflection panel, the strategy reflection | 1 |
| Tour `corridor-director` | Director | `preset-director-three-zones` | the strategy reflection; a "why?" is never asked in Director | 1 (strategy, measured) |
| The `recommendations-classic` variant | Recommendation | wherever it replaces `recommendations` | none (it holds no prompt) | **0** (finding 20) |
| Free sandbox: any preset in any mode | any | presets don't filter panels by mode (only the system layout reads `isPanelAvailableInMode`) | as the preset has them | 0 or 1 with today's presets |
| Layout Designer layouts; the catalog panel `reflection-prompt` | any | any combination | any | **0, 1 or 2** (finding 19) |

Two places show the same reflection at once only in a layout no preset ships:
the catalog panel `reflection-prompt` next to «Handlungsvergleich» in a reason
tour or next to a panel with the "why?"; the recommendations panel next to
the Co-Learning reflection panel; the Co-Learning reflection panel in a
reason tour (the reflection prompt and the short "why?" for one decision).
Answering either closes both, since both read one state.

One such layout, built for the picture (Co-Learning study 3 with the
recommendations panel and the catalog panel `reflection-prompt` added, in a
local build only), after «Plan behalten» for IC_703: three places ask about
the same decision (red frames 1-3). 1 and 3 are `RationaleCaptureComponent`
(chips and a note), 2 is `ReflectionPromptComponent` (chips and guided
questions); 1 and 3 call the kept plan "Reroute", 2 calls it "Proceed"
(finding 12). The Co-Learning reflection panel has opened itself for it.

<img src="reflection-inline/finding-19-three-places.png" width="720">

**Is it new?** No. On `main` (1e33088) the same places exist with the same
code: the presets, `RationaleCaptureComponent`, `CoLearningReflectionComponent`
and the recommendations panel are unchanged by this PR (only a comment in
`layout-presets.ts` changed). So a Layout Designer layout or the catalog panel
`reflection-prompt` could show one reflection twice on `main` too. #160 does
not make it worse in any shipped setup:

- The one place #160 adds, the decision panel, shows a reflection only in a
  reason tour, and reason tours pin their layouts (`preset-plan-b`,
  `preset-colearning-interview`), which have no other place. On `main` the
  dialog was the only place there as well.
- Outside reason tours nothing paused on `main` either, so a duplicate in a
  hand-built layout was already shown while the run went on.

**Is "one place" an existing rule?** Partly, by mode:

- `PANEL_MODE_AVAILABILITY` offers the recommendations panel in
  Recommendation only, and the Co-Learning reflection panel and the catalog
  panel `reflection-prompt` in Co-Learning only. The recommendations panel's
  template says it "hosts the capture surface in Recommendation mode (the
  reflection panel hosts it in Co-Learning mode)"
  (`recommendations-panel.component.html:18-20`). On `main` the dialog's doc
  comment keeps the experiments on `app-rationale-capture` in their reflection
  panel.
- That rule is enforced only by the system layout. The saved-layout path
  (presets and Layout Designer layouts) does not read the availability: a
  known, documented gap (`layout-presets.ts`, "Known gap, inherited";
  `docs/plans/mode-scoped-layouts-plan.md` §1). That plan's fix, a layout per
  mode and a `visibleInModes` safety net (§2, P2), is not built.
- Even with mode availability, Co-Learning offers two places, the Co-Learning
  reflection panel and the catalog panel `reflection-prompt`. The widget
  catalog names the overlap as an open question ("whether the two merge into
  one shared closing surface", `widget-catalog.ts`).

So a runtime order (Q10 a-c) would be a new mechanism; "one place per mode"
is an existing intent. Its enforcement is only proposed:
`docs/plans/mode-scoped-layouts-plan.md` is a written plan ("half landed",
last changed 2026-09-13) with no issue or PR; the part that would apply here
(per-mode layouts, `visibleInModes`) is not scheduled.

**What an order would solve.** Each decision gets one form: one kind of
record (the short "why?" records chips and a note, the reflection prompt also
`reflection`), one label (in the picture above, "Reroute" next to "Proceed"),
and no panel opening itself for a reflection another place shows. It does not
direct attention: nothing is highlighted, focused or paused; without the
pause the participant chooses when to answer, and with several places also
where.

**Fix** (D15, D16; S8-S10):

- No order between places (D15): every place on screen keeps showing the
  reflection, as on `main`. The study designer chooses the panels.
  `RationaleCaptureComponent` names the logged choice (S9, finding 12), so
  the places at least agree on the course.
- No place (finding 20, D16, S10): the store asks a "why?" only where a
  place can show it: a panel that can show it is in the active layout,
  expanded or collapsed, or, in the system layout, the mode's own panel.
  `AppComponent` works it out from the active layout and sets
  `SessionStore.reflectionPlaceInLayout`, as it sets `queueReflections`; the
  store stays free of layout knowledge. Built so instead of the planned root
  service: the active layout lives in `AppComponent` (`activeRuntimeDesign()`),
  not in the layout store.
- `RationaleCaptureComponent` starts empty for a new decision, as
  `ReflectionPromptComponent` does (S8, finding 21).
- **Verification:** a spec per row of the setup table, with the layout built
  in the spec (which places register, which one shows); a spec that a new
  decision empties `RationaleCaptureComponent`; the script above, extended to
  every shipped setup, counts the places in the running app.

### Finding 4

The queue of open reflections applied in every session, not only in tours
that ask for reasons (`reasonDialog`). Elsewhere the short "why?" prompt
(`RationaleCaptureComponent`, in the Recommendation panel and the Co-Learning
reflection panel) then behaved differently from `main`, against §1.3, and with
the fix for finding 1 its closed prompts were never reported. As built before
the fix:

```mermaid
sequenceDiagram
  actor Operator
  participant Capture as RationaleCaptureComponent (why prompt)
  participant Store as SessionStore (store)
  participant Bridge as OperatorModelBridge (bridge)
  participant Model as OperatorModelService (operator model)

  Note over Operator,Model: Recommendation mode, no tour that asks for reasons

  Operator->>Store: overrides the AI for train A
  Store->>Store: log entry A, openReflections = [A], A shown
  Store-->>Capture: shows the why prompt for A

  Operator->>Store: overrides the AI for train B
  Store->>Store: log entry B, openReflections = [A, B], A still shown
  Note over Operator,Capture: ⚡ bug: the prompt still asks about A, on main it switched to B

  Operator->>Capture: closes the prompt with ×
  Capture->>Store: dismissRationale()
  Store->>Store: A closed but kept open, B shown
  Store-->>Capture: shows the why prompt for B
  Note over Operator,Capture: ⚡ bug: a prompt for B appears out of context

  Operator->>Capture: closes the prompt with ×
  Capture->>Store: dismissRationale()
  Store->>Store: openReflections = [A, B], nothing shown
  Note over Store: ⚡ bug: A and B stay open for the whole leg, nobody asks again

  Store-->>Bridge: log changed, open are A and B
  Bridge->>Bridge: with the fix for finding 1, A and B are held back
  Note over Bridge,Model: ⚡ bug: A and B never reach the operator model, on main they were reported as passive accepts
```

| Component | Responsibility in this flow | Lifetime |
|---|---|---|
| Operator | The person who overrides the AI and is asked why. | A person, not code. |
| `RationaleCaptureComponent` | The short "why?" prompt with reason chips, in the Recommendation panel and the Co-Learning reflection panel. | Component: one per panel that hosts it. |
| `SessionStore` | Holds the decision log and the reflections still open. | Singleton (`providedIn: 'root'`). |
| `OperatorModelBridge` | Reports each human decision once to the operator model, after its reason is settled. | Singleton, created lazily (only the Director panel `co-learning-effect` injects it). |
| `OperatorModelService` | The client of the backend operator model. | Singleton (`providedIn: 'root'`). |

On `main` the prompt always asks about the latest decision: a new decision
replaces it and × drops it, and the bridge reports a dropped decision at once
without a reason ("passive accept").

Fix (built 2026-11-06): queue only in tours that ask for reasons.

- `SessionStore.queueReflections`, set by `AppComponent` from
  `tour.reasonDialog()`; the store still does not read the tour.
- Off: a new decision replaces the list and is shown, × removes it from the
  list, as on `main`, so the bridge reports it at once.
- On: as designed in §4.1.
- Specs: the store with the queue off; the bridge reporting a closed prompt
  at once outside a reason tour.
