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

- **Connection watch** derives connections from timetable stops at the same
  station. The Walensee scenario has none, so the panel shows its empty state.
  A scenario with real connections is needed for this panel to matter.
- **Track occupancy** shows; it does not change tracks. A track change is a
  later extension.
- **Staged dispositions** is its own widget. It does not intercept decisions
  made in Plan / KI / Mensch, and a staged release is not written to the
  decision log, so it does not trigger the reason dialog.
