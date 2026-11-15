# UC2 RL as the "KI" proposal agent in the user study

Status: done, 15 November 2026. Builds on
[uc2-rl-per-infrastructure.md](uc2-rl-per-infrastructure.md) and the proposal
seam of [proposal-agents-roadmap.md](proposal-agents-roadmap.md) (stage 3,
"learning agents plug in here").

## Problem

In the Plan B study conditions the AI's suggestion is the **KI** column of
*Plan / KI / Mensch* (`proposal-compare`). Today it comes from `pp_replan`:
Prioritized Planning over priority orders, which is a heuristic planner. The
trained UC2 model (one per infrastructure, see the plan above) is only used in
the separate RL demo tours. The study should use the trained model for the AI
suggestions.

The trains keep running on `deadlock_avoidance` until the participant takes
a course, as now. That is the *Plan* column and `policyAllowlist`, and both
stay unchanged.

## Measured before building

- **Takeover from the study's own states.** The study runs on DLA, so the
  suggestion starts from a DLA-driven state. Taking over from DLA-driven states
  at every 1/24 of the horizon, on all five study scenarios, the RL model
  finishes at least as many trains as DLA continuing; in the tutorial it does
  strictly better up to step 15 (2/2 against 1/2).
- **The course contract holds.** A course is a `TrainrunDict` followed by
  `PlanPolicy`. Replaying an RL rollout through the real branch runner gives
  identical arrivals on tutorial, uc2-1, uc2-2 and uc2-4 at every start
  tested. On uc2-3, two trains with fractional speed arrive one step later.
  The KI column always shows the *replayed* course, which is exactly what
  accepting it runs, so the display stays honest.

## Design

- **New proposal agent `uc2_rl`** (`app/core/proposal_agents/uc2_rl.py`):
  - `propose(env)`: roll the registered `uc2_rl` runtime policy (UC2-track
    or tutorial model, ROAM included) out on a deep copy of the current state.
    Record every train's cell entries as trainruns, the same shape as
    `replan._to_trainruns`. The agent returns one course with an empty
    `priority`: the model has no priority order, and the widget then shows
    no "Order: …" line.
  - `resolve(env, priority)`: the same rollout from the then-current state.
    It is deterministic, and `priority` is ignored.
  - `available(env)` is true only when the UC2 bundle is compatible with the
    env and Torch imports.
- **Selection per session, not global.** `CreateSessionRequest.proposal_agent`
  (optional) is validated against the registry and stored on the session.
  `/proposals` and `/proposals/apply` use `proposal_agent_for(session)`:
  - the session's agent if it is available for this env;
  - otherwise the default `pp_replan`.

  The Walensee legs of "Plan B · UC2-01" therefore fall back to PP. The
  response's `ai_agent` names the agent actually used, so the study data
  shows which AI made each suggestion.
- **Frontend.** `StudyCondition.proposalAgent` (optional) passes through
  `legSessionOpts` → `NewSessionOpts.proposalAgent` → payload `proposal_agent`.
  The Plan B conditions set it to `uc2_rl`. No widget, wording or layout
  change.
- **Unchanged:**
  - the default agent for every other session;
  - the scoring in `/proposals` (no agent grades itself);
  - the impact panel and its recommender (who is affected, how long until
    clear);
  - the forecast;
  - overrides, ROAM and the models.

## New files

| File | Purpose |
|---|---|
| `backend/app/core/proposal_agents/uc2_rl.py` | `UC2RLProposalAgent`: rollout → trainruns |
| `backend/tests/test_uc2_rl_proposal_agent.py` | Rollout/replay parity, selection and fallback, session field validation, apply installs the RL course |

## Modified files

| File | Change |
|---|---|
| `backend/app/core/proposal_agents/base.py` | `ProposalAgent.available(env)` (default True) |
| `backend/app/core/proposal_agents/registry.py` | Register `uc2_rl`; `proposal_agent_for(session)` with fallback |
| `backend/app/api/overrides.py` | `/proposals` and `/proposals/apply` use `proposal_agent_for(session)` |
| `backend/app/models/session.py`, session creation in `app/api/sessions.py`, `app/core/session_manager.py` | Optional `proposal_agent` on create, stored on the session |
| `frontend/src/app/core/demo/study-conditions.ts` | `StudyCondition.proposalAgent`; Plan B conditions `uc2_rl` |
| `frontend/src/app/app.component.ts` (`legSessionOpts`), `NewSessionOpts`, `core/session.store.ts` (payload) | Pass it to the session |
| `backend/app/policies/plan_policy.py` | `accept_trainrun_plan`, `plan_accepted`, `revert_accepted_plan` |
| `backend/app/policies/registry.py` | `driving_policy_id`, `create_driving_policy` |
| `backend/app/api/sessions.py` (`/step`, `/policy`, `/reset`), `backend/app/api/websockets.py` (play loop) | Follow an accepted plan while a dispatching policy is pinned; revert on switch/reset |
| `backend/app/core/contention_strategies.py` | Accepting a PP strategy marks the plan accepted |
| `backend/app/core/trajectory_recorder.py` | Study `meta.json` records the proposal agent |

## Found while building: an accepted AI plan was dropped (pre-existing)

Accepting a KI course installs it as the session's plan and sets the session
to `plan`. The Plan B frontend, however, keeps sending its pinned
`deadlock_avoidance` with every step and play. The step endpoint and the
play loop then built DLA again, so the accepted course was dropped on the
next step. The panel's own text says the opposite: *"Die Züge fahren ab jetzt
nach dem Plan der KI."* This happened with `pp_replan` too.

Measured: tutorial, KI taken at step 6. The KI forecast was 2/2, but only
1/2 arrived, for both agents.

**Fix:**
- `plan_policy.accept_trainrun_plan` marks an accepted plan.
- `registry.driving_policy_id` / `create_driving_policy`: a live request for
  an ordinary dispatching policy keeps following the accepted plan, and the
  requested policy drives only trains off the plan (`PlanPolicy` fallback).
  RL drivers are unaffected.
- The `/step` endpoint and the play loop use it. The play loop switches on the
  next step when the plan is taken while it runs.
- A deliberate `POST /policy` switch, and a reset, revert to the session's own
  plan.

Both accept paths are covered: `/proposals/apply` and the contention
strategies' `pp`/`pp-human`.

## Results (15 November 2026)

| Check | Result |
|---|---|
| KI agent per session | UC2 legs with `proposal_agent: uc2_rl` → `uc2_rl`; Walensee leg → `pp_replan`; sessions without the field → `pp_replan`; unknown id → 400 |
| Rollout replay | KI course shown = course run after taking it. Tutorial at step 6: KI 2/2 against Plan (DLA) 1/2 |
| Accept while the client pins DLA | Before the fix: 1/2. After: 2/2, realised arrival equal to the KI forecast (tutorial 24; uc2-3 128), including when taken during playback |
| Real Plan B UI (`plan-b-p01`, tutorial leg) | Handlungsoptionen: PLAN 1/2, **KI 2/2** (`uc2_rl`); KI taken at step 15, the leg ends 2/2 (steps 31, 36). Screenshots in `uc2-rl-proposal-agent/` |
| Latency of `/proposals` with `uc2_rl` | 0.07 s (tutorial) to 0.9 s (uc2-3) |
| Checks | Backend 1,017 passed, 22 skipped; `lint:styles`, `i18n:check`, production build pass |

Study data: the trajectory `meta.json` of each session records
`proposal_agent_requested` and `proposal_agent` (the agent that serves the
env).

## Remaining

- **The KI course from DLA-driven states can be later than PLAN.** The
  takeover check above compared arrivals only. Comparing lateness on ten study
  situations (15 November): `uc2_rl` is better than `pp_replan` on uc2-3
  (22 against 50) and equal on the tutorial and uc2-4. It is worse on uc2-1
  and uc2-2: for example uc2-1 asked at step 30 gives 72 against PP's 19, and
  31 if nobody acts. Cause: the study's states are driven by DLA (e.g. train 2
  on the other track), which the model never saw in training; the fit itself
  is not capacity-limited (4 of 283,439 known states differ from the
  teachers). Follow-up: measure systematically from DLA states, add a
  model-only lookahead to the agent, and refit on DAgger labels from DLA
  takeover states.
- When a UC2 session has no timetable trainruns, the timetable yardstick
  after an accept is the accepted plan (`baseline_trainruns_from_env`
  falls back to `_trainrun_plan`). This is pre-existing and not changed here.
- The impact panel ("Lage: Risiko & Auswirkung": who is affected, how long
  until clear) is still the proximity recommender. Swapping it is a separate
  decision.

## Done when

- In a Plan B leg the KI column is computed by `uc2_rl` (`ai_agent.id`).
  Taking it installs the RL course, and the run continues on it.
- The Walensee legs and every non-study session still show `pp_replan`.
- Backend tests, `npm run lint:styles`, `npm run i18n:check` and the
  production build pass; a Plan B leg is checked in the running app.
