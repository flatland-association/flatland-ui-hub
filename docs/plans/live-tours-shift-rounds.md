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

## 3. A shift in rounds (Takt)

"Five rounds and I have a whole shift." Two ways to build it:

**(a) Rounds as runs — recommended first.** A shift is a sequence of N rounds
(default 5). Each round is one run of the scenario with its own random
breakdowns (seed = shift seed + round). Between rounds a short round summary
(punctuality, connections, interventions, what the AI did); after the last,
the shift review across all rounds. Reuses what exists: the demo sequencing
already runs several legs in one tour (`store.startDemo(modes, …)`), and the
shift review exists for Director. Rounds are natural reflection points — the
Co-Learning loop wants exactly those.

Cost: nothing carries over between rounds (a delay at the end of round 2 does
not reach round 3).

**(b) One continuous Taktfahrplan.** The scenario's timetable repeated N times,
each copy shifted by the period, in one episode. Truly continuous, but the
train count multiplies: Walensee 3 → 15 (fine), the corridor 16 → 80 (beyond
the Director's encoder caps, and its planning already takes ~2 min at 16),
dense Olten 52 → 260 (slow everywhere). Needs a timetable-replication step in
`env_factory` (like `compress_timetable`, but adding agents).

Recommendation: build (a); keep (b) as a later step for Walensee, where it is
cheap.

## 4. Open questions

1. Breakdown rate and duration for live runs (suggestion: about one breakdown
   per round, 10–30 steps long) — and per scenario or global?
2. Round count and length: 5 rounds × the scenario's episode (Walensee 180
   steps, ~2–3 min at normal speed) — or shorter rounds?
3. Director in rounds: its first plan plus the three option plans take ~2 min
   on the corridor, per round. Acceptable, or Director live only as a single run?
4. Summary between rounds: a small overlay, or the existing shift review each
   time?
5. Experiments stay fixed (Study 3) — or a later Study 4 with a fixed seed per
   participant?

## 5. Order of work, once agreed

1. Live variant: seed + malfunction parameters through `NewSessionOpts` →
   `session_manager.create` for scene presets; Scripted | Live toggle on the
   tour; generic live briefings.
2. Rounds (a): a `rounds` field on the tour, the round summary, the shift review
   across rounds.
3. Taktfahrplan (b) for Walensee, if still wanted.
