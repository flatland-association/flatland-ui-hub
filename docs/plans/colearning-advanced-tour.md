# Plan — Co-Learning advanced tour («zwei Schichten»)

> **Status:** WP1 built · started 2026-10-06 · owner: Daniel Boos
> **Context:** the Co-learning Monte Carlo interview tour
> ([colearning-monte-carlo-interviews-tour.md](colearning-monte-carlo-interviews-tour.md))
> stays exactly as it is: it is the CAS thesis instrument (due 2026-11-10). This
> plan adds a **second, advanced tour** beside it that closes the loop the
> interview tour only points at.

## 1. Why

The interview tour shows both learning directions as far as the *intention*:

- the human reflects, but never tries the alternative (step 8 is precomputed cards);
- the AI records a learning card, but the tour ends before the card changes anything;
- abstract conceptualisation (Kolb) is not supported, so the closing page draws it dashed;
- one incident per shift gives a one-line shift summary.

The advanced tour completes the Kolb cycle and shows the effect of both
directions: **play** the decision again (active experimentation), **formulate a
rule** (abstract conceptualisation), and meet a **second shift** in which the
learned preference visibly moves the options and the rule is at hand.

## 2. Shape of the tour

| Phase | What happens | Thesis step |
|---|---|---|
| Shift 1 | Co-Learning run with the modules marked (as the interview tour; harder scenario in WP2) | 1–6 |
| Debrief: Schichtbilanz | as today (`buildShiftReview`, interventions, moments) | 7 |
| Debrief: Sandbox, **playable** | replay the decision moment from a checkpoint with other options, compare with the run as played | 8 |
| Debrief: Regel | turn the insight into an «Wenn …, dann …» rule; check it against the sandbox cases | Kolb: abstract conceptualisation |
| Debrief: KI lernt | learning cards, value profile, save | 9 |
| Shift 2 | a different incident with the same pattern; options ranked by the learned preference, with a reason; the rule as a note | 1–6 again |
| Closing | shift 1 vs shift 2: did the human improve, did the AI adapt (ranking before / after) | — |

Tour-scoped like the interview tour: everything is gated on the running tour's
briefing (`TourContextService`), nothing changes in the experiments or in the
interview tour.

## 3. Work packages

### WP1 — Playable sandbox (≈ 2–3 days) — **built 2026-10-06**

- **Checkpoint at the decision moment.** When the conflict surfaces in a tour
  with `TourBriefing.sandbox: 'live'`, the impact panel calls
  `POST /session/{id}/sandbox/checkpoint` (before anyone decides). The backend
  keeps a fork of the env (the branch runner's fork, so committed routes, served
  stops and a quiet malfunction generator come along), the impact items at that
  moment and the overrides standing apart from the affected trains.
- **Play an option.** `POST /session/{id}/sandbox/run` plays hold-until-step,
  hold without release, proceed or reroute (when a route exists) from the
  checkpoint to the end of the episode — same `TrajectoryBranchRunner`, same
  override semantics and the same delay-against-plan as the what-if and
  Plan / KI / Mensch. Read-only; any option can be played again.
- **The run as played.** `GET /session/{id}/sandbox` returns it next to the
  checkpoints; when the shift was ended early, the rest of it is simulated with
  the overrides then standing (`played_completed_by_simulation`).
- **HMI.** `features/sandbox-replay` in the debrief's Event Simulation section:
  the situation at the checkpoint, option chips, a release slider for
  hold-until (hint: section clear from about step n), «Durchspielen», cards in
  the precomputed cards' shape next to «Dein Lauf», each with «n Schritte
  weniger / mehr Verspätung als dein Lauf» or «nicht vergleichbar» when a
  different number of trains arrives.
- **Tour entry** `colearning-advanced` (briefings `colearning-advanced` /
  `-en`): the walk-through without the interview framing, `sandbox: 'live'`,
  same scene, layout and disturbance as the interview for now (WP2 changes that).

Files: `backend/app/api/sandbox.py`, `backend/tests/test_sandbox.py`,
`frontend/src/app/features/sandbox-replay/*`,
`frontend/src/app/core/demo/sandbox-replay.ts`; small hooks in
`session_manager.py` (`sandbox_checkpoints`), `sessions.py` (reset clears them),
`main.py`, `api.service.ts`, `impact-panel.component.ts`, `tour-debrief`,
`tour-briefings.ts`, `tour-context.service.ts`, `tours.ts`, i18n.

**Verified:** backend 5/5 in `test_sandbox.py` — the checkpoint lands on step
28 for ICE_42 blocked by IC_703; *proceed* gives +26 and *hold until clear*
+30, exactly the precomputed interview cards, so the playable and the
precomputed sandbox agree. Browser: full run of the new tour, checkpoint at
step 28, «Weiterfahren» taken at step 46, shift ended → «Dein Lauf» +44
(completed by simulation), «halten bis 40» +30 (14 better), «weiterfahren» +26
(18 better). i18n check, colour lint and production build clean.

**Limits (stated in the HMI's concept line):**
- Scripted disturbances due *after* the checkpoint are not replayed — the branch
  runner does not fire them. Irrelevant for the tour incident (fires at 28,
  checkpoint at 28); matters for WP2 if a second disruption follows.
- A live run's forks draw no new random breakdowns, like every forecast fork.
- Only the first decision moment(s) are kept (≤ 5 per session), not any moment
  of the shift. **Reuse target** for restoring any step:
  [`AI4REALNET/agent-as-a-service-trace-rl`](https://github.com/AI4REALNET/agent-as-a-service-trace-rl)
  (A3S restore / simulate-forward). The in-repo fork stays the interim path —
  decided here, not by omission.

**Next in WP1 (not built):** draw the played variants on the
Zeit-Weg-Liniendiagramm (the branch result already carries snapshots;
`_branch_trajectories` gives them in scenario shape) — the difference between
«halten bis 40» and «weiterfahren» is easier to see as lines than as sums.

### WP2 — Harder scenario + context snapshot (≈ 1–1½ days)

- The «never experienced» case of the interview sandbox as the advanced tour's
  shift-1 disturbance: counter-train in front of the blocked single-track section
  (interview plan §6b #2). Here hold, proceed and the offered reroute differ, and
  the best AI order is not the plan (#13).
- Fire scripted disturbances due after a checkpoint inside the sandbox branch
  (needed as soon as a shift has two incidents).
- Context snapshot on the learning card (delay, connection, knock-on effect
  instead of «—», #3) — written for the advanced tour, offered to the interview
  tour only if Daniel wants it there.

### WP3 — Rule from insight (≈ 1 day)

- The shift's insight (today a textarea, not stored, #14) becomes a structured
  rule: condition chips from the reflection factors + an action
  («Wenn der Abschnitt in weniger als n Schritten frei ist, … halten»).
- Checked against the sandbox: the rule's action is played at each checkpoint
  it applies to; «Deine Regel hätte in k von m Fällen geholfen».
- Stored with the run and fed to the operator model as a confirmed learning
  record (the condition-scoped record of `colearning-across-modes.md` §2).

### WP4 — Second shift with visible adaptation (≈ 2 days)

- After the debrief, «Zweite Schicht»: a new session with a different incident of
  the same pattern, under the same operator id.
- The Alternatives module orders its options by the learned preference and says
  why («oben, weil du in Schicht 1 bei kurzem Puffer … bevorzugt hast») —
  ranking adjustment only, not a hard rule; Co-Learning keeps neutral options,
  so the order changes, not a «recommended» badge. *Open:* is ordering already
  too much steering for Co-Learning (brief §3.3)? Alternative: keep the order
  and only show the reason next to the option the profile matches.
- The rule from WP3 as a note in the reflection panel.
- Closing comparison: KPIs and decision time shift 1 vs 2; option order before
  and after.
- Mechanics can borrow from the Takt plan
  ([live-tours-shift-rounds.md](live-tours-shift-rounds.md) §3), but two separate
  runs are enough here.

**Order:** WP1 → WP2 → WP4 → WP3 (WP4 makes the AI direction visible, the
bigger gap; WP3 is valuable but can follow).

## 4. Decisions

- **Separate tour, interview untouched.** The interview tour keeps the
  precomputed cards (`sandbox` defaults to `'precomputed'`); its numbers are
  part of the thesis instrument.
- **Checkpoint taken by the HMI at the conflict, not by the backend on every
  step.** One fork per decision moment, only in tours that ask for it.
- **Compare with the run as played, not with a replay of the played choice.**
  The played run includes when the person decided (in the browser run, 18 steps
  after the conflict); replaying «the same option» from the checkpoint would hide
  exactly that cost of hesitating.
- **Same numbers as everywhere else.** Delay against the plan's arrival steps
  (`planned_arrival_steps`), same branch runner — the test pins the sandbox to the
  precomputed cards.

## 5. Open questions

1. WP4: does ordering options by the operator profile still count as Co-Learning
   («neutral options»), or does it belong to the Recommendation end? (§3 WP4)
2. Should the advanced tour end in a short questionnaire like the walk-through
   (Co-Learning items, NASA-TLX, UEQ-S)? Off for now.
3. Is the sandbox worth bringing into the interview tour after the thesis?
4. Checkpoints live in memory with the session; a backend restart loses them (the
   debrief then says «no decision moment kept»).
