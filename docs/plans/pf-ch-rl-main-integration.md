# PF-CH trained driver on main

## Scope and acceptance

The requested integration targets `main` (maintainer feedback, 2026-11-13),
superseding the `explore_db`-based PR #192. A direct retarget would include
159 unrelated commits and omit 114 newer main commits. Start at main fd0c70c
and port only the bundled specialist actor and its UI entry point.

Keep existing Plan B experiments, tours, stored IDs, defaults and human
control semantics. The new optional PF-CH tour selects `pf_ch_rl` before any
opening step, preserves it through Director/restart, runs for 320 steps and
uses the four scripted corridor incidents. Verify 16 arrivals and 48 serviced
intermediate calls; this is not a claim of generalisation or superiority.

## Design

### New files

| Files | Purpose |
|---|---|
| `backend/app/policies/learned/{ecml_observation,learned_ppo_policy,pf_ch_observation,pf_ch_bundle}.py`, package/license/checkpoint | Existing verified features, weights and CPU inference; no learner or lab dependency |
| `backend/app/core/stops.py` | Read native Flatland serviced-call truth |
| PF-CH-only control helper and backend regression files | Owned feature capture, drained worker inference, serial mutation and rejected incompatible selection |
| PF-CH corridor incident fixture | Same four incidents as the verified demo |
| Main-port validation artifacts | Fresh mission and resource evidence, with limits |

### Modified files

| Files | Change |
|---|---|
| Backend registry and session/play APIs | Lazy optional policy registration, compatibility preflight and truthful actor switching |
| Backend play/session control | Pure model forward in a worker; feature capture, overrides and physics remain synchronous; stop/drain before mutation |
| `Dockerfile` and documented setup | CPU Torch availability for the optional bundled actor |
| Frontend models/tours/layout/app/session store | Optional tour and lightweight layout, backend ACK before opening, explicit error on RL failure |
| EN/DE/FR translations and frontend tests | New labels and lifecycle regressions; French draft |

## OOM review and limits

The previous branch contains the separate online-learning stack and its
application lifespan autostart. Installing Torch can activate an additional
training process even during demos. Main has no such stack: do not import it
or its worker/buffers in this port. This is a concrete risk factor, not an
established diagnosis of the colleague's OOM without logs.

The inference asset is 288,717 bytes, ~70k parameters; this is not the runtime
RAM requirement. Torch/Flatland and environment forks dominate. Import Torch
only on explicit RL use, share frozen model weights and bound checkpoint-cache
retention across replacements. Use CPU tensors and inference without autograd.
Run heavy checks sequentially. Record fresh process memory for import, policy
load and repeated complete demo episodes; do not treat allocator high-water
marks or short-run measurements as proof of absence of all leaks.

No online training, training buffers, lab UI or unrelated dispatcher services
are included. Keep existing Plan B policy settings and infrastructure intact.

## Verification

Run backend suite serially under pinned Flatland 4.3.0; add focused controls,
compatibility, action-equivalence and repeated mission checks. Run frontend
style/i18n/production build and affected store/tour tests. Verify the served
production app and the complete API play mission with four disturbances.
Record exact commits/results/peak RSS and any remaining failures in this plan
and PR. Do not reuse previous explore_db test results as proof for this port.

## Reproduced rollout memory retention

A fresh actual API Play/Delete probe with ten 16-train, four-fault episodes
reached 16/16 arrivals and 48/48 native served calls at step197 every time,
but RSS after cleanup grew from342.5MB to523.0MB. Session weakrefs were free;
env and rail objects remained reachable through Flatland's native self-keyed
LRU caches (millions of possible transition entries, plus inherited
AbstractRailEnv helper caches). Clearing just the rail caches was insufficient.
Clearing rail and inherited env caches released earlier environments; the
latest native GlobalObs default retains one last env until another is built.

New lifecycle helper: explicitly clear the17 self-keyed native method caches
at disposal/reset boundaries using `functools.lru_cache.cache_clear`, without
patching Flatland or changing actions/physics. This drops other live sessions'
cache warmth; their values are recomputed. It is a lifecycle memory/performance
tradeoff, not a route/planning algorithm change. Regressions must verify a
second live environment still steps correctly.

Additional proven retention: the Director's weak-key cache held a
SchedulePlayer that strongly referenced its key env. `forget_env` now removes
that env's seven plan/player caches on deletion. The DELETE API stops/drains
its real actor first, including a PP comparison selected within an RL demo.
The scenario cache drops disposed sessions and rejects late forecast writes.

The repeated API probe excludes browser and HMI forecast load. Abandoned
non-demo study sessions, multiple concurrent users and a forecast already in
flight remain different workloads. No claim that every OOM is solved, and no
diagnosis of the colleague's exact crash without its trace/hardware.

The deployed action mask enforces rail/state action validity. This inference
path contains no formal ROAM checker or end-to-end deadlock/safety guarantee.

## Additional implementation files from OOM investigation

| New file | Purpose |
|---|---|
| `backend/app/core/native_env_cache.py` | Explicit17-method native cache disposal, no native monkeypatch |
| `backend/tests/test_native_env_cache.py` | Two live native environments and repeated regeneration/reset regression |
| `backend/tests/test_session_memory_cleanup.py` | Cache/session/player reachability and late forecast-write tests |
| `backend/tests/test_session_delete_playback.py` | Await actual actor drain before deletion; preserve another live run |
| `backend/tools/profile_pf_ch_rollouts.py` | Repeatable fresh-process API rollout/RSS probe, no training/browser |

Additional modifications: SessionManager.delete calls Director-cache and native
cache cleanup after closing its recorder. Reset clears retired native cache
keys. Toolbar keeps an unavailable RL selection visible and never substitutes
another actor for it; existing control selections are included alongside the
explicit tour policy before session creation.

The main-specific presentation fix adds `directDriverControls` in AppComponent:
PF-CH's layout and explicit learned-policy selection render the existing
playback/policy toolbar in place of the PP-objective Director chrome. This is
presentation only; InteractionMode still defines human authority. Choosing the
PP comparison keeps the toolbar available to switch back to RL.

## Final evidence (2026-11-13)

| Check | Result |
|---|---|
| Full initial local backend tier | 706 passed,22 skipped in152.44s; then final changed-code regressions covered95 cases plus54 native-cache/control/reset cases |
| Frontend | style/i18n1852keys, production build, TypeScript and49 focused Angular browser cases passed |
| Fresh ten actual API Play/Delete cycles | Every episode16/16 arrivals,48/48 native served calls, four faults, finish197; one cached model, no remaining sessions |
| Current backend RSS before native cleanup |342.5→523.0MB over ten completed/deleted episodes (~20MB/episode) |
| Current backend RSS after native cleanup |326.73→339.91MiB; cycles2–10 +3.84MiB, cycles6–10 +0.11MiB; peak339.91MiB |
| Native object reachability | Earlier nine episode envs collectible; only native shared default's last env remains |
| Production browser on runtime532179e8 | Actual RL Play/Pause, stable paused state, explicit policy picker roundtrip to Director Planner/back (no PP rollout), restart deletes old session; complete16/16 at197/320 and terminal stopped ACK; no console/WS errors |
| Browser completion |30.754s at maximum UI10steps/s, with normal UI/HMI workload; not a throughput benchmark |
| Linux CI including slow tier | [43417932211](https://github.com/flatland-association/flatland-ui-hub/actions/runs/43417932211): backend,backend-slow,frontend all passed on runtimebf4ecb5f; subsequent UI-only change has its own PR CI |

The initial local full tier emitted native Torch faults in existing parallel
PP child processes; their existing fallback let the parent tests pass. The
separate Linux CI passed its parallel/planning checks. No claim of a locally
clean native PP parallel runtime. Docker is unavailable, so no local image
build was performed.

Reproduce the memory probe from `backend/` with development dependencies:

```sh
PYTHONPATH=. OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 \
  python tools/profile_pf_ch_rollouts.py --episodes 10 --output /tmp/pf-ch-memory.json
```

The committed `docs/examples/pf-ch-rl-main/` JSON evidence separates the
pre-fix growth, native-cache diagnosis, post-fix API probe and actual browser
flow. Screenshot: `docs/plans/pf-ch-rl-main-integration/1-rl-complete.png`.
The public Space still requires maintainer merge/rebuild; this PR does not
change deployment targets or the Plan B experiment definitions.

## Code Review Findings

*Findings from code reviews, PR comments and TODOs, with their status and the commits that fix them.*

PR [#196](https://github.com/flatland-association/flatland-ui-hub/pull/196) (`codex/pf-ch-rl-main`), based on `main`
fd0c70cb. Code review findings (F-1–F-21) were added on 2026-11-18, at 29b31139; their line numbers refer to it.
Focus of the review: modularization (are existing concepts and flows respected, which renames, moves or splits
would shrink the diff), plus bugs. Not reviewed in detail: the `backend/lab/` training scripts, the checkpoints, the
evidence under `docs/examples/`. No PR review comments; the PR body closes no issue. Fixed: ✅; open: empty. F-2, F-3, F-4 and F-9 are fixed in the
stacked PR on `refactor/196-modularization` ([rl-modularization.md](rl-modularization.md)).

| Fixed | ID | Source | Category | Severity | Finding | Commit message |
|---|---|---|---|---|---|---|
| ✅ | F-2 | code review | design | high | `backend/app/core/pf_ch_control.py:20-31` (`_SPECIALIST_BUNDLES`, `is_specialist_policy`, `requires_command_lock`) is a second policy registry beside `PolicySpec` in `backend/app/policies/registry.py:32` (which already has `family`, `runtime_factory`, `branch_factory`); `registry.py:390` imports it back lazily (policies → core). Callers branch on it: `backend/app/api/websockets.py:102,134,146,260-268,282,304`, `backend/app/api/sessions.py:18,513`, and by id strings at `backend/app/api/overrides.py:37` (`{"uc2_rl", "pf_ch_rl"}`). A third learned policy needs edits in all of them. Fix: capability fields on `PolicySpec` (e.g. `preflight`, `async_inference`, `forecasts`), looked up by id; the play loop dispatches on the capability. Fixed in 46a54389 (S-1 of the stacked PR on `refactor/196-modularization`, plan [rl-modularization.md](rl-modularization.md)): `PolicySpec.bundle` names the specialist's bundle; the inference control, the forecasts and `driving_policy_id` ask the registry, and the catalog serves `specialist`. | refactor(policies): describe learned policies' needs on their PolicySpec instead of a second registry. |
| ✅ | F-3 | code review | design | high | `backend/app/api/overrides.py:406` (`(env.height, env.width) in {(6, 25), (8, 78)}`), `:627` (`if agent.id == "uc2_rl": horizon = …`): UC2 knowledge in the API module, detected by grid size; a resized fixture silently switches the scoring yardstick. The `ProposalAgent` seam this PR already extends (`backend/app/core/proposal_agents/base.py`) is the place. Fix: `ProposalAgent.horizon(env, …)` and `ProposalAgent.arrival_reference(env)` with PP's behaviour as default, overridden by `UC2RLProposalAgent` (which can ask `uc2_roam_bundle.compatibility_error`). Fixed in f3ecafd7 (S-2 of the stacked PR): `ProposalAgent.forecast_horizon` (UC2 overrides it); the arrival reference has no grid sizes and stays the same for every agent (an accepted course is never the yardstick where the scenario shipped no plan), so no agent grades its own work. | refactor(proposals): let the proposal agent decide its horizon and arrival reference. |
| ✅ | F-4 | code review | design | high | `frontend/src/app/app.component.ts:264-267` (`directDriverControls`: `isFixedActorPolicy(…) \|\| ['preset-pf-ch-rl','preset-uc2-rl'].includes(…)`), `app.component.html:170,243`, `isFixedActorPolicy` in `toolbar.component.ts:66,87,97,115`, `shift-review.component.ts:98,259` and 9 places in `session.store.ts`: hardcoded preset ids and a policy predicate instead of the existing concepts. Hiding the directive bar is what a preset's `ui.hidden` (`widget.director-directive`, checked by `panel-mode-availability.ts`) does; a policy that holds for the session is `pinnedPolicy`. The tours also reuse Director mode with a changed meaning (no goal_directed switch, no directive bar, no plan check), a parallel flag next to `InteractionMode` (AGENTS.md guardrail). Fix: `ui.hidden` in the two presets; a store-level "pinned" state that study conditions and tours share; the mode question decided by the maintainer. Fixed in 1c2ff0c7 (S-4 of the stacked PR): the store reads the catalog's `specialist`; a pinned policy wins over Director's switch to `goal_directed`; the RL presets hide the directive bar and keep the header toolbar by their own data; plan check and footer survey as on `main` (Q-1 a‴ of that plan). | refactor(rl-tours): hide the directive bar by the presets' UI restrictions and treat RL tours as pinned sessions. |
| ✅ | F-9 | code review | design | medium | `backend/app/core/pf_ch_control.py:103-110,120-156`: `PFChControlMiddleware` parses the bodies of `/policy`, `/play` and `/step` by importing API models into core (core → api), and re-decides an "actor change" that `websockets.play` (`:258-268`) decides again; its `command_lock` is a second session lock beside `play_manager` (`backend/app/core/play_manager.py`). Fix: no body-parsing middleware; take the lock in the mutating endpoints, which already have the validated request, and keep it with the play state in `play_manager`. About -80 lines. Fixed in 862bad6b (S-3 of the stacked PR): the middleware reads no bodies; `/play`, `/step`, `/policy` enter `actor_transaction`, which stops a changing actor before the lock wait. | refactor(sessions): take the session's command lock in the endpoints instead of a body-parsing middleware. |
|  | F-1 | code review | design | high | `docs/examples/**` (187 files, +687,920 of the PR's +706k lines; `uc2-roam-performance/` alone 508k lines in 101 files, e.g. `systematic1472-candidate4-vs-pp.json` 85k), plus 24 Python audit and training scripts under `docs/examples/uc2-roam-performance/` (3.1k lines, including superseded `candidate1–3` and `_v1`/`_v2` versions, outside lint and tests): evidence, not code, makes the PR unreviewable and grows every clone. Fix: move it to a release asset, a separate repo or LFS; keep the summary tables in the plans and only the final candidate's audit, in `lab/`. Open. | chore(rl): move the UC2 evaluation evidence out of the repository and keep its summaries in the plans. |
|  | F-5 | code review | design | high | Code in `backend/app/` that the app never runs: `backend/app/planners/director_pp.py` (144 lines) and `plan_validation.py` (276) are imported only by `backend/lab/marl/`; `replan.plan_train_against` has no caller; `stops.carry_served_to_fork` none; `replan.py`'s `strict_stops`/`wait_cells`/`wait_states` serve only `director_pp`; `backend/app/policies/learned/lab_checkpoints.py` (94, its docstring's `lab:` registry entry does not exist) and `pf_ch_relative_observation.py` (183, no shipped checkpoint uses its schema) are lab-only; the four `uc2_roam_teacher_uc2_*.pt` checkpoints are "never loaded at runtime" (`uc2_roam_bundle.py:77-86`); `learned_ppo_policy.py:34` defaults to `ecml2026_ppo.pt`, which is not shipped; `ecml_observation.py:6` and `lab_checkpoints.py:3` cite `docs/plans/marl-lab-plan.md`, which does not exist. About 1k lines and 1.2 MB shipped in the image for nothing. Fix: move them to `backend/lab/` (or a follow-up PR), make the checkpoint a required argument, fix the references. Open. | refactor(rl): keep lab-only planners, observations and checkpoints out of the app. |
|  | F-6 | code review | bug | medium | `backend/app/api/overrides.py:719-728`, `backend/app/core/proposal_agents/uc2_rl.py:114`: `apply_proposal_endpoint` is `async` and calls the synchronous `apply_proposal` directly, under the command lock. An accept without a preview token (token evicted from the 16-entry cache, or an older client) makes `UC2RLProposalAgent.resolve_for` rerun the adviser (up to 8 rollouts to the end of the episode) on the event loop: every session's play loop, websocket and HTTP request stalls for seconds. The GET path moved this work to `run_preview_work`; apply did not. Also, a `candidate_id` from an earlier step never matches after the state moved on, so the work ends in a misleading 409. Fix: run the resolve in the preview pool, or refuse an accept without a valid token for agents with previews. Open. | fix(proposals): accept a UC2 course without blocking the server, or ask for a fresh preview. |
|  | F-7 | code review | bug | medium | `backend/app/api/sessions.py:490`: Reset calls `revert_accepted_plan` but leaves `session.policy == "plan"` and `session.trainrun_plan` at the accepted AI course. A session started on DLA without a plan then reports a plan that no longer exists (`/session` info, trajectory metadata, the proposals' baseline), and `_policy_factory_for_session` silently falls back. Fix: reset `session.policy` and `session.trainrun_plan` with the plan (e.g. inside `revert_accepted_plan`'s caller). Open. | fix(sessions): reset the session's policy and plan with an accepted AI plan. |
|  | F-8 | code review | bug | medium | `backend/app/api/sessions.py:513`: Reset rebuilds the `DisturbanceScheduler` only for specialist policies; every other session keeps a scheduler whose scripted disturbances already fired, so the "IDENTICAL scenario" replay of the comment runs without them (e.g. PF-CH `tour_disturbances` under DLA). Fix: rebuild it on every Reset. Open. | fix(sessions): replay scripted disturbances after a Reset for every policy. |
|  | F-10 | code review | design | medium | `backend/app/api/overrides.py:573-726`: capture, evaluate and publish of proposals (about 150 lines of service logic) in the API module; the preview store (`backend/app/core/proposal_preview.py`) is cleared at ad-hoc sites (`overrides.py:561`, `pf_ch_control.py:154`) instead of in `_invalidate_scenario_forecasts` (`sessions.py:605`), which new callers import lazily from the API (`overrides.py:562`, `websockets.py:266`). Fix: move the service logic to `backend/app/core/proposals.py`, move `_invalidate_scenario_forecasts` to core and clear the previews there. Open. | refactor(proposals): move proposal evaluation and forecast invalidation into core. |
|  | F-11 | code review | design | medium | Changes unrelated to the RL driver, interleaved: the UC2 proposal agent and adviser futures (`proposal-compare.component.*`, `api.service.ts`, `event-types.ts`, `study-conditions.ts`, about 350 lines with specs; it also changes Plan B's KI column), the call-log interceptor's scope and LRU (`call-log.interceptor.ts` +44, spec +114), the lateness KPIs (`shift-review.ts`, `serializer.py:120-201`, changes logged outcomes for all studies), the memory fixes (`native_env_cache.py`, `goal_directed_policy.forget_env`), the PP ranking change (`overrides.py:389,448`), the session-id stale guards in `session.store.ts`. 12 tests test lab-only code (`test_pf_ch_model_width`, `test_pf_ch_training_memory`, `test_pf_ch_training_snapshots`, `test_training_preprocessing_memory`, `test_uc2_candidate_monitor`, `test_uc2_export_evidence`, `test_uc2_lateness_reward`, `test_uc2_roam_evaluation`, `test_uc2_roam_export`, `test_uc2_training_compat`, `test_uc2_verified_teachers`, `test_uc2_user_commands`), and 6 runtime tests use `lab.marl.pf_ch_episode` as their harness. Fix: split into PRs (or at least commits) by concern; move lab tests with the lab, the episode harness to `tests/conftest.py`. Open. | chore(rl): split the proposal agent, logging, KPI and memory changes from the RL driver. |
|  | F-12 | code review | performance | medium | `frontend/src/app/core/api.service.ts:554` asks every agent, PP included, for `alternatives=8` (was 3): about 2.5× the branch replays per train selection, so the 2-worker, 4-slot preview pool returns 503 sooner. `backend/app/api/overrides.py:641`: UC2 courses are simulated twice (rollout, then `PlanPolicy` replay over the uncapped horizon). `backend/app/core/proposal_agents/uc2_rl.py:243`: every candidate rollout clears all process-wide Flatland caches (about 9 times per request, for every live session); `policy = fork = None` there does nothing. Fix: 8 only for agents with interventions; reuse or cap the replay; clear the caches once per request. Open. | perf(proposals): ask for eight courses only from the UC2 adviser and clear Flatland's caches once per request. |
|  | F-13 | code review | design | medium | `backend/app/core/proposal_agents/uc2_rl.py:60,165-243`: its own fork (`copy.deepcopy`), live-fault quieting and step loop beside `TrajectoryBranchRunner` (`backend/app/core/scenario_runner.py:192`, `_fork_env` with the same quieting), which `_branch_run` wraps. Two fork-and-step mechanisms that can drift. Fix: a public `fork_env` and a per-step hook on `run_branch`. Open. | refactor(proposals): run uc2_rl's rollouts on the shared branch runner. |
|  | F-14 | code review | design | medium | `backend/app/policies/learned/{pf_ch_bundle,uc2_bundle,uc2_roam_bundle}.py` repeat `available`/`verify_bundle`/`compatibility_error`/`require_compatible` with the same SHA and schema checks; `uc2_demo_ppo.pt` only serves as identity at runtime (the registry always loads the specialists). The checkpoints live in `app/policies/learned/checkpoints/` with SHAs as Python constants, while the existing convention is `backend/models/<name>/` with a `SOURCE.md` (`goal_directed_policy.py:47`, `_MODELS_DIR`). Fix: one parametrised bundle module; models under `backend/models/`. About -80 lines. Open. | refactor(rl): one bundle module for the learned policies, models under backend/models. |
|  | F-15 | code review | bug | low | `frontend/src/app/features/proposal-compare/proposal-compare.component.ts:309`: every 409 of an AI accept is shown as "preview expired" and clears the result, also the backend's 409 "no collision-free plan"; refreshing gives the same course and the same failure. Fix: show the server's detail for other 409s. Open. | fix(proposals): show why an AI course can't be taken instead of always "preview expired". |
|  | F-16 | code review | bug | low | `backend/app/api/sessions.py:417-430`: `/step` no longer goes through `_build_policy` (base `:148`, still used by `sandbox.py:316`), so an enabled but unbuildable policy id gives 500 instead of 400 "Unknown policy". Fix: let `_build_policy` call `create_driving_policy`, used by step and sandbox. Open. | fix(sessions): keep the 400 for an unknown policy on step. |
|  | F-17 | code review | style | low | `backend/app/api/websockets.py:125-185`: wrapping the step body in `async with (… else nullcontext())` re-indents about 60 unchanged lines. Fix: extract `_play_one_step(...)` and wrap only the call. Open. | refactor(play): extract one play step so the lock wraps a call, not a re-indented block. |
|  | F-18 | code review | naming | low | `pf_ch_control.py`, `PFChControlMiddleware`, `_pf_ch_command_lock`, the `pf-ch-inference` pool and `lab/marl/pf_ch_episode.py` serve UC2 too; `backend/tools/` is new beside the existing `backend/scripts/`; four observation builders in `app/policies/learned/` beside the existing `backend/app/observations/`; `lab/marl/roam_check.py`/`roam_joint_check.py` re-export shims and a second licence copy. Fix: generic names (`inference_control`, `episode`), scripts in `scripts/` or `lab/`, builders in `observations/`, drop the shims. Open. | refactor(rl): name the shared learned-policy pieces generically and follow the existing folders. |
|  | F-19 | code review | test-coverage | low | `frontend/src/app/core/pf-ch-session.spec.ts` (209 lines) and `uc2-session.spec.ts` (165) repeat the same `beforeEach` and cases (wait for accept, rejected step/play, unavailable policy) beside the existing `core/pinned-policy.spec.ts`; `layout-presets.ts:1092-1129` builds `UC2_RL` by cloning `PF_CH_RL` with string `replace` on ids, and only it has `nameKey`/`purposeKey`. Fix: one parametrised spec in `pinned-policy.spec.ts`; one shared RL preset or plain fields. About -150 lines. Open. | test(rl-tours): run the pinned RL session cases once for both policies. |
|  | F-20 | code review | i18n | low | `frontend/public/i18n/fr.json:587`: `policies.uc2_rl.unavailable` is English ("The UC2 RL policy is unavailable…"). Open. | fix(i18n): translate the unavailable UC2 RL policy message into French. |
|  | F-21 | code review | design | low | `backend/app/api/overrides.py:537` resets `env._plan_off_plan` after `accept_trainrun_plan`, `backend/app/core/contention_strategies.py:258,273` does not; the rename `install_trainrun_plan → accept_trainrun_plan` there also opts strategy plans into "kept when pinned" without saying so. Fix: reset `_plan_off_plan` inside `accept_trainrun_plan` (`plan_policy.py:307`, which owns it) and say in the PR that strategy plans are kept too. Open. | fix(plans): reset the off-plan trains when any accepted plan is installed. |

Issue references: the PR body closes no issue; nothing to check.
