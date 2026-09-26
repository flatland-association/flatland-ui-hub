# Live tours and a shift in rounds (Takt)

Status: live variant built (§2); shift in rounds designed (§3.2), not built.
Last decisions: 2026-09-26. Smooth playback, a prerequisite for the rounds: [smooth-playback.md](smooth-playback.md).
Context: [tours-experiments-cleanup.md](tours-experiments-cleanup.md). Asked by
Daniel: fewer scripted tours, more where everything is computed live and
breakdowns are random; offer every tour **scripted and live**; and consider a
round logic for live — "something runs five rounds and I have a whole shift".

## 1. What is scripted today, what is live

Live already: the forecast and contentions, the simulated strategies (keep /
switch policy / PP re-plan), PP itself, the Director's plans, the impact
analysis.

Scripted: the scenarios that ship a plan pin `malfunction_rate: 0`
(`scenario_presets.py`), the disruption is a JSON file firing at a fixed step
("IC_703 breaks down at step 18"), and the briefings narrate exactly that.
That is what makes a tour reproducible — and what makes it feel like a film.

## 2. Two variants per tour, one picker entry

Like the language merge (`Tour.briefingIds`), a tour stays **one entry** with a
choice beside it: **Scripted | Live**.

| | Scripted (today) | Live |
|---|---|---|
| Disruptions | the tour's fixture, fixed step | random breakdowns (Flatland's malfunction generator) |
| Reproducible | always | per seed — the seed is shown and saved |
| Briefing | tells the story | describes the situation, not the plot |
| Decision moment | known in advance | the first forecast conflict; the auto-pause at the first contention already works without a script |

Random but reproducible: Flatland's `MalfunctionParameters` (rate, min / max
duration) with a seed; `env_factory._build_malfunction_generator` supports it
already, the presets only switch it off. A live run records its seed, so an
interesting run can be replayed and shown again.

Applies to: Walensee (Recommendation), Olten, the corridor Director tour. Not
to the Co-Learning Monte Carlo interview (unchanged by decision).

**Built 2026-09-26** (step 1 of §5): Walensee, Olten and the corridor Director
tour offer *Scripted | Live* on the start screen, with an optional seed
(`#/tour/<id>/live[/<seed>]`); the footer shows `Live · Seed n` and the
questionnaire saves it. Rates per train and step: Walensee 0.01 (its three
trains are through in ~60 steps; 0.003 often gave none), Olten 0.0005, corridor
0.0007; durations 10–30 steps. Backend: `env_factory.apply_live_malfunctions`
(seeded, rebuilt on reset so a replay meets the same breakdowns); forecast forks
of a live run draw no breakdowns of their own. A live run can be quiet — seed 23
on Walensee has no breakdown at all; that is what random means.

## 3. A shift in rounds (Takt)

"Five rounds and I have a whole shift." Two ways were weighed first:

- **(a) Rounds as runs** — each round a fresh run of the scenario, a summary
  between rounds. Cheap, but nothing carries over between rounds.
- **(b) One continuous Taktfahrplan** — the timetable repeated N times, shifted
  by the period, in one episode. Continuous, but the train count multiplies
  (Walensee 3 → 15, corridor 16 → 80, dense Olten 52 → 260).

### 3.1 Revised 2026-09-26: a Taktfahrplan, shown by a widget

Daniel's steer: not an overlay between rounds, but the logic of a
**Taktfahrplan** — every round is the same round again (the base Takt); between
rounds the dispatcher can plan **special trains**, e.g. a cargo train, that run
in one round and not in the others; and a **widget** shows the rounds and keeps
an **archive per round**.

**The format already has the pieces.** flatland-association's
`flatland-scenarios` (`scenario_generator/model/scenario.py`) builds exactly
this: `ScenarioBuilder.add_timetable(name, shift, new_name, travel_factor)`
clones a timetable shifted in time — one call per round is the Takt — and
`travel_factor` makes a slower copy — the cargo path. Its JSON carries
`trainCategories` (IC, RE, cargo, …). So a round's timetable is "the base Takt
+ the special trains booked for this round", expressed in the upstream
vocabulary rather than a format of ours (CLAUDE.md: that org is the authority
for scenarios and timetables).

**Model.**

| Concept | Meaning | Where it lives |
|---|---|---|
| Shift | N rounds of one scenario, one seed | tour / experiment setting |
| Takt (round) | the base timetable, once | the scenario preset as today |
| Special train | an extra timetable entry, own category (cargo), booked into one round | shift plan, per round |
| Round archive | what happened in a finished round: KPIs, breakdowns, decisions, AI actions, the Zug-Weg lines | kept per round, read-only |

**Continuity.** Start with each round as its own run (3 a) — the base Takt is
the same every time, so "the same round again" is literally true, and the train
count stays at one Takt plus the booked specials. Carrying delay over from one
round into the next (3 b's advantage) is a later option: seed a round's start
state from the previous round's end.

**Booking a special train.** Between rounds (or for any future round), pick a
path from the corridor's list — "cargo Ziegelbrücke → Walenstadt, slow" — and a
round. The planner fits it into the Takt: PP (`app.planners.replan`,
AI4REALNET/flatland-blackbox) with the special train at the lowest priority is
a *Trassenplanung* — the regular Takt keeps its paths, the cargo train gets
whatever is left, or the planner says it does not fit. Mode-dependent, like the
other widgets: Recommendation proposes a slot, Co-Learning shows the options
neutrally, Director books it itself on the objective.

**The widget** (working name *Takt-Leiste* / shift rounds; new catalog entry,
built with the `create-widget` skill — spec first):

- a row of rounds 1…N: done / running / planned;
- per round: punctuality, delay minutes, breakdowns, interventions, AI actions;
  booked special trains shown as chips (cargo icon) in their round;
- click a finished round → its archive: the round's Zug-Weg-Diagramm lines,
  its decision log, its breakdowns — read-only, next to the running round;
- click a planned round → book / remove a special train;
- the end of the shift → the existing shift review across all rounds.

Kind: capitalization (archive, the shift summary) with a control part
(booking). Scene presets first (Walensee, corridor): their trains come from the
scene's JSON, so adding one is a list entry; Olten is a pickled env and needs an
agent-insertion step first.

### 3.2 The shift, designed (decisions of 2026-09-26)

A shift is **five rounds** of one scenario. Every round is the base Takt again;
a **shift plan**, known before the shift starts, says what is different per
round; what happens *during* the shift — breakdowns, short-notice requests —
lands in a later round, never in the running one.

```
Shift plan (known in advance)            ← what the round widget previews
 ├ Round 1  base Takt
 ├ Round 2  base Takt
 ├ Round 3  base Takt + cargo special (planned days ahead)
 ├ Round 4  base Takt + rush hour: longer dwell times
 └ Round 5  base Takt
 + during the shift: breakdowns (random or scripted),
   short-notice path requests → always for a *later* round
```

**Round length.** A round ends when all of its trains have arrived, plus a
small buffer — the next Takt follows. A scenario's `max_episode_steps` (180 on
Walensee, where the trains are through in ~60) is headroom for disturbances, not
the Takt; it stays only as the upper bound for a train that never arrives.

**Influence factors per round** (the shift plan's content), each something
Flatland can already express:

| Factor | Example | How |
|---|---|---|
| Rush hour, more passengers | "evening peak: longer stops" | longer dwell windows at the stops |
| Weather, slow order | "Walensee section at reduced speed" | lower speed, per train or section |
| Construction | "track closed Mühlehorn–Tiefenwinkel" | the existing `area_block` event |
| Planned special train | "cargo ZB → WAL in round 3" | an extra timetable entry with a category (`trainCategories`) |

**Special trains — two kinds.**

| | Planned (days / weeks ahead) | Short-notice (mostly cargo) |
|---|---|---|
| Known | before the shift | during the shift, as an event |
| Shown | a chip in its round of the round widget, from the start | a **path request** in the events, with a deadline |
| Task | none — it runs; it makes its round denser and may cause conflicts | **decide**: accept in a slot, move it, or refuse |
| Scripted | fixed in the tour | fixed in the script ("request at step 40, deadline 20") |
| Live | drawn from the scenario's list of possible specials, by seed | arrive at random, by seed, like the breakdowns |

A short-notice request **always takes effect from the next round** (decided).
Resolving it means finding a slot **within a time corridor**: earlier or later
in the requested round, or one round later — or refusing it (decided: refusing
is allowed). PP fits it with the lowest priority, so the Takt keeps its paths,
and states what each slot costs. Per mode, as elsewhere: Recommendation proposes
a slot, Co-Learning shows the slots side by side, Director decides by a rule
("accept cargo while no passenger train loses more than 2 min") and reports.

Technical note: Flatland knows all trains from the start of a run; a train
cannot be added mid-run. Taking effect from the next round sidesteps that — the
next round's env is built with the accepted special in its timetable.

**Carry-over between rounds.** Real dispatching has several strategies: turn a
train back early, cancel it, run a spare train (few exist), or organise
replacement buses (a large effort). A simple first entry:

1. **Carry over by default** — a train that ends round k late starts round k+1
   correspondingly late, minus a turnaround buffer (a simplified vehicle
   rotation; only a later departure, no new mechanics).
2. **Two counter-measures at the end of a round**: *cancel* (the train does not
   run next round — counted as a cancellation, its delay gone) and *spare train*
   (the train runs on time — but only 1–2 per shift, a scarce resource, so a real
   trade-off).

Later: turning back early (skipping the last stops — changes the train's
target), replacement buses (as a cost item).

**The round widget** (working name *Takt-Leiste*; an event/context widget, new
catalog entry, spec via the `create-widget` skill):

- rounds 1–5: done / running / planned — the shift's position at a glance;
- per round, what to expect: the shift plan's factors and specials as chips
  ("cargo", "rush hour", "slow order"), and requests booked into it;
- per finished round: punctuality, delay minutes, cancellations, the operator's
  interventions, the AI's actions — and its **archive** (Zug-Weg lines,
  decisions, breakdowns), read-only beside the running round;
- the end of the shift → the existing shift review across all rounds.

**First scenario: Walensee** — small, to prove the principle (decided).

### 3.3 Flatland 4.3 (checked 2026-09-26)

PR #90 moves the backend to `flatland-rl==4.3.0`. Checked against a clean 4.3.0
install:

- **Live variant holds.** `ParamMalfunctionGen`, `MalfunctionParameters`,
  `NoMalfunctionGen`, `MalfunctionEffectsGenerator`, `RailEnv._seed`,
  `reset(random_seed=)` and the persister behave as in 4.2.6: same seed → same
  breakdowns, identical after reset + rebuild, a forked env gets a
  `FileMalfunctionGen` (so the quiet-fork guard is still needed).
- **Takt holds.** The timetable fields a Takt or a special train shifts —
  `earliest_departure`, `latest_arrival`, `waypoints_earliest_departure` /
  `_latest_arrival`, `Waypoint.position` — are all still there; every Flatland
  import of flatland-scenarios' `scenario.py` works on 4.2.6 and 4.3.0.
- **What 4.3 removes:** `EnvAgent.position / direction / target /
  initial_position` (now `current_configuration`, `initial_configuration`,
  `targets`). #90 adds `app/utils/agent_compat.py` for them. Built on `main`,
  it does not cover `scripts/generate_plan.py` (on `main` too). *Corrected
  2026-09-26:* the vendored PP planner (`app/planners/blackbox/pp.py`,
  `utils.py`) is covered — it reads `initial_position` / `target` only on the
  `SimpleNamespace` starts `replan._start_states` builds, which #90 adapts.
  `tests/test_olten_geography.py` reads both versions now (0dace86). Noted on
  PR #90.
- A trial merge of #90 into `explore_db` has one textual conflict
  (`goal_based_policies/dataset.py`, two import blocks — keep both).

Worth reusing for live runs: flatland-scenarios breaks trains down *at their
stops* with `IntermediateStopMalfunctionEffectsGenerator` (available in 4.2.6
and 4.3.0) — closer to railway reality than a breakdown anywhere on the line.

## 4. Open questions

1. Director in rounds: its first plan plus the three option plans take time per
   round (start of round 1 is precomputed; later rounds start from a carried-over
   state and are not). Acceptable, or Director shifts later?
2. Experiments stay fixed (Study 3) — or a later Study 4 in rounds, with a fixed
   seed per participant?
3. The turnaround buffer and the number of spare trains per shift — per scenario?
4. Which influence factors first (suggestion: rush hour dwell + one planned cargo
   special, both on Walensee)?

Answered on 2026-09-26: round length (§3.2), per-round figures (§3.2), special
trains as events with a time corridor, next round only, refusable (§3.2),
carry-over approach (§3.2), start small on Walensee, summary as a widget.

## 5. Order of work

0. **Smooth playback** (prerequisite, [smooth-playback.md](smooth-playback.md)):
   trains glide between steps, finer tempo levels, slow-down near conflicts —
   so a five-round shift can be slow enough to intervene without stuttering.
1. **Five rounds of the same Takt** on Walensee, a seed per round, round end =
   all arrived + buffer; the **round widget** with status and per-round figures,
   archive per finished round. No specials, no carry-over yet.
2. **Shift plan**: influence factors per round and planned specials, previewed
   in the widget and applied when a round's env is built.
3. **Short-notice path requests** as events and tasks; slots in the time
   corridor via PP; mode-specific framing.
4. **Carry-over** with cancel and spare train.
5. Tours in rounds (Walensee first); later the corridor, Olten, experiments.
