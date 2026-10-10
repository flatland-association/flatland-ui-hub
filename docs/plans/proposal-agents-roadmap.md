# Plan — Proposal agents: a base algorithm with small agents on top

> **Status:** stage 1 done · stage 2a–2f built (seam, honest reroute, intermediate stops: 2026-10-05) · next: time-aware reroute, then stage 3 · started 2026-09-15 · owner: Daniel Boos
> **Related:** [colearning-monte-carlo-interviews-tour.md](colearning-monte-carlo-interviews-tour.md) ·
> [widget-b1-whatif-compare.md](widget-b1-whatif-compare.md) ·
> [recommender-roadmap.md](recommender-roadmap.md) ·
> [flatland-ecosystem-reuse-plan.md](flatland-ecosystem-reuse-plan.md)

## 1. Idea

The timetable is a skeleton — arrivals and intermediate stops — not a route. A
**base algorithm** (the TMS's main planner) plans routes that meet it. When a
disturbance breaks that plan, **small agents** propose local deviations: another
route, another priority into a single-track section, how long a train waits. The
**human** accepts one, takes their own, or rejects all. What was accepted or
overridden is recorded and, **later and offline**, improves the base algorithm.

This is the Co-Learning loop of the thesis (flow step 9, "input for the TMS
algorithm") and the consortium's own pattern (T3.4): the controller stays the
base decision layer and high-level decisions are injected at runtime; the
CBS+PP planning
([`AI4REALNET/flatland-blackbox`](https://github.com/AI4REALNET/flatland-blackbox))
is where the token-based interaction actually solves.

One surface for all of it: **Plan / KI / Mensch** — the plan as it would run on,
the agents' proposal, the human's choice — each with the same outcome figures.

## 2. Why in stages

A learning agent on the Walensee corridor (three trains, one conflict) would learn
next to nothing, and training infrastructure costs time the thesis does not have.
The interface, the display and the data capture can be right long before a trained
agent exists. So: first make the display honest, then put a planner behind the
proposal seam, then swap learning agents in behind the same seam.

## 3. Stages

### Stage 1 — Honest forecasts (≈ 1 day)

**Problem (measured 2026-09-15).** Plan-driven sessions (policy `plan`, e.g. the
Walensee scenarios) are forecast with a proxy: the plan policy is not registered for
branches (`supports_scenarios=False`, `PlanPolicy` needs the trainruns), so the map
forecast (`api/hmi.py _rollout_baseline`) and the what-if (`api/overrides.py
_policy_factory_for_session`) silently fall back to deadlock avoidance. For ICE_42
from step 30 the what-if "AI plan" stays on the lower track and never arrives, while
the real train switches tracks at column 95 and arrives at step 70; the "My plan"
branch with *Left* is identical. And the what-if delay counts only overdue steps
against very wide latest-arrival windows, so different routes read as "no
measurable change".

**Change.**
- A plan branch factory: branches of a plan-driven session roll out the session's
  own trainruns (`PlanPolicy`), in both the forecast and the what-if — the same move
  `director_replay_factory` makes for Director sessions.
- Branch outcomes carry the **arrival step** per train, and the what-if reports
  **delay against the plan** (planned arrival from the trainruns) next to the
  existing figures.
- The what-if widget shows arrival and delay vs. plan per branch.

**Affects the User Study 2 conditions** (same scenarios): their map forecast and
what-if become correct. Worth telling Adrian before the next study run.

**Done when:** for a plan session the forecast line and the what-if baseline of a
train follow the plan's route; a route choice that changes a train's arrival shows
a different arrival step; backend tests cover the plan factory and the arrival step.

**Status (2026-09-15): done in code.**
- `plan_branch_factory` / `planned_arrival_steps` in `policies/plan_policy.py`, used by
  `api/hmi.py _rollout_baseline` and `api/overrides.py _policy_factory_for_session`.
- `TrajectoryBranchRunner` records `arrival_step`; the what-if `train` block adds
  `arrival_step`, `planned_arrival`, `delay_vs_plan`, the response `baseline_source`,
  and the summary leads with the arrival difference.
- Widget B1 names the baseline "Timetable plan" in plan sessions and shows arrival and
  delay vs. plan per branch.
- Tests: `tests/test_plan_branch_forecast.py` (4) plus the updated agent-outcome keys in
  `test_scenario_runner.py`.
- Verified against the running backend on Walensee at step 32: the forecast baseline is
  `plan (current)` with all three trains arriving by step 70; the what-if baseline for
  ICE_42 follows the plan's track (row 0, col 95/96), arrives at step 70 (+7 vs. plan
  63), *Left* arrives at 71 — "arrives 1 step later". Not clicked through in the browser:
  selecting the train in the scaled preview pane did not register.

### Stage 2 — A proposal seam with a planner behind it (≈ 3–5 days)

**Design decisions (2026-09-15, after reading the sources).**
- **Solver: vendor, don't install.** `flatland-blackbox` is MIT (© 2025 Marius
  Captari, portions © 2019 Ashwin Bose). Its solvers need only `networkx`, but its
  `utils.py` imports `flatland.graphs` at module load, which Flatland 4.2.6 no longer
  has, and the package pins `flatland-rl==4.0.3` and pulls `torch`. So `solvers/pp.py`
  and the pure graph helpers it uses are copied into `backend/app/planners/blackbox/`
  with the licence notice, unchanged apart from imports; the blackbox PP tests come
  along.
- **Graph from the env: our own.** `T3.4-with-HMI`'s `state_extraction.py` does this
  but the repo carries no licence, so it is a reference, not a source. Enumerating
  Flatland transitions into a `(row, col, dir)` digraph is a few lines on our side.
- **Follow a replan with `PlanPolicy`.** A PP result is `(node, time)` per train;
  turned into a `TrainrunDict` it is exactly what `PlanPolicy` already executes. No
  plan follower to port, and the branch runner then scores Plan and AI proposal with
  the same figures as the human's choice (stage 1).
- **Replanning mid-run.** Trains start from their current cell and direction at the
  current step; arrived trains are left out; the malfunctioning train's cell is
  reserved for its remaining down time before planning.
- **Known limit:** PP routes straight to the target. The Walensee trains' intermediate
  calls, if any, are not honoured by the replan in this first cut.

**Sub-steps.**
- **2a** Backend: vendored PP + env graph + mid-run replan → proposals endpoint
  returning *Plan* (plan continuation) and *KI* (PP replan) per conflict, each
  simulated. Tests.
  **Status (2026-09-15): built.** `app/planners/blackbox/` (PP + helpers, MIT notice),
  `app/planners/replan.py` (`build_rail_digraph`, `replan_from_state`),
  `GET /session/{id}/proposals?handle=&action=` in `api/overrides.py` (variants
  `plan` / `ai` / `human`, each with train outcome, system KPIs, trajectories).
  Tests: `test_blackbox_pp.py` (ported upstream cases), `test_replan_proposals.py`.
  A replan on Walensee takes ~50 ms.
  **Finding — in the probed cases PP's default order reproduces the plan.** Tour
  incident (step 29/30), the never-experienced head-on case (35/38) and the study
  disturbance (19/22): the replan's arrivals equal the plan's. The plan is already a
  good solution there, so an "AI proposal" in default order says "keep the plan".
  **The priority order is where proposals differ.** Study disturbance at step 19:
  W1 first gets W1 in one step earlier but makes E1 or E2 arrive at 79 instead of
  63/64 — a real trade-off. In the single-track head-on cases W1 first has no
  collision-free plan at all. So the agent should offer *several* ranked orders
  (2c), not one replan.
- **2b** Frontend: widget B1 as Plan / KI / Mensch.
  **Status (2026-09-16): built.** A separate panel type `proposal-compare`
  (`features/proposal-compare/`, catalogue B1b, Co-Learning only) rather than a
  rewrite of `whatif-compare`: that widget is what the User Study 2 conditions
  show, and its framing (my plan vs. the AI's) is not this one's. The interview
  preset uses the new panel; the study presets are untouched.
  - Three columns for the selected train — Plan (neutral grey), KI (yellow, with
    its priority order in train names), Mensch (blue, the chosen option) — each
    with arrival vs. plan and trains arrived. Further AI orders behind a toggle.
  - Options: Halten, Halten bis frei, Weiterfahren, Umleiten. The backend's own
    sentence is shown when it refuses one (no reroute here).
  - The map overlay keeps the A3S colours: the operator's course blue against the
    AI's yellow once an option is picked, the AI against the plan before that.
  - "Übernehmen" goes through `TrainActionService` with a new `proposals` origin,
    so the decision log keeps the widget it came from. `Halten bis frei` commits
    as a hold and says that the release is the operator's, because the timed
    release lives in the simulated variant only.
  - Verified live on the tour session at step 52 with ICE_42: plan and KI both
    arrive at 70 (+7), order IC_703 → ICE_42 → RE_18, verdict "die KI würde hier
    beim Plan bleiben"; Halten bis frei adds the third column and the caveat.
    Note: at step 52 the malfunction is long over, so that option is free there —
    the telling case is the decision moment (the backend test: 72 vs. never).
- **2d** Impact panel: assessment and options split (2026-09-17, after a walkthrough).
  The panel assessed the situation *and* decided it, which read as hectic and put
  the Alternatives module inside the Risk & Impact one — thesis Table 1 keeps them
  apart, and Hamouche et al. (2026) frame supportive AI as helping the cognitive
  process rather than handing over a choice.
  - `TourBriefing.assessmentOnly` (interview tour only, so the **User Study 2
    conditions keep the panel they had**) → the impact panel drops its option
    buttons and the hover forecast, and states the situation instead: who is
    blocked by whom and where, when the train reaches the spot, when it clears,
    the **time buffer** ("keiner — der Zug stünde 6 Schritte"), and which kinds of
    measure exist ("Halten" / "Halten oder Umleiten"), plus how many trains are
    affected and how many decisions that asks for.
  - The row hands over: clicking it selects the train, which fills Plan / KI /
    Mensch, and the panel says so in one line.
  - Panel title in the preset: "Lage: Risiko & Auswirkung"; the guide steps
    "Alternativen" and "Entscheiden" now point at the proposals panel.
  - **Not covered: affected sectors** (Table 1). The frontend has no section model
    — stations are derived "S1…S5" labels from stop cells — so the panel names the
    blocked cell rather than inventing a sector.
- **2c** Options beyond the next switch: hold until clear, priority into the section.
  **Status (2026-09-15): backend built** (done before 2b, so the widget gets its final
  payload once).
  - `replan_orders(env)` in `planners/replan.py`: PP over priority orders (all orders
    up to four trains, else each train once in front), infeasible orders dropped,
    identical plans reported once.
  - `/proposals` ranks the orders by `score` (summed arrival delay vs. plan, +1000 per
    train not arriving): best is `ai`, the next ones `ai_alternatives` (`ai-2`, …),
    each with its `priority`. `ai_matches_plan` says when the best replan keeps every
    arrival of the plan.
  - Human side takes `option` = `hold` | `hold_until_clear` | `proceed` | `reroute`
    (or a raw `action`); `hold_until_clear` releases the hold after the impact
    analysis' `clears_in_steps` via the new `release_at` of `run_branch`.
  - Walensee tour, step 30, ICE_42: plan = ai `[0,1,2]` arrival 70 (+7), score 26;
    ai-2 `[0,2,1]` arrival 85 (+22), score 40; hold → never arrives (1/3);
    hold until clear → 72 (+9), 3/3; proceed = plan; reroute → none available.
  - Tests: `test_replan_proposals.py` (release ends a hold, distinct orders, ranked
    orders and hold-until-clear arriving).
  - ~~Open: route alternatives beyond the impact analysis' first switch.~~ Done in 2e.

- One interface for proposal agents, extending the existing pluggable
  `InterventionRecommender` (`core/recommenders/`, today `phase1_proximity`): per
  conflict it returns alternatives (route, priority, hold-until-clear), each already
  simulated.
  **Status (2026-10-05): built, as its own seam next to `InterventionRecommender`**
  rather than an extension of it — that one assesses who is affected, this one
  proposes what to do. `app/core/proposal_agents/` (`ProposalAgent`, registry,
  `PPReplanAgent` as `pp_replan`, the default). An agent `propose(env)`s
  `Proposal(priority, trainruns)` and `resolve(env, priority)`s the accepted one;
  it does **not** simulate or score — `/proposals` runs every course through the
  same branch runner and `_course_score` as Plan and Mensch, so no agent grades
  itself. `/proposals` now names the agent (`ai_agent`); the payload is otherwise
  unchanged and the widget untouched. Tests: `test_proposal_agents.py` (a stub
  agent drives both endpoints). Contract limit for stage 3: a course is a
  `TrainrunDict` followed by `PlanPolicy`, so a learning agent hands back its
  rollout as trainruns, not as a live policy.
- First agent, not learning: re-plan with PP/CBS from
  [`AI4REALNET/flatland-blackbox`](https://github.com/AI4REALNET/flatland-blackbox) —
  the canonical solver, already vendored. Reuse, not a new solver.
- Widget B1 becomes **Plan / KI / Mensch** (plan grey, AI yellow, human blue per the
  A3S convention), options go beyond the next switch: hold until clear, priority,
  route.

### Stage 2e — Honest reroute (2026-10-05)

**Problem (measured 2026-10-05, every scenario disturbance simulated).**
"Umleiten" was one action at the *first* switch on the shortest path
(`impact_analysis._reroute_action`); after it `PlanPolicy` drops the train off
its plan and deadlock avoidance drives it on the shortest path again — often
back to the block. And `can_reroute` only asked "is there a switch before the
block", not "does a way around it exist".

| Disturbance | `can_reroute` | Route around the block | "Umleiten" simulated |
|---|---|---|---|
| Walensee tour breakdown (single track) | no | no | refused — correct |
| Walensee `strategy-e1-breakdown-weesen` | yes | yes | +15, same as plan; AI +0 |
| Walensee `e1-late-into-the-section` | yes | yes | — |
| Olten `olten-breakdown-south` | **yes** | **no** | **train never arrives** |

**Decisions (Daniel, 2026-10-05).** No study is running, so the impact panel is
fixed too; the route is committed for real (a route override), not only compared.

- **A route, not an action.** `app/core/route_overrides.py`: shortest path on the
  rail digraph (`planners/replan.build_rail_digraph`) from the train's cell and
  heading to its target, with the cells of standing (malfunctioning) trains
  removed. It may leave the shortest path at any switch, not only the first.
- **`can_reroute` = such a route exists.** `reroute_action` / `reroute_cell` are
  the route's own move at its first switch (what the Trains table stars).
- **One more override value, `5` = REROUTE**, on the existing override channel —
  so the decision log, Co-Learning capture, forecast caches and what-ifs carry it
  without new plumbing. Committing it fixes the route there and then and keeps it
  on the env (`env._route_overrides`), which branch forks copy; `OverridePolicy`
  drives the train along it every step (not one-shot) and clears the override when
  the train arrives or is no longer on it. Setting 5 with no way around is a 409.
- **Frontend:** the impact panel, Plan / KI / Mensch and the hover forecast send 5
  instead of the first-switch action.

**Status (2026-10-05): built.** Shortest by distance alone failed at Weesen: the
route switched to the upper track at col 92 and stayed there, head-on into RE_18
(0/3 arrive). So the search prefers the train's own planned cells
(`OFF_PLAN_COST` = 3 per cell off the plan); a fork carries that plan as
`_route_reference_plan` (not `_trainrun_plan`, which would change the policy the
registry builds for it). Re-simulated: Weesen reroute arrives at 63 (+0, like the
AI; plan +15), 3/3; `e1-late` +1 like plan and AI, 3/3; tour breakdown and
Olten refused (409). Live in the browser on `walensee-recommendation-trust`:
Reroute in the impact panel sets override 5, ICE_42 runs the route, all three
arrive by step 77 and the override clears itself. Tests: `test_reroute.py` (6).

**Limits.** The route knows the blocks, not the other trains' timing: on a route
off the plan it can still meet an oncoming train, and the simulation then shows
that honestly. The contention forecast (`contention_cache`) ignores overrides by
design, so it may still flag a meeting the reroute avoids.

### Stage 2f — Intermediate stops in replan and reroute (2026-10-05)

**Problem.** The PP replan and the reroute both route straight to the target
(the "known limit" of 2a). The Walensee scenarios have no intermediate stops, so
it never showed — but Olten (23 of 52 trains), `pf-ch-corridor-stops` (16 of 16)
and the ECML scene have them. A replan there skips stations, and the comparison
does not say so.

**How Flatland counts a stop** (4.2.6 `rewards.DefaultRewards`): served when the
train is on one of the stop's `Waypoint(position, direction)` alternatives *and*
was `STOPPED` there; late arrival vs. `waypoints_latest_arrival` and early
departure vs. `waypoints_earliest_departure` are penalised.

**Decisions.**
- `app/core/stops.py`: the train's intermediate stops, which are served (from the
  env's reward tracker, read defensively; a fork carries the ones served before it
  forked), and which remain.
- **PP replan in legs** (`planners/replan.py`, a subclass of the vendored solver —
  the vendored files stay unchanged): start → each remaining stop → target, using
  the solver's own cooperative A* per leg. At a stop the train stands at least one
  step and until its earliest departure; the stand is reserved like any other
  occupancy. A stop the train can no longer reach (behind it) is skipped. Stop
  alternatives: the first one the leg reaches.
- **Reroute in legs** too (`route_overrides`); `route_move` holds the train at a
  stop until it has stood there and its earliest departure has come.
- **Outcomes** gain `stops_served` / `stops_total` per train, so Plan / KI / Mensch
  can be compared on them as well.

**Status (2026-10-05): built.** Three things the first cut ran into, all measured
on `pf-ch-corridor-stops`:
- *Passed stops looked reachable.* The digraph lets a train turn at a dead end,
  so a station it had passed was "reachable" by going to the end and back (one
  plan arrived at step 413). `stops.is_ahead`: a stop counts only when going
  through it costs at most 1.25 × the direct way + 10 cells.
- *Sequential PP failed as a whole.* Stops let a train stand on a platform the
  timetable gives the opposite direction shortly after, so a stand that went fine
  walked the train into a corner the trains planned earlier then closed. With
  stops no order was feasible at step 10 (14 of 17 without). Each train now tries
  its stops all / each one left out / none, most first (`_stop_subsets`); a
  skipped stop is a *Halteausfall*, scored at 100 per stop in `_course_score`.
  Feasible orders with stops now: 14 / 14 / 15 / 4 / 1 at steps 10–50 (without:
  14 / 13 / 11 / 13 / 3). A replan of 17 orders takes ~4–5 s there (~2 s without).
- *Late trains drove through.* `PlanPolicy` replays by position, so a train
  reaching its stop after the planned departure never stood and the stop did not
  count. `PlanPolicy._owes_a_stand`: where the plan stands at an unserved stop,
  the train stops once however late; a stop the plan passes through is left alone.
  After that every planned stand is served in the simulation (16 / 16 trains).

Proposals at step 20: the scenario's default policy (deadlock avoidance) calls at
no station — 31 stops missed, 5 trains out at the horizon; the best replan misses
10 (all trains arrive). A reroute serves the stops on its way (trains 5, 9, 11, 15:
3 / 3). Widget B1b shows a third axis "Ausgelassene Halte" where trains have
stops. Tests: `test_stops.py` (5).

**Limit found — reroute without a plan.** In scenarios without a plan (all the
stop scenarios) the reroute has nothing telling it which track runs which way,
and often takes the oncoming track (the 2e limit): of seven reroutes at step 20
only two arrive within the horizon. Next step: plan the rerouted train with the
solver's cooperative A* against the other trains' forecast, so the route is
time-aware — the same reservation idea the replan uses.

### Stage 3 — Learning agents behind the same seam (open-ended)

- MARL policies as proposal agents: decision-point action masking and a KPI
  calculator, baselines from `flatland-association/flatland-baselines`.
- Training data exists already: the decision log (accept / override, reason,
  response) and the operator model's confirmed learnings.
- Needs a scenario with more traffic and variants (e.g. Olten) to train on.
- Feeding accepted proposals back into the base algorithm stays offline and
  reviewed — the concept card in the tour debrief (step 9b).

## 4. Open questions

- Which base algorithm stands for "the TMS" in stage 2: the scripted plan replay,
  or PP re-planning from the timetable skeleton?
- Scope of an agent: per train, per conflict, per resource (single-track section)?
- What counts as the human's "own proposal" once options are routes, not actions?
- Evaluation: which KPIs decide between plan, AI and human (arrival delay,
  connections, stability — the operator model's value axes)?
