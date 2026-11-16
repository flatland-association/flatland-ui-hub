# UC2 RL adviser: the operator's decisions count per train

Status: implemented, 16 November 2026. Builds on
[uc2-rl-proposal-agent.md](uc2-rl-proposal-agent.md) and
[uc2-rl-adviser-lookahead.md](uc2-rl-adviser-lookahead.md).

## Problem

In Plan B the dispatcher stops a train, then asks the KI for another train's
options. The `uc2_rl` adviser rolled every train on from the current state
**without** the standing overrides, and accepting a KI course cleared all of
them. Measured on the tutorial (train 0 stopped at (2,13), train 1 waiting
at B, KI asked for train 1):

| | Before |
|---|---|
| KI courses | Train 0 drives on home in every course, despite the stop |
| Accept | All overrides cleared; 6 steps later train 0 is at (2,19) |

So the KI never answered the dispatcher's actual question ("how do the
others get round the train I stopped?"), and taking its course silently undid
the dispatcher's decision.

## Decision

The last decision wins, **per train**:

- A KI course for the selected train keeps every **other** train's standing
  override (stop, turn, reroute), applied where the live `OverridePolicy`
  applies it.
- The selected train's own override is what the courses answer. Asked about
  a stopped train, the KI may suggest moving it again.
- Accepting installs the course as the plan for the trains without a
  decision, clears only the selected train's override, and leaves the others
  standing (they stay outside the plan, under their override).
- `pp_replan` is unchanged: its courses answer for every train, and accepting
  one still clears every override.

## Found while building: ROAM must see the stops

Applying the stops after the joint ROAM check is not enough. ROAM certifies
the batch the model proposes. It assumed the stopped train 0 would move east,
saw a head-on meeting on the single track, and withdrew train 1's departure,
in every step of every course, so train 1 stayed at B for good. The kept
overrides therefore go into the proposals **before** `finalize_actions`, and
ROAM certifies the step that actually runs.

The same order (overrides after ROAM) exists when `uc2_rl` is a session's
*driver* (the RL tours). Plan B is not affected, because DLA drives there. It
is left for a separate change.

## Design

- `ProposalAgent.respects_overrides` (default False). `propose_for` and
  `resolve_for` take an optional `overrides`; agents that don't respect them
  ignore it.
- `UC2RLProposalAgent` (`respects_overrides = True`): `propose_for` drops the
  selected train's own override and passes the rest to `_rollout`, which
  applies them each step with `_apply_kept_overrides` before ROAM: a reroute's
  move every step; any other action only at a switch or merge, where a stop
  stays and a turn is used up.
- `/proposals`: each KI course is scored as it runs once accepted:
  `PlanPolicy` over the course without the kept trains, plus the kept
  overrides. The response says `ai_keeps_overrides`.
- `/proposals/apply` (`ai`): the course, preview token or re-derived, minus the
  kept trains becomes the plan; only the selected train's override and route
  are cleared. The preview token already binds the standing overrides, so a
  change in between gives 409.
- Frontend: after taking the KI course, the note says that stopped or
  rerouted trains keep the dispatcher's decision (`proposals.aiTakenCaveatKept`).
- Also carried: what-if forks rebuild `agent_positions`, which Flatland's
  persister empties (flatland-rl #576), so a driver reading it doesn't miss
  standing trains.

## New files

| File | Purpose |
|---|---|
| `backend/tests/test_uc2_rl_keep_human_decisions.py` | Kept stop in courses and scoring, accept per train, PP unchanged, fork positions, and the tutorial situation through the API to the arrival |

## Modified files

| File | Change |
|---|---|
| `backend/app/core/proposal_agents/base.py` | `respects_overrides`; optional `overrides` on `propose_for`/`resolve_for` |
| `backend/app/core/proposal_agents/uc2_rl.py` | `respects_overrides = True`; `_apply_kept_overrides` before ROAM in `_rollout`; `overrides` through `propose_for`/`resolve_for` |
| `backend/app/api/overrides.py` | `_kept_overrides`, `_plan_without`; scoring with kept overrides; accept clears per train for such agents; `ai_keeps_overrides` |
| `backend/app/core/scenario_runner.py` | `_fork_env` rebuilds `agent_positions` |
| `frontend/src/app/core/events/event-types.ts` | `ai_keeps_overrides` |
| `frontend/src/app/features/proposal-compare/proposal-compare.component.html` (+ spec) | Note after taking the KI course |
| `frontend/public/i18n/{en,de,fr}.json` | `proposals.aiTakenCaveatKept` |

## Results (16 November 2026)

Same tutorial situation as above:

| | Before | After |
|---|---|---|
| KI best | Train 0 drives on; train 1 doesn't arrive | Train 0 stays at (2,13); train 1 departs at once, goes round the loop and arrives |
| Accept | Overrides `{}`; train 0 drives on | Overrides `{0: STOP}`; train 0 stays; train 1 arrives while the client keeps pinning DLA |
