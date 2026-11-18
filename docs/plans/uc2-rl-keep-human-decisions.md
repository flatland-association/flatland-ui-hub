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
- ~~Accepting installs the course as the plan for the trains without a
  decision, clears only the selected train's override, and leaves the others
  standing (they stay outside the plan, under their override).~~ Revised
  2026-11-18 (F-1): outside the plan, the plan's fallback (Deadlock Avoidance
  in Plan B) drove those trains, not the model the course was built with, so
  the accepted course was not the one shown.
- **Accepting takes the AI's full course as the plan** (decided 2026-11-18,
  F-1): every train, the kept ones included, runs as the course simulated it.
  The other trains' standing overrides stay, because the course was simulated
  with them; only the selected train's override is cleared.
- **A conflicting course can be replaced:** when the accepted course runs into
  a conflict, the dispatcher asks for suggestions again and accepting another
  one replaces the whole plan (decided 2026-11-18, F-1). Planned in S-1.
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
  overrides (S-1: over the full course). The response says `ai_keeps_overrides`.
- `/proposals/apply` (`ai`): the course, preview token or re-derived, minus the
  kept trains becomes the plan (S-1: the full course); only the selected train's override and route
  are cleared. The preview token already binds the standing overrides, so a
  change in between gives 409.
- Frontend: after taking the KI course, the note says that stopped or
  rerouted trains keep the dispatcher's decision (`proposals.aiTakenCaveatKept`).
- Also carried: what-if forks rebuild `agent_positions`, which Flatland's
  persister empties (flatland-rl #576), so a driver reading it doesn't miss
  standing trains.

## Scope of the sections below

They cover the whole diff to `main` (fd0c70cb), not only this PR: this PR
([#208](https://github.com/flatland-association/flatland-ui-hub/pull/208), 2 commits) builds on
[#196](https://github.com/flatland-association/flatland-ui-hub/pull/196) (`codex/pf-ch-rl-main`, 32 commits), which
is not merged yet. The features, with the PR that brings them (files per feature: "Change inventory of #196 and
#208, by feature"):

- **A. The learned policies and their training** (#196): the PF-CH and UC2 actors, the ROAM guard, one specialist per
  infrastructure, the lab that trains, evaluates and exports them.
- **B. RL as the session's driver** (#196): the RL tours and demos, model inference in a worker.
- **C. `uc2_rl` as the KI proposal agent in Plan B**, and accepted plans keep driving (#196).
- **D. N-step adviser futures**: bounded courses, previewed and accepted exactly (#196).
- **E. Override-aware courses**: the dispatcher's decisions count per train (#208, this plan).
- **F. Stop-aware PP and plan admission** (#196).
- **G. Supporting work** (#196, one fix in #208): memory bounds, lateness from Flatland, bug fixes, deployment.

## Limitations

What the built code gets wrong or ignores. The model and evaluation limits are also in the plans of #196
([uc2-rl-per-infrastructure.md](uc2-rl-per-infrastructure.md),
[uc2-roam-performance.md](uc2-roam-performance.md),
[pf-ch-rl-main-integration.md](pf-ch-rl-main-integration.md) "OOM review and limits") and in the module docstrings
named below. No `TODO` in the diff tracks any of them.

- **E. Overrides after ROAM when `uc2_rl` drives** (RL tours): `websockets.py:154-155` applies the overrides after
  `finalize_actions`, so ROAM certifies a batch that does not run (see "Found while building"). Plan B is not
  affected (DLA drives). Left for a separate change.
- **E. Only `uc2_rl` keeps overrides.** `pp_replan` courses still answer for every train, and accepting one clears
  every override (`overrides.py:570`).
- **A. Models only for their fixtures.** UC2 runs only on the five native Plan B fixtures (6×25, 8×78 grids;
  `uc2_bundle.py:56-64`, re-hashed at load), PF-CH only on the 9×191 corridor with ≤ 16 trains
  (`pf_ch_bundle.py:45-55`). Elsewhere the policy is refused, not replaced. Generalisation to unseen timetables is
  not claimed.
- **A. Evaluation.** The baseline bundle fails 2 of 50 final holdout cases (`uc2_demo_ppo.json`
  `validation.final`); the specialists' 1472 cases are known train/dev/regression cases, no new holdout; UC2-3 keeps
  PP lateness regrets ([uc2-rl-user-command-recovery.md](uc2-rl-user-command-recovery.md)).
- **A. ROAM is a sufficient test only.** A rejection does not prove a deadlock (`roam_check.py:13-15`); it forecasts
  only the malfunctions known now (`roam_joint_check.py:10`); without a legal action left it raises, there is no
  planner fallback (`uc2_roam_policy.py:68-69`).
- **D. Futures ignore future incidents.** Forks switch random live faults off (`uc2_rl.py:218-227`); session-scripted
  disturbances are not forecast. The UC2 adviser forecasts the whole remaining episode (500 steps without a limit,
  `uc2_rl.py:230`) and builds at most 8 courses (`uc2_rl.py:38-39`).
- **D. Stale preview.** An accept whose preview no longer matches gets 409; the UI shows "preview expired" and the
  operator refreshes by hand (`proposal-compare.component.ts:309-312`).
- **D. Preview capacity.** At most 2 previews run and 2 wait per process, the next gets 503; 16 tokens per session
  (`proposal_preview.py:178-180,251-252`).
- **B, D. One process.** Command locks, the inference pool and the preview tokens live in one process's memory
  (`pf_ch_control.py:35-42`, `proposal_preview.py:220-229`); a second ASGI worker would break them
  (`deploy/hf/Dockerfile:33`).
- **G. Global cache clearing.** Flatland's process-wide caches are cleared on session delete and reset, after every
  proposal evaluation and every UC2 rollout; other live sessions recompute (`native_env_cache.py:9-12`). The method
  list is Flatland 4.3's.
- **G, F. Flatland internals read defensively:** served stops from the reward tracker (`stops.py:90-118`), the
  rebuilt `agent_positions` on forks (`scenario_runner.py:368`, flatland-rl #576).
- **F. Plan admission and strict stops are lab-only.** `plan_validation`, `director_pp` and `carry_served_to_fork`
  have no caller in `backend/app`, only in `backend/lab/marl/`. Non-strict stop-aware PP may drop stops and retries
  a bounded number of times (`replan.py:113-131`).
- **B. RL tours only for PF-CH corridor and UC2 tutorial/1-4**, without survey or study logging (`tours.ts`). The
  `preset-pf-ch-rl` layout has no `nameKey` and shows its English name in every language
  (`layout-presets.ts:1092`).
- **C. No visible agent.** Legs `uc2_rl` cannot serve fall back to `pp_replan` on the server; the UI does not say which
  agent proposed.
- **G. French** strings are drafts without a native review.

## Breaking changes

None for API callers that send what they sent before: new request fields are optional, new response fields are
additive, new policies and presets only appear. What changes behaviour or data:

| Change | PR | Who is affected | Compatibility |
|---|---|---|---|
| **Fix: an accepted AI course is no longer dropped** when the next Step/Play names the condition's pinned policy (Plan B: Deadlock Avoidance, set by the study condition, no dropdown shown). After an accept, `/step` and `/play` with an ordinary policy follow the course (`driving_policy_id`, `registry.py:381`); that policy only drives the trains off the course. `session.policy` reads `"plan"`, the play log `"deadlock_avoidance->plan"`. Example below. | #196 | Every client and study condition that pins its policy per request; server logs. Nothing new on screen. | A reset, or choosing a policy in the toolbar dropdown (`POST /policy`, only outside Plan B), drops the course. RL drivers are left alone. Not kept on purpose: on `main` the panel said the trains follow the AI's plan while they did not. |
| **Proposal ranking and score.** Courses rank by (not arrived, lateness, time in network) (`overrides.py:448`); `score` no longer credits early arrival (`:389`); the arrival reference includes the native deadlines (`:397`). | #196 | `pp_replan` results too: the order and the scores of the variants differ from `main`. | Not kept: the old score let early trains cancel another train's lateness. |
| **Accepting a `uc2_rl` course** clears only the selected train's override and route; the others keep theirs, and (after S-1) the whole course becomes the plan. | #208 | Plan B sessions. | `pp_replan` keeps clearing every override. |
| **New status codes:** `GET /proposals` 503 when the preview pool is busy and 409 when the session goes away; `POST /proposals/apply` 409 for a stale or misused `preview_token`. | #196 | API clients. | Clients that send no token keep the old accept. |
| **Stop-aware PP by default.** `replan_from_state`/`replan_orders` route through the remaining intermediate stops (new keyword-only `strict_stops`, `wait_cells`, `wait_states`). | #196 | PP results on scenarios with stops (PF-CH corridor stops). | Signatures compatible; results differ. |
| **Plan B's KI suggestions.** Plan B conditions send `proposal_agent: 'uc2_rl'` (`study-conditions.ts:197,240`): RL courses with an intervention ("wait", "branch at step N") instead of PP priority orders. | #196 | Study data: earlier and later Plan B runs share condition ids but not the stimulus. | Condition ids kept on purpose (stored ids); the record's trajectory metadata names `proposal_agent`. |
| **Lateness in records.** `outcomeOf().totalDelay` and the leg KPIs count the accrued lateness of arrived trains (`shiftKpis`, `shift-review.ts:41`); before, a DONE train counted 0 (UC2-3: 0 → 39). | #196 | Saved outcomes, shift review, tour debrief; comparing old and new records. | Same field names; payloads without `accrued_lateness` fall back to `delay`. Old records need re-deriving to compare. |
| **Call log.** `response_same_as` back-references reset on a scope change and after the 64-entry LRU eviction. | #196 | Size of exported call logs. | Replays the same; more full responses. |
| **Images.** All three Dockerfiles install CPU `torch` and set `OMP/OPENBLAS(/MKL)_NUM_THREADS=1`; the image ships 3.8 MB of checkpoints. `requirements*.txt` unchanged. | #196 | Image size and build time; bare-metal installs. | Without `torch` or a bundle file the RL policies are hidden; a changed bundle or Plan B fixture fails closed (`verify_bundle`). |
| **Vendored MIT code** (ECML observation, ROAM) with its licence files. | #196 | Distribution. | MIT attribution ships with the backend. |

Example: taking the AI's course in Plan B, tutorial (2 trains), as measured in
[uc2-rl-proposal-agent.md](uc2-rl-proposal-agent.md) "Found while building".

- **Same start:**
  - The study condition fixes the driving policy as Deadlock Avoidance; nothing on screen shows it. The scenario plays
    by itself, and every Step/Play request names Deadlock Avoidance.
  - At step 6 the participant opens the AI's suggestions; the AI column forecasts 2 of 2 trains arriving.
  - The participant takes the AI's course. The panel says «Die Züge fahren ab jetzt nach dem Plan der KI.»
- **Before (`main`):**
  - The server stores the course as the plan, but the next step names Deadlock Avoidance, so the server builds it
    again and ignores the course.
  - 1 of 2 trains arrives, not the 2 of 2 forecast. Nothing on screen shows it; the panel still says the trains follow
    the AI's plan, and the study log records an AI course as taken that the trains never followed.
- **After (#196):**
  - The server marks the course as accepted and keeps driving with it, although the next step still names Deadlock
    Avoidance; Deadlock Avoidance moves only trains outside the course.
  - 2 of 2 trains arrive, as forecast. The screen looks as before; the server log shows `deadlock_avoidance->plan`.
  - Only a reset («Neu starten») drops the course; Plan B has no policy dropdown.
- **With #208 on top** (the case of "Problem": train 0 stopped by the participant, the AI asked about train 1):
  - Before #208: the AI's courses let train 0 drive on despite the stop; taking a course cleared the stop and train 0
    drove off.
  - After #208: the courses keep train 0 stopped and send train 1 round it; taking the course keeps the stop, train 0
    stays and train 1 arrives. The panel says that trains with the participant's decision keep it.

Changed wording only (keys kept): `proposals.aiMatchesPlan`, `showAlternatives`, `hideAlternatives` ("orders" →
"courses"). No i18n key, tour, preset, condition or `data-log` id is renamed or removed.

## New patterns

Compared with `main` fd0c70cb. Unchanged on purpose: the `OverridePolicy` semantics, the REST endpoints (fields
added, none removed), the record format, the study condition ids.

| ID | New | PR | Defined in |
|---|---|---|---|
| PAT-1 | **Override-aware proposal agents:** `ProposalAgent.respects_overrides`; the kept overrides go into the rollout before ROAM, the selected train's own override is what the courses answer. | #208 | "Decision", "Design"; `base.py`, `uc2_rl.py:172-202` |
| PAT-2 | **Per-train accept:** only the selected train's override is cleared; the others stay. The plan covers the trains without a decision, after S-1 the full course. A later accept replaces the whole plan. | #208 | "Decision"; `overrides.py:478-490,563-567` |
| PAT-3 | **Preview tokens:** a course is bound to a digest of its source state (env, step, overrides, policy) and accepted exactly, or refused with 409. | #196 | [uc2-rl-adviser-lookahead.md](uc2-rl-adviser-lookahead.md); `proposal_preview.py:199-241` |
| PAT-4 | **Bounded N-step futures:** courses forecast on deep copies in a bounded pool, ranked completion-first. | #196 | [uc2-rl-adviser-lookahead.md](uc2-rl-adviser-lookahead.md); `overrides.py:448,599-631` |
| PAT-5 | **Accepted plan as driving state:** an accepted course drives whatever policy the requests name; `driving_policy_id` / `create_driving_policy` wrap the pinned policy as the plan's fallback (the fix in "Breaking changes"). | #196 | [uc2-rl-proposal-agent.md](uc2-rl-proposal-agent.md); `registry.py:381-415` |
| PAT-6 | **Proposal agent per session and study condition** (`proposal_agent`), falling back to PP where unavailable. | #196 | [uc2-rl-proposal-agent.md](uc2-rl-proposal-agent.md); `study-conditions.ts:54` |
| PAT-7 | **Inference transactions:** only the model's forward pass runs in a worker, under a per-session command lock; destructive requests stop play first (`PFChControlMiddleware`). | #196 | [pf-ch-rl-main-integration.md](pf-ch-rl-main-integration.md); `pf_ch_control.py` |
| PAT-8 | **Fixed-actor sessions:** protected tour playback, direct-driver controls, `play_status` messages. | #196 | [pf-ch-rl-main-integration.md](pf-ch-rl-main-integration.md); `session.store.ts`, `app.component.ts:264-267` |
| PAT-9 | **Frozen checkpoint bundles:** `.pt` plus a JSON sidecar with SHA-256 provenance, verified at load, fail closed; torch-free availability checks; optional registration. | #196 | [uc2-rl-per-infrastructure.md](uc2-rl-per-infrastructure.md); `uc2_bundle.py`, `uc2_roam_bundle.py`, `registry.py:106-184` |
| PAT-10 | **One specialist per infrastructure**, chosen by fixture identity, with a scenario-blind shared model. | #196 | [uc2-rl-per-infrastructure.md](uc2-rl-per-infrastructure.md) |
| PAT-11 | **ROAM guard before actions** (vendored, SHA-pinned), on the whole batch. | #196 | [uc2-roam-performance.md](uc2-roam-performance.md); `uc2_roam_policy.py:50-94` |
| PAT-12 | **Lab vs app:** training, evaluation and export in `backend/lab/marl/`, frozen splits and quality gates; the app only reads frozen bundles. | #196 | [uc2-rl-per-infrastructure.md](uc2-rl-per-infrastructure.md), [uc2-roam-evaluation.md](uc2-roam-evaluation.md) |
| PAT-13 | **Session-boundary cleanup:** Flatland's native caches cleared, deleted sessions' caches dropped. | #196 | [uc2-rl-performance.md](uc2-rl-performance.md); `native_env_cache.py` |
| PAT-14 | **Server lateness as the single source** for shift review, debrief, run KPIs and saved outcomes. | #196 | [uc2-rl-performance.md](uc2-rl-performance.md) "consistent persisted end-of-shift lateness"; `shift-review.ts:35-41` |
| PAT-15 | **Session-scoped replies** in the browser: late proposal and call-log replies of another session or generation are dropped. | #196 | `proposal-compare.component.ts:127`, `call-log.interceptor.ts` |

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

## Change inventory of #196 and #208, by feature

The whole diff to `main` fd0c70cb, grouped by the features of "Scope of the sections below"; "New files" and
"Modified files" above list this PR's part (E) alone. Paths under `backend/app/` and `frontend/src/app/` are
shortened to `app/…` and `fe/…`. 🟩 new, 🟨 modified.

| Feature | PR | Code | Tests | Docs and data |
|---|---|---|---|---|
| A. Learned policies and training | #196 | 🟩 `app/policies/learned/` (observations ECML, PF-CH, UC2; `learned_ppo_policy`; bundles `pf_ch_bundle`, `uc2_bundle`, `uc2_roam_bundle`; `uc2_roam_policy`; vendored `roam_check`, `roam_joint_check`; dormant `lab_checkpoints`; licences); 🟩 `checkpoints/` (11 files, 3.8 MB); 🟩 `backend/lab/marl/` (collect, train BC/PPO, per-infrastructure, recovery, evaluate, export, splits, monitor); 🟩 `backend/tools/profile_pf_ch_rollouts.py`; 🟨 `app/policies/registry.py` (`pf_ch_rl`, `uc2_rl`, optional registration) | 🟩 `test_ecml_service_observation`, `test_pf_ch_{bundle,context_observation,model_width,training_memory,training_snapshots}`, `test_training_preprocessing_memory`, `test_uc2_{bundle,candidate_monitor,export_evidence,infrastructure_model,lateness_reward,learning_contract,observation,offmap_recovery_contract,training_compat,user_commands,verified_teachers}`, `test_uc2_roam_{check,evaluation,export,joint,pp_parity,runtime,specialists}` | 🟩 plans `uc2-rl-performance`, `uc2-rl-per-infrastructure`, `uc2-rl-user-command-recovery`, `uc2-roam-evaluation`, `uc2-roam-performance`; 🟩 `docs/examples/uc2-rl/`, `uc2-roam/`, `uc2-roam-performance/` (evidence, about 20 MB of 187 files) |
| B. RL as the session's driver | #196 | 🟩 `app/core/pf_ch_control.py`; 🟨 `app/api/{sessions,websockets}.py`, `app/main.py` (middleware), `app/core/scenario_presets.py` + 🟩 `app/fixtures/pf_ch/disturbances_shift/corridor-shift-incidents.json`, `app/policies/override_policy.py` (`apply_overrides`); 🟨 `fe/core/demo/tours.ts`, `fe/core/layout/layout-presets.ts`, `fe/core/models.ts`, `fe/core/session.store.ts`, `fe/core/websocket.service.ts`, `fe/core/api.service.ts` (`deleteSession`), `fe/app.component.{ts,html}`, `fe/features/toolbar/*` | 🟩 `test_pf_ch_{playback_control,request_control}`, `test_session_delete_playback`, `fe/core/{pf-ch,uc2}-session.spec.ts`; 🟨 `app.component.spec`, `toolbar.component.spec`, `tours.spec` | 🟩 plan `pf-ch-rl-main-integration`; 🟨 i18n `tours.*`, `policies.*`, `layouts.uc2Rl.*` |
| C. `uc2_rl` as KI proposal agent in Plan B; accepted plans keep driving | #196 | 🟩 `app/core/proposal_agents/uc2_rl.py`; 🟨 `proposal_agents/{base,registry}.py`, `app/models/session.py`, `app/core/{session_manager,trajectory_recorder,contention_strategies}.py`, `app/policies/plan_policy.py` (`accept_trainrun_plan`), `app/policies/registry.py` (`driving_policy_id`); 🟨 `fe/core/demo/study-conditions.ts`, `fe/core/session.store.ts` | 🟩 `test_uc2_rl_proposal_agent` | 🟩 plan `uc2-rl-proposal-agent` |
| D. N-step adviser futures | #196 | 🟩 `app/core/proposal_preview.py`; 🟨 `app/api/overrides.py` (async `/proposals`, ranking, tokens), `uc2_rl.py` (courses, interventions); 🟨 `fe/features/proposal-compare/*`, `fe/core/events/event-types.ts`, `fe/core/api.service.ts`; 🟩 `backend/tools/evaluate_uc2_adviser.py` | 🟩 `test_proposal_preview_acceptance`, `test_uc2_rl_adviser_lookahead`, `test_proposal_horizon_scope`; 🟨 `proposal-compare.component.spec` | 🟩 plan `uc2-rl-adviser-lookahead`; 🟩 `docs/examples/uc2-rl-adviser/`; 🟨 `docs/experiment-logging.md` (`proposals.refreshCourses`, `inspectCourse`); 🟨 i18n `proposals.*` |
| E. Override-aware courses (this plan) | #208 | 🟨 `proposal_agents/{base,uc2_rl}.py`, `app/api/overrides.py`; 🟨 `fe/core/events/event-types.ts`, `proposal-compare.component.html` | 🟩 `test_uc2_rl_keep_human_decisions`; 🟨 `proposal-compare.component.spec` | 🟩 this plan; 🟨 i18n `proposals.aiTakenCaveatKept` |
| F. Stop-aware PP and plan admission | #196 | 🟩 `app/core/stops.py`, `app/planners/{plan_validation,director_pp}.py` (lab callers only); 🟨 `app/planners/replan.py` (`_StopAwarePP`, `strict_stops`) | covered by the A and C tests | - |
| G. Memory bounds | #196 | 🟩 `app/core/native_env_cache.py`; 🟨 `app/core/{session_manager,scenario_cache}.py`, `app/policies/goal_directed_policy.py` (`forget_env`); 🟨 `fe/core/interaction-log/call-log.interceptor.ts` | 🟩 `test_native_env_cache`, `test_session_memory_cleanup`; 🟨 `call-log.interceptor.spec` | plan `uc2-rl-performance` |
| G. Lateness from Flatland | #196 | 🟨 `app/core/serializer.py` (`arrival_time`, `accrued_lateness`); 🟨 `fe/core/shift-review.ts`, `fe/features/{shift-review,tour-debrief}/*`, `fe/core/demo/experiment-run.service.ts`, `fe/core/interaction-log/interaction-log.service.ts` | 🟩 `test_serializer_accrued_lateness`; 🟨 `shift-review.spec`, `shift-review.component.spec`, `experiment-run.service.spec`, `interaction-log.service.spec` | plan `uc2-rl-performance` |
| G. Bug fixes | #196, #208 | 🟨 `proposal-compare.component.ts` (replies scoped to their session, #196); 🟨 `app/core/scenario_runner.py` (forks rebuild `agent_positions`, #208) | 🟨 `proposal-compare.component.spec`; 🟩 `test_uc2_rl_keep_human_decisions` | - |
| G. Deployment | #196 | 🟨 `Dockerfile`, `backend/Dockerfile`, `deploy/hf/Dockerfile` (CPU torch, thread limits), `start-demo.sh`, `.gitignore` | - | - |

## Results (16 November 2026)

Same tutorial situation as above:

| | Before | After |
|---|---|---|
| KI best | Train 0 drives on; train 1 doesn't arrive | Train 0 stays at (2,13); train 1 departs at once, goes round the loop and arrives |
| Accept | Overrides `{}`; train 0 drives on | Overrides `{0: STOP}`; train 0 stays; train 1 arrives while the client keeps pinning DLA |

## Code Review Findings

*Findings from code reviews, PR comments and TODOs, with their status and the commits that fix them.*

PR [#208](https://github.com/flatland-association/flatland-ui-hub/pull/208), based on `codex/pf-ch-rl-main` 29b31139
(PR #196, itself based on `main` fd0c70cb). Code review findings (F-1–F-10) were added on 2026-11-18, at eecfda80;
their line numbers refer to it. They cover this PR's diff (`codex/pf-ch-rl-main..HEAD`); #196's code is not
reviewed here. No PR review comments, and no TODOs added. Fixed: ✅; open: empty.

| Fixed | ID | Source | Category | Severity | Finding | Commit message |
|---|---|---|---|---|---|---|
|  | F-1 | code review | design | medium | `backend/app/core/proposal_agents/uc2_rl.py:266`, `backend/app/api/overrides.py:563,672-674`, `backend/app/policies/registry.py:407-412`: a train that keeps its decision is driven differently in the adviser than once the course is taken. In the rollout the UC2 model drives it, and the kept override only applies at its switch. Live after the accept, and in the scoring, the train is outside the plan (`_plan_without`) and the plan's fallback (Deadlock Avoidance in Plan B) drives it. A stop or turn still ahead of its switch therefore runs differently from the course shown. Decided 2026-11-18 (revises "Decision"): accepting takes the AI's full course as the plan, kept trains included, with their overrides standing; a course that runs into a conflict is replaced by accepting another suggestion. Open: planned in S-1. | fix(proposals): take uc2_rl's full course as the plan, so a train with a kept decision runs as the course showed. |
|  | F-2 | code review | bug | medium | `backend/app/core/proposal_agents/uc2_rl.py:199-201,266-267`: a kept turn is taken out of `kept` when it is put into the proposals, before Joint ROAM (`finalize_actions`) checks the batch. If ROAM withdraws the turn (replaces it with STOP), the rollout has used up the turn although the train never turned, and on the next step the model picks the direction. Live, `OverridePolicy` sends the turn without ROAM. Fix: remove the turn only once the finalized action equals it. Open. | fix(proposals): use up a kept turn in uc2_rl's rollout only when ROAM lets it through. |
|  | F-3 | code review | design | medium | `backend/app/core/proposal_agents/uc2_rl.py:172-202` duplicates `backend/app/policies/override_policy.py:77-136` (reroute every step, sticky stop and one-shot turn at a switch or merge, skip DONE, keep while off the map) and already differs: a reroute without a move is not cleared (live: cleared and its route dropped), so `route_move` searches again on every step of every candidate rollout; a DONE train's decision is not cleared. A later change to `OverridePolicy` won't reach the adviser. Fix: one pure rule shared by both (e.g. `OverridePolicy.apply_overrides` over a given override store, as `TrajectoryBranchRunner._make_override_policy` does). Open. | refactor(proposals): share the override rules of the live policy with uc2_rl's rollout. |
|  | F-4 | code review | ux | medium | `frontend/src/app/features/proposal-compare/proposal-compare.component.html:198`, `backend/app/api/overrides.py:710`: the note after taking the AI course («…Züge, die du gestoppt oder umgeleitet hast, behalten deinen Entscheid», `proposals.aiTakenCaveatKept`) depends only on the agent. In Plan B it shows on every accept, also when no other train has a decision, and it doesn't name turns, which are kept too. Fix: set `ai_keeps_overrides` only when the kept overrides are not empty; word the note for all kept decisions. Open. | fix(proposals): say that other trains keep their decisions only when they have one. |
|  | F-5 | code review | robustness | low | `backend/tests/test_uc2_rl_keep_human_decisions.py:162`: `while agent_position(env.agents[0]) != (2, 11)` has no step limit; if a change to DLA, the tutorial or Flatland makes train 0 miss (2,11), the test posts `/step` until CI times out. Fix: bound it by the episode length and assert. Open. | test(proposals): bound the tutorial walk to the stopping cell. |
|  | F-6 | code review | test-coverage | low | `backend/app/core/proposal_agents/uc2_rl.py:190-201`, `backend/tests/test_uc2_rl_keep_human_decisions.py`: the tests keep only a stop. A kept reroute (every step) and a kept turn (used up at its switch) in the rollout, and their accept, are not tested. Open. | test(proposals): cover kept reroutes and turns in uc2_rl's courses. |
|  | F-7 | code review | bug | low | `backend/app/core/proposal_agents/uc2_rl.py:126-128`: an accept without `preview_token` and `candidate_id` while other trains keep decisions takes `proposals[0]`, the model's own first course, not the course `/proposals` ranked first and showed as «KI». Today's client always sends the candidate; an older client gets a different course. Fix: rank as `/proposals` does, or require `candidate_id` when overrides are kept. Open. | fix(proposals): take the best-ranked uc2_rl course when an accept names no candidate. |
|  | F-8 | code review | simplification | low | `backend/app/api/overrides.py:551,672`: `extra = {"overrides": kept} if kept else {}` and `*([kept] if kept else [])` are not needed: every agent now takes `overrides`, and `kept` is `{}` for agents that don't respect them. Fix: pass `kept` plainly. Open. | refactor(proposals): pass the kept overrides to every proposal agent plainly. |
|  | F-9 | code review | simplification | low | `backend/app/core/proposal_agents/uc2_rl.py:98`, `backend/app/api/overrides.py:478-484`: the selected train's own override is dropped in both places, so the per-train rule lives twice. Fix: keep it in `_kept_overrides` only and document that `overrides` excludes the selected train. Open. | refactor(proposals): drop the selected train's override in one place. |
|  | F-10 | code review | style | low | `backend/app/core/proposal_agents/uc2_rl.py:37,188`: `STOP = 4` repeats `RailEnvActions.STOP_MOVING` as a number (`_action_value(RailEnvActions.STOP_MOVING)` does it without the literal), and `agent.state == TrainState.DONE` at :188 differs from the file's `getattr(a.state, "name", "") == "DONE"` (:145, :234). Open. | style(proposals): name the stop action and the DONE check as the rest of uc2_rl does. |

Issue references: the PR body closes no issue; nothing to check.

## Steps (review findings)

*One commit per step; Commit(s) is filled once it is committed.*

| ID | Findings | Step | Category | Severity | Commit message | Commit(s) | Needs | Blocked by |
|---|---|---|---|---|---|---|---|---|
| 💡 S-1 | F-1 | Accept and scoring take the full course: drop `_plan_without` in `/proposals` scoring and in `/proposals/apply` (`overrides.py:563,673`), keep the other trains' overrides. Tests: after the accept a train with a kept stop or turn runs as the course showed (stop ahead of its switch, turn); a course that runs into a conflict is replaced by accepting another suggestion from the new state, and the second accept replaces the whole plan (the timetable stays the yardstick). | fix | medium | fix(proposals): take uc2_rl's full course as the plan, so a train with a kept decision runs as the course showed. | | - | - |
