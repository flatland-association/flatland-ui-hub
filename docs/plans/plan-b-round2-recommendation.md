# Plan B round 2, PR C: the Recommendation screen (`preset-plan-b-recommendation`)

Status: implemented, 27 November 2026. Target: `main`. Builds on PR B.
Overview: [plan-b-round2.md](plan-b-round2.md).

The control group's screen: the KI proposes a course, the human takes it or
doesn't intervene. A copy of `preset-plan-b-colearning` (PR B) with the
human's own options removed. The mode `recommendation` comes from the
experiment (PR D), not from the preset: a preset has no mode
(`layout-presets.ts:27-33`; `app.component.ts:1093, 1131`).

## Relation to #201

[#201](https://github.com/flatland-association/flatland-ui-hub/pull/201)
§4.3 sketched this setting for a later PR. Round 2 takes part of it and
overrules the rest **(decided)**:

| #201 | Round 2 |
| --- | --- |
| D-7: hold the affected trains, not the countdown, via a briefing flag `decisionMoment: 'hold'` | Taken as is |
| D-5: no option chips, no Mensch course | Taken; also no action buttons on the map |
| D-5: the KI course tagged "Empfehlung" | **Not** taken: no tag |
| D-5: no "Vergleich" | **Overruled:** "Vergleich" stays (Kein Eingriff vs KI) |
| No "Lage: Risiko" | **Overruled:** it stays, on the left as in B |
| D-12: no reflection | Taken |
| D-5: behaviour per mode in the panel | Changed: per preset, through UiConfig ids (below) |

## Change

### 1. Preset

`PLAN_B_RECOMMENDATION`, written out like `PLAN_B_COLEARNING` (ids
`preset-pbr-*`): the same panels in the same places, the same `ui` (minutes
included) plus the two hidden ids below. `nameKey`/`purposeKey` under
`layouts.planBRecommendation`. `proposal-compare` is now also available in
Recommendation (`panel-mode-availability.ts`, #201 D-5); presets rendered it
in any mode already, but should not depend on that gap.

### 2. No Mensch option (decided)

- New UiConfig id `widget.proposal-compare.human`, next to the axis ids
  (`ui-config-items.ts:59-62`). Hidden, the Handlungsoptionen show two boxes,
  "Kein Eingriff" and "KI", no option buttons, and the "Vergleich" with two
  bars. The note above them says "Zwei Verläufe …" (`proposals.noteNoHuman`).
- Per preset rather than per mode **(decided)**: the guardrail "mode
  semantics in `InteractionMode`" is about what a mode does; which parts of
  a panel a study screen shows is what UiConfig is for, and it keeps
  `proposal-compare` usable in Recommendation elsewhere with all three boxes.

### 3. No action buttons on the map (decided)

- The option strip at the selected train (`.map-train-options`,
  `flatland-map.component.html:706-730`) shows when the briefing has
  `assessmentOnly` (`flatland-map.component.ts:239-251`). The Recommendation
  briefing keeps `assessmentOnly` (it also hides the impact panel's own
  options and the "Empfohlen" tag there, `impact-panel.component.html:98-121`).
- The map has a second kind of action button: the decision pills at a
  train's next decision, shown in Recommendation by default
  (`layerVisibility().nextDecisions`). "All buttons" covers both.
- New UiConfig id `control.mapTrainActions`: when hidden, `trainOptions`
  returns null and the pills are not drawn; the decision line and marker stay,
  as information. Clicking a train still selects it for the Handlungsoptionen.

### 4. Hold instead of countdown (decided: as Plan B round 1, #201 D-7)

Both the decision moment and "no answer" behave as in round 1: only the
affected trains wait, the rest runs on, and they wait until the person
decides. No global pause, no countdown, no automatic KI decision.

- `ImpactPanelComponent.modeBehavior()` (`impact-panel.component.ts:191-197`)
  gives Recommendation the countdown: global pause, then the KI's option is
  applied (`_autoDecide`, :358-372). That would auto-apply in one group only.
- New briefing flag `TourBriefing.decisionMoment?: 'hold'`; `modeBehavior()`
  returns `hold` when it is set. The Recommendation briefing of round 2 sets
  it (PR D). The countdown stays for every other Recommendation use.

### 5. No reflection (decided)

- Reflection is asked only when the briefing has `reasonDialog`
  (`app.component.ts:1281-1293`, `_askReflection` :1593-1606). The
  Recommendation briefing (PR D) leaves it out; nothing else changes.
- The decision log then shows no reflection column/markers
  (`decision-log-panel.component.ts:153`).

### 6. Decision log counts

With PR A item 8, "KI übernommen" counts as KI and "Nicht eingreifen" as
Mensch, which is what the control group needs to read.

## New files

| File | Adds |
| --- | --- |
| — | No new files |

## Modified files

| File | Change |
| --- | --- |
| `frontend/src/app/core/demo/tour-briefings.ts`, `core/demo/tour-context.service.ts` | `TourBriefing.decisionMoment?: 'hold'`, `TourContextService.decisionMoment` (item 4; the briefing itself is in PR D) |
| `frontend/src/app/features/impact-panel/impact-panel.component.{ts,spec.ts}` | `modeBehavior()` holds in Recommendation when the briefing asks |
| `frontend/src/app/features/proposal-compare/proposal-compare.component.{ts,html,spec.ts}` | `humanShown()`; Mensch box and options gated; two-course note (item 2) |
| `frontend/src/app/features/flatland-map/flatland-map.component.{ts,html,spec.ts}` | `trainActionsShown()` gates the option strip and the decision pills (item 3) |
| `frontend/src/app/core/config/ui-config-items.ts`, `frontend/public/ui-config.schema.json` | `widget.proposal-compare.human`, `control.mapTrainActions` |
| `frontend/src/app/core/layout/panel-mode-availability.ts` | `proposal-compare` also in Recommendation |
| `frontend/src/app/core/layout/layout-presets.ts` | `PLAN_B_RECOMMENDATION`, registered (item 1) |
| `frontend/src/app/core/config/ui-config.service.spec.ts`, `core/stored-ids.spec.ts` | The preset = Co-Learning + two hidden ids; id pinned |
| `frontend/public/i18n/{en,de,fr}.json` | `layouts.planBRecommendation`, `proposals.noteNoHuman` |

## Open points

None. All answered by the study lead on 27 November 2026; the preview (PR E)
has only the KI toggle here.
