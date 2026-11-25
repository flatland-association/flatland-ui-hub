# KI suggestions computed for a step ahead (lead time)

Status: implemented, 25 November 2026.

## Problem

In Plan B (co-learning, `deadlock_avoidance`, `uc2_rl` adviser) a train affected
by a breakdown is held (localized blocking) until the participant takes a
course. The KI column's course is computed for the step it was requested at,
and accepting it requires the live state to be exactly that state
(`proposal_preview.exact_course`). While the clock runs, any step in between
refuses the acceptance (409 "stale"), the participant refreshes, and the same
happens again. The held train meanwhile stands.

Reproduced (2 s reaction time, refresh and retry up to 8 times):

| Scenario | Pace | Accept AI | Train held |
|---|---|---|---|
| uc2-4 | 3 s/step | refused 8/8 | 9 steps, gave up |
| uc2-4 | 0.5 s/step | refused 8/8 | 51 steps, gave up |
| uc2-2 | 0.5 s/step | refused 8/8 | 41 steps, gave up |

## Approach

The suggestion is computed for the step at which it can still be taken.

1. **Lead.** While the run plays, the panel asks `/proposals` with
   `lead_steps = ceil((compute time + reaction time) × steps per second)`.
   Compute time is the last measured request time (3 s before the first one).
   The reaction allowance is `SessionStore.proposalReactionSeconds`, 10 s by default.
   Paused, the lead is 0 and the behaviour is unchanged.
2. **Forecast.** The backend rolls a copy of the live state `lead` steps
   forward with what drives the session now (DLA plus the standing overrides,
   holds included). This copy carries every breakdown: one that is under way
   keeps its remaining down-time, and the Plan B scenarios' scheduled ones
   come from the scenario file. The forecast was checked against the live run
   step by step on uc2-1, uc2-2 and uc2-4, with no mismatch, including a
   breakdown that starts inside the window. Each step's per-train
   fingerprint (position, direction, state, malfunction counter) is kept.
3. **Course.** The adviser proposes from the forecast state. Each course is
   simulated from *now*: the current driver until the activation step, then
   the course (`SwitchAtStepPolicy`), with the overrides the acceptance will
   drop released at that step. So the plan, AI and human columns stay
   comparable from the same step.
4. **Accept before the activation step.** If the live state matches the
   forecast fingerprint at that step and the overrides are unchanged, the
   course is stored as *pending* and installed by the step loop
   (`step_env`) when the activation step is reached, after a second
   fingerprint check. The trains do what they would have done anyway until
   then.
5. **Divergence or late accept.** The course is replayed from the live state
   (`PlanPolicy` follows it by position and order). It is installed if it
   gets at least as many trains home without more deadlocks than the preview
   promised. Otherwise it is refused (409 at accept; a `rejected` activation
   in the state payload).
6. **Deadline.** The KI column shows how long the course can still be taken.
   When the deadline passes, the panel asks again by itself, without an error.
   A 409 also leads to a reload, not only to a message.
7. **Cancelling.** A pending course is dropped when the participant decides
   anything else for the same train, takes another course, or resets the
   session.

## New files

| File | Adds |
|---|---|
| `backend/app/policies/switch_policy.py` | `SwitchAtStepPolicy`: one policy until a step, another from it |
| `backend/tests/test_proposal_lead.py` | Lead forecast, pending activation, divergence re-check, cancelling |
| `docs/plans/proposal-lead-time.md` | This plan |

## Modified files

| File | Change |
|---|---|
| `backend/app/core/proposal_preview.py` | `fingerprint`, forecast data on `PreviewCourse`, `lead_course`, `matches_forecast`, pending course get/set/clear; `clear_previews` also drops the pending course |
| `backend/app/api/overrides.py` | `/proposals?lead_steps=`; forecast roll-forward; courses scored with the switch; `apply_proposal` accepts lead courses (pending / install / re-check); `activate_pending_course`; install code shared; set/clear override cancels a pending course for the train |
| `backend/app/core/env_step.py` | `step_env` activates a due pending course |
| `backend/app/api/sessions.py` | `/step` rebuilds its driver after an activation; reset clears previews; `/state` carries `pending_course` / `course_activation` |
| `backend/app/api/websockets.py` | Same two fields in the broadcast state |
| `frontend/src/app/core/api.service.ts` | `lead_steps` parameter; result and state fields |
| `frontend/src/app/core/models.ts` | `ai_activation_step`, apply reply `pending` / `activation_step`, state fields |
| `frontend/src/app/core/session.store.ts` | `proposalReactionSeconds` |
| `frontend/src/app/features/proposal-compare/*` | Lead request, deadline shown in the KI column, automatic re-ask when it passes or after a 409, "takes effect in …" after a pending accept |
| `frontend/public/i18n/{en,de,fr}.json` | New keys for the deadline and pending texts |

## Open

- The 10 s reaction allowance is a default, not a study decision yet.
  At fast paces it means a long lead, e.g. 20 steps at 0.5 s/step, during
  which the course cannot change anything.
- Live runs with random breakdowns (`_live_seed`): the branch forks draw no
  new breakdowns, so one inside the window shows up as a divergence and goes
  through the re-check.
