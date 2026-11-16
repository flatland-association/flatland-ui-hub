# UC2 RL adviser: multiple future courses and exact acceptance

Status: implementation, 16 November 2026. Base: Manuel's
`feat/uc2-rl-proposal-agent` (`a1b9c7b0`), including recovery-trained models.
Previous driver performance is not evidence of adviser quality from DLA states.

## Required behavior

The baseline Driver remains the current DLA/scenario plan. UC2 RL is a separate
adviser. It rolls all trains forward jointly on isolated native environment
copies and proposes complete executable trainruns. Human approval installs a
selected course through the existing accepted PlanPolicy contract. Preview KPIs
come from replay through that same PlanPolicy, not from an unrealized RL future.

Extend the current single greedy course with bounded model-only alternatives
for the selected train: legal future branch decisions and short waits, then
continue with the unchanged frozen actor. Keep joint ROAM certification for
all train actions, including each intervention. The greedy course remains a
candidate. Bound candidate count and use the native remaining horizon; no PP
solver or online learning is invoked by this adviser. Reuse native forks,
TrajectoryBranchRunner, existing PlanPolicy and the proposal-agent seam.

The API independently scores all courses with the existing completion/lateness
objective and returns the best plus alternatives. Courses have additive stable
candidate identifiers and descriptions; PP priority orders retain their meaning.
The selected train is explicit, never inferred from list order. No changes to
Recommendation/Co-Learning/Director semantics or persisted IDs.

## Snapshot and acceptance contract

Capture one coherent current state, Driver factory and standing overrides;
compute the baseline and all alternatives from that root in a bounded worker.
The live session is not stepped while generating suggestions. GET is read-only.
Cache only a small bounded set of executable trainruns, not fork environments.
An opaque preview token identifies the exact shown course. Acceptance checks
source environment identity, step, Driver and standing overrides/state; reject
stale/unknown candidates without mutation. New clients submit the token and
source step. Existing PP/older-client acceptance remains compatible. Session
mutations/play must serialize with capture/apply for UC2 adviser sessions, as
for specialist Driver transactions. Pause/reset stay responsive while expensive
forecasting operates on copies.

## New files

| File | Purpose |
|---|---|
| `backend/app/core/proposal_preview.py` (if needed) | Bounded token cache, source-state identity and exact trainrun retrieval |
| `backend/tests/test_uc2_rl_adviser_lookahead.py` | Native future alternatives, source immutability, bounded search, ROAM and replay contracts |
| `backend/tests/test_proposal_preview_acceptance.py` | Exact alternative acceptance, stale rejection, Driver separation and concurrency |
| `backend/tests/test_proposal_horizon_scope.py` | Full native horizon for the UC2 adviser; preserve the existing 250-step cap for other proposal agents |
| `backend/tools/evaluate_uc2_adviser.py` | Paired frozen DLA-takeover diagnostics, exact greedy parity and source/model identities |
| `docs/examples/uc2-rl-adviser/` | Portable paired takeover/latency evidence and real-browser results |

## Modified files

| File | Change |
|---|---|
| `backend/app/core/proposal_agents/base.py` | Additive candidate metadata and handle-aware methods with legacy delegation |
| `backend/app/core/proposal_agents/uc2_rl.py` | Bounded greedy/branch/wait rollout candidates, cleanup and deterministic IDs |
| `backend/app/api/overrides.py` | Frozen-root worker evaluation, candidate metadata/tokens and exact acceptance |
| `backend/app/core/pf_ch_control.py`, `backend/app/api/websockets.py` | Reuse command locking for UC2 adviser sessions even when Driver is DLA/plan |
| `frontend/src/app/core/events/event-types.ts`, `core/api.service.ts` | Additive candidate/preview fields |
| `frontend/src/app/features/proposal-compare/*` | Display/select a future course, send its token, preserve decided snapshots and late-response guards |
| `frontend/public/i18n/{en,de,fr}.json` | Course descriptions/selection labels |
| `docs/experiment-logging.md` | Regenerated click-ID table for the two new controls; existing IDs preserved |
| `backend/tests/test_uc2_rl_proposal_agent.py` | Replace obsolete single-course assertions, preserve existing tests |
| Existing proposal component specs | Candidate selection and exact request regression coverage |
| `docs/plans/uc2-rl-proposal-agent.md` | Link the implemented follow-up and current results |
| `docs/examples/uc2-{rl,roam,roam-performance}/README.md` | Mark earlier actor/ROAM benchmark architecture as historical and link the current adviser |

## Acceptance

Acceptance additionally clears old off-course flags in `overrides.py`, and
playback reloads a replacement course even if its Driver ID remains `plan`.
The PlanPolicy implementation and frozen model assets are unchanged.

- Real multi-step alternatives from future decision points; no live-state or
  Driver mutation during preview; no planner fallback inside UC2 adviser.
- The full native remaining horizon applies to UC2 advice only; other agents
  retain the existing bounded forecast horizon and cost profile.
- Whole-batch ROAM checks include forced alternatives before native stepping.
- Independent scoring of all trains, completion ahead of lateness; deduplicate
  identical executable courses and bound computational/memory cost.
- Preview/accept/replay agree, including fractional speed, waiting, native faults,
  accepted-plan persistence while the client continues pinning DLA, and stale
  or deleted/reset session rejection.
- Measure paired original-versus-lookahead adviser results from DLA takeover
  states on all five supported maps. Report regressions and latency honestly.
- Focused meaningful backend/frontend checks, required full checks, production
  browser verification and reviewable commits on the existing main-target PR.
