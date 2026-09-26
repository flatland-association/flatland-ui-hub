# Live tours and a shift in rounds (Takt)

Status: proposal, 2026-09-26 — for discussion before any code.
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

### 3.2 Flatland 4.3 (checked 2026-09-26)

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

1. Breakdown rate and duration for live runs (suggestion: about one breakdown
   per round, 10–30 steps long) — and per scenario or global?
2. Round count and length: 5 rounds × the scenario's episode (Walensee 180
   steps, ~2–3 min at normal speed) — or shorter rounds?
3. Director in rounds: its first plan plus the three option plans take ~2 min
   on the corridor, per round. Acceptable, or Director live only as a single run?
4. ~~Summary between rounds: overlay or shift review?~~ Answered: a widget with
   the rounds and an archive per round (§3.1).
6. Special trains: a fixed menu per scenario (e.g. "cargo ZB → WAL"), or free
   origin / destination? And may the planner refuse one that does not fit?
7. Carry delay over between rounds from the start, or later?
5. Experiments stay fixed (Study 3) — or a later Study 4 with a fixed seed per
   participant?

## 5. Order of work, once agreed

1. Live variant: seed + malfunction parameters through `NewSessionOpts` →
   `session_manager.create` for scene presets; Scripted | Live toggle on the
   tour; generic live briefings.
2. Widget spec (create-widget): Takt-Leiste with rounds, archive, booking.
3. Backend: a shift of N rounds (same Takt, seed per round), special trains as
   extra timetable entries with a category, PP slot-finding for them.
4. Widget, then tours in rounds (Walensee first, then the corridor).
5. Later: delay carried over between rounds; Olten.
