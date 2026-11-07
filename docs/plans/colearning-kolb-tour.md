# Co-Learning Kolb tour (`colearning-kolb`)

Status: first cut. Builds on `colearning-advanced` (live sandbox, second shift)
and adds four widgets so that each phase of Kolb's learning cycle has a place in
the layout.

## Scenario (`pf-ch-wn-wal-connections`)

The advanced tour's long-approach Walensee scenario plus a fourth train, W2
(Weesen track 3 → Ziegelbrücke), and one defined connection: W1 → W2 at Weesen,
planned gap 8 steps, minimum transfer 2. Same incidents
(`advanced-e2-breakdown-counter-train`, then `advanced-shift2-e1-breakdown-follower`).
With the counter-train breakdown W1 reaches Weesen about 20 steps late while W2
still leaves on time, so the connection breaks unless W2 is held. That gives
the connection watch something real to show.

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

- **Connection watch** shows the scene's defined connection (W1 → W2 at
  Weesen). The Director's connection KPI and the AI's options still use
  connections derived from waypoints, so they do not weigh this connection yet.
  The sandbox outcome cards were recorded on the three-train long-approach
  scenario; W2 is not in them.
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
