# Control-room reference — what a live dispatcher workstation suggests

Status: plan, 2026-09-29. Source: a screenshot of an operational dispatcher
workstation that Daniel shared (several time-distance diagrams and the track
diagram in RCS-D, ALEA events and measures, a capacity-optimizer request list,
a web-based station layout, a clock). The screenshot shows production systems
and an intranet, so it is **not** kept in this repository; only what we take
from it is written down here.

Colour meanings below are read from the picture, not confirmed — ask someone
from operations before copying any of them.

## Checked against our code (2026-09-29)

| Seen at the workstation | What we have | Take-away |
|---|---|---|
| Train number with its current delay on the line and on the track ("7677 +83") | Train name at the line end in the time-distance diagram; delay marks where a delay arises, grows or is made up; tour-only name plates on the map; no current delay anywhere | **Built (item 1 below)** |
| Line colour carries meaning (probably delay/conflict, selection, train category) | Colour identifies the train, the same in list, map and diagram; conflicts as bands; plan/actual/forecast by stroke | Design decision first — it would break "one colour per train"; ask operations |
| Four to five time-distance diagrams side by side, one section each | One diagram; the section is stored per session (`store.zugWegRoute`), so two panels would show the same section | Later: a section per panel |
| Station abbreviations on the axis, time on both sides | Full station names; the scenes carry codes | Small: an axis option for codes |
| Dark background everywhere | Colour tokens are `light-dark()` pairs and a colour-scheme service exists | Nothing to build; check the diagram in dark mode |
| Track occupation per station: a column per track, time downwards, a block per train | Catalog B5 "Network Time View" (planned) is per contended resource, time to the right | A variant or companion of B5, not the same thing |
| Events as Ort · Zug · Ereignis; "my measures" as Zug · Massnahme · Ort · Bemerkung (cancelled, reroute via …, formation change) | Notifications; Decision Log (A2) | Take the list form and the vocabulary for A2. Overlap with the rounds plan's carry-over measures is only *cancel* |
| A request list with per-request buttons (possibly shifting times, not accept/reject — unclear) | — | An idea for the short-notice requests in the shift rounds, not evidence for it |
| A clock, and the same timestamp in every window | "Step 6 / 180"; the diagram's time axis in minutes from start (`20′`) | Clock time needs a start time per scenario first; pairs with the smooth "now" line (smooth-playback.md item 2) |
| Responsibility area with a small overview map | — | A frame for the shift rounds |

## Work

1. **Current delay next to the train name — done 2026-09-29.** "+5′" after the
   name in the time-distance diagram and on the map's name plates, the same
   number in both (`core/timetable/current-delay.ts`,
   `CurrentDelayService`).
   - Measured against the timetable the session started from (`/hmi/plan`,
     the diagram's *Soll*), not `AgentDTO.delay`, which stays 0 until a train
     overruns the deadline at its final stop.
   - The larger of how late the train entered its current cell and how far it
     has overstayed the planned time to leave it; before departure, how late
     it is to depart. Early running is not shown.
   - Nothing is shown after arrival, for a train on a cell its timetable never
     uses (rerouted), or in a scenario without a timetable.
   - Colour: `--app-train-delay`, the severity-warn step mixed with the text
     colour, because plain orange text is below 2:1 on a light surface.
2. Clock time and a smooth "now" line (with a start time per scenario).
3. Station codes as an axis option.

Later: a section per diagram panel; track occupation per station; the measures
list in the Decision Log. Colour by punctuality or category only after asking
operations.

## Open questions

1. Should an arrived train keep its arrival delay on the diagram label?
   Today the suffix disappears on arrival.
2. ~~Does "Restart run" in a tour lose the tour's scene?~~ Yes, and fixed
   2026-09-29. "Restart run" always built a random env from the Settings
   fields (36 × 24, 8 trains). It now recreates the running session's world
   (`core/restart-session-opts.ts`): scenario preset or saved scene,
   disturbances, opening step and, for a live tour, its seed and breakdown
   rate. Only a random env still takes the Settings fields. Checked in the app
   for walensee-zug-weg, olten-zug-weg live (seed 777) and corridor-director.
