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
  While playing, a train glides from its previous to its newest position; the
  moment the run pauses — including every auto-pause for a decision —
  everything snaps to the exact current state. Nothing is ever drawn ahead of
  the simulation. (Decided 2026-09-26: "ich will ja gut intervenieren können".)
- **Run through the cells, don't stop in them.** The first version glided over
  80 % of a step with an ease-out and then rested, which read as "brake, stop,
  go" in every cell (Daniel, 2026-09-26: irritating). The glide now runs at
  constant speed over the whole *measured* step interval (`StepCadence`: the
  real gap between arriving steps, smoothed, kept within 0.5–1.5× the tempo
  setting), so it ends as the next step arrives and continues seamlessly.
  Price: while running, a train is drawn up to one step behind the simulation
  — never ahead; pausing still shows the exact state. The jump check is taken
  from the previous cell, not from the drawn point, so a glide still under way
  never turns a normal step into a snap.
- **Steps stay one minute.** Finer steps would touch every time value —
  timetables, forecasts, the Director's models.

## Work

1. **Gliding trains on the map.** On each new state, animate every train from
   its previous cell to its new one (requestAnimationFrame, the measured step
   interval, constant speed); a train slower than one cell per step advances by
   its in-cell progress (Flatland's `speed_counter.distance` — check whether the
   serializer exposes it; add it if not — still open: such a train still
   pauses in its cell for the steps it spends there). Snap on pause, on reset, and whenever
   the step jumps by more than one (Schritt 10, a seek).
2. **The clock and the Zug-Weg-Diagramm's "now" line move smoothly** with the
   same interpolation, so time reads as continuous. Done for the now-line
   (`core/motion/step-clock.ts`, `SmoothClockService`): it glides at the
   measured cadence, never ahead of the simulation, and snaps on pause or a
   jump. The numeric step labels stay whole steps on purpose.
3. **Finer tempo levels, stated honestly.** Done 2026-09-27: levels
   `[0.25, 0.5, 1, 3, 10]` steps/s, default **0.5 — one minute every two
   seconds** (Daniel: the old slowest level is the pace at which a person can
   follow the situation). The control shows the pace beside the level name
   ("Normal · 1 min = 2 s"). The Director tours no longer pin a slower tempo —
   the default is theirs now.
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

1. ~~Which default tempo for tours once motion is smooth?~~ Decided
   2026-09-27: 1 min = 2 s, for every tour.
2. Adaptive tempo: how many minutes ahead of a forecast conflict, and slow to
   which level?
