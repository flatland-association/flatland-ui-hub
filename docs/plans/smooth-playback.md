# Smooth playback — slow enough to intervene, without stuttering

Status: plan, 2026-09-26. Prerequisite for the shift in rounds
([live-tours-shift-rounds.md](live-tours-shift-rounds.md) §5, step 0).

## The problem

Daniel: the system is still too fast for meaningful interaction — but slowing it
down risks feeling jerky, because the simulation advances in steps.

Measured in the code (2026-09-26):

- One step is one minute (`MINUTES_PER_STEP = 1`).
- Tempo levels are `[0.5, 3, 5, 10, 20]` steps per second
  (`core/play-speed.ts`); the default "Normal" is 3 steps/s — **180× real
  time**. A Walensee round is over in about 20 s.
- Between the slowest level (0.5) and Normal (3) there is nothing.
- Trains on the map are placed with an SVG `transform` and no transition: they
  **jump** cell to cell. At 0.5 steps/s a train stands still for two seconds and
  then jumps — slower today means jerkier.

## Decisions

- **Interpolate the display, not the simulation.** The simulation keeps its
  one-minute steps; what is drawn glides between them. (Agreed 2026-09-26.)
- **No look-ahead buffer.** The display never runs behind the simulation to have
  something to glide towards: the operator intervenes on the *real* state.
  While playing, a train glides from its previous to its newest position over a
  short part of the step interval and then rests there; the moment the run
  pauses — including every auto-pause for a decision — everything snaps to the
  exact current state. Nothing is ever drawn ahead of the simulation.
  (Decided 2026-09-26: "ich will ja gut intervenieren können".)
- **Steps stay one minute.** Finer steps would touch every time value —
  timetables, forecasts, the Director's models.

## Work

1. **Gliding trains on the map.** On each new state, animate every train from
   its previous cell to its new one (requestAnimationFrame, a fraction of the
   step interval, ease-out); a train slower than one cell per step advances by
   its in-cell progress (Flatland's `speed_counter.distance` — check whether the
   serializer exposes it; add it if not). Snap on pause, on reset, and whenever
   the step jumps by more than one (Schritt 10, a seek).
2. **The clock and the Zug-Weg-Diagramm's "now" line move smoothly** with the
   same interpolation, so time reads as continuous.
3. **Finer tempo levels, stated honestly.** Levels that make sense once motion
   is smooth — e.g. 1 step every 4 s, 2 s, 1 s, then the fast ones — labelled
   in the operator's terms ("1 min = 2 s") rather than an abstract 1–5.
4. **Slow down where it matters (adaptive tempo).** Calm phases may run fast;
   when a contention is forecast within the next few minutes, or a path request
   arrives, the tempo drops by itself to a readable level — on top of the
   auto-pause at a decision that exists already. A setting, like
   `autoPauseOnConflict`.

Order: 1 → 2 → 3 → 4. Item 1 is the largest perceived change.

## Acceptance

- At the slowest level a train visibly moves along the track between steps; no
  train is ever drawn at a cell the simulation has not reached.
- Pausing shows the exact simulation state immediately.
- "Schritt 10" and a reset do not animate through ten cells; they snap.
- The tempo control names its levels in minutes per second.

## Open questions

1. Which default tempo for tours once motion is smooth (suggestion: 1 min = 1 s)?
2. Adaptive tempo: how many minutes ahead of a forecast conflict, and slow to
   which level?
