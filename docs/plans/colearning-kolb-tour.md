# Co-Learning Kolb tour (`colearning-kolb`)

Status: first cut. Builds on `colearning-advanced` (scenario, live sandbox,
second shift) and adds four widgets so that each phase of Kolb's learning cycle
has a place in the layout.

## Goal

Lead a dispatcher through one full Kolb cycle per shift, and make each phase
visible in the guide strip and the debrief:

| Kolb phase | Guide steps | Where it happens |
|---|---|---|
| Concrete experience (*Erleben*) | detect, assess | Deviation radar (left), impact (right) |
| Reflective observation (*Beobachten*) | alternatives, shift summary | Plan / KI / Mensch (right), debrief |
| Abstract conceptualisation (*Verstehen*) | decide, execute, reflect, AI learns | Plan / KI / Mensch, reason dialog, debrief |
| Active experimentation (*Ausprobieren*) | expect, event simulation | Staged dispositions (right), sandbox |

The debrief follows the same order: `shift-summary` → `ai-learns` →
`event-simulation`.

## Layout (`preset-colearning-kolb`)

The zone rule is strict for the demo. A softer split stays possible, because
every widget can be moved in the layout designer.

| Zone | Rule | Panels |
|---|---|---|
| Left | overview, no manipulation | situation summary, deviation radar (`settings.thresholdMinutes: 3`), notifications |
| Centre | overview, select | view tabs: map, time-distance diagram, track occupancy; timetable below |
| Right | decide | impact, Plan / KI / Mensch, staged dispositions, connection watch (collapsed) |

The deviation radar's threshold is a panel setting, not a control inside the
widget, so the left zone stays read-only.

## New guide step `expect`

Ticked by `StagedDispositionService.hasReleasedExpectation()`: a staged
disposition was released with a written expectation. Shown before the
after-episode steps.

## Widgets

- [Deviation radar](widget-deviation-radar.md)
- [Track occupancy](widget-track-occupancy.md)
- [Connection watch](widget-connection-watch.md)
- [Staged dispositions](widget-staged-dispositions.md)

## Known gaps

Track occupancy and staged dispositions carry a visible **Demo** note in the
panel until the gaps below are closed. Do not use them for experiment data yet.

- **Connection watch** derives connections from timetable stops at the same
  station. The Walensee scenario has none, so the panel shows its empty state.
  A scenario with real connections is needed for this panel to matter.
- **Track occupancy** (Demo) shows; it does not change tracks. On this line a
  track change is in effect the reroute Impact already offers. Next small step:
  mark "reroute possible" on a clash and select the train for Impact.
- **Staged dispositions** (Demo). A release is logged like any decision
  (origin `staged`); a staged hold opens the reason dialog, a staged release
  logs `proceed` without it. Missing:
  1. the expectation and the observed outcome are not on the decision-log entry
     or in the export, so the debrief and "AI learns" do not see them;
  2. the reason dialog after a staged release (Co-Learning);
  3. Plan / KI / Mensch still acts at once instead of staging, so there are two
     decision paths.
