# Tour: supervise the AI (Director oversight)

**Status:** first cut. **Tour id:** `director-oversight`.
**Layout:** `preset-director-oversight`.

## What and why

An example tour for the two supervision widgets:

- the [Autonomy Map](widget-autonomy-map.md)
- the [Optimization Monitor](widget-optimization-monitor.md)

The existing Director tours (`corridor-director`, `director-only`) are
about choosing the objective. This tour reads the same Director as
supervision. It asks two questions: who decides what, and how far can you
trust the plan that drives the trains?

## Setup

| Field | Value | Why |
|---|---|---|
| Mode | `director` | The Optimization Monitor is Director-only. |
| Scenario | `pf-ch-wn-wal-long-approach` + `e1-late-into-the-section` | The scenario measured for Director (`director-only`). The late train gives the planner a reason to re-plan. |
| Map focus | columns 69–126 | Same range as `director-only`. |
| Tempo | level 2 | Required for Director-only tours (`tours.spec.ts`). |
| Opening step | none | `openAtStep` is measured per tour. The A/B/C choice is not this tour's point. |
| Survey | none | It is a demo. |

## Layout

The layout uses the three zones of `preset-director-three-zones`:

| Zone | Panels |
|---|---|
| Left: who decides | Situation Summary, Autonomy Map, AI Activity |
| Centre | Track map, time-distance diagram |
| Right: oversight | Optimization Monitor, Strategy Options (A/B/C), Strategy Impact Forecast (collapsed) |

The A/B/C tiles stay in the layout because choosing the objective is the
one lever the human has in Director.

## Briefing

There are mode intros in English and German. French falls back to English, as
in the other tours. The tour name and description in the picker are i18n
keys (`tours.director-oversight.*`) in en, de and fr.

## Open

- The tour text makes no claim about how often the planner re-plans. It
  was not measured on a backend with the planner models loaded.
- There is no live variant (random breakdowns) yet.
