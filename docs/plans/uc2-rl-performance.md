# UC2 and tutorial: map-specialist RL performance

User clarified the actual targets on2026-11-13 during the authorised local
three-hour improvement window: `uc2-1`, `uc2-2`, `uc2-3`, `uc2-4`, `tutorial`.
Continue within the original14:46:17UTC deadline. These are the locked native
PlanB scenario folders shipped on main, not the older191x9PF-CH builder scenes.
Work branch `codex/uc2-rl-20261113` starts from public integration PR196 head
5ffd7d16. Public PR196 and its existing model remain unchanged during training.

## Acceptance and measurement

- Evaluate the actual shipped `scenario.pkl` via production `create_env` and
  `step_env`. Preserve all native scheduled malfunctions, speeds, missions,
  departure/arrival windows and scenario episode limits. Hash input fixtures.
- Target all5 exact demo missions completed autonomously, with every train at
  its valid target and every mandatory service stop/order/departure respected.
- Then reduce total lateness and finish steps; report reference PP separately.
  PP may generate training labels but must not intervene at learned inference.
- Train on these fixed maps explicitly, as the user authorised. Distinguish
  exact trained-demo reliability from separate timetable/fault variations.
  Repeat resets/restarts to check consistency and keep all failed tests.
- Preserve all15 previous PF-CH demos with their existing separate checkpoint;
  do not weaken observation checks to apply that specialist blindly toUC2.
- Existing heldout140 remains unopened. It is a PF-CH generalisation set and
  is no longer the primary acceptance criterion for this task.

## Implementation approach

Reuse the existing native PP teacher, full-trajectory proof, BC and conservative
PPO tools from the isolated PF-CH training branch. This ports existing solver
integration; it does not introduce a solver. First test the existing36-feature
service-aware actor path on the5 fixtures. If it aliases coordination states,
add a versioned UC2 context builder exposing current train positions, identity,
mission state and explicit scenario identity (up to16trains). No future fault
schedule, teacher plan or oracle action may enter observations or masks.

The conditional context schema is `uc2-context-v1`,313 inputs: preserve the
existing272 current-state features, append5 scenario-identity flags,2 geometry
scales, own speed/fraction, and speed/fraction for16 peer slots. Infer supported
fixture identity from native geometry/horizon plus a checked rail fingerprint;
the5 shipped horizons differ. Keep the old PF-CH geometry contract unchanged.
Zero-column272→313 warmstart is permitted because the original prefix remains
identical. Runtime loads supported128/256/384 widths while retaining main's
shared frozen model cache and tensor-only inference exports.

The three-train scenarios use78x8 geometry, tutorial25x6; UC2-3 has a0.6-speed
train. Their native horizons are168/102/240/180/40. Test fractional motion and
the native scheduled-fault boundary explicitly. Never replace those faults
with the old session-only disturbance mechanism.

## New files

| File | Purpose |
|---|---|
| backend/lab/marl/* | Port existing isolated learning, teacher and evaluation tools; adapt the episode/case adapter to named UC2 fixtures |
| backend/app/planners/director_pp.py | Existing native PP candidate-order bridge from training branch |
| backend/app/planners/plan_validation.py | Existing native full-mission proof from training branch |
| backend/app/policies/learned/lab_checkpoints.py | Existing offline checkpoint path/metadata helper |
| backend/app/policies/learned/uc2_observation.py (conditional) | Versioned UC2 current-state context, separate from fixed PF-CH schema |
| backend/tests/test_uc2_learning_contract.py | Exact fixture, fault, fractional-speed and native-runtime parity checks |
| docs/examples/uc2-rl/* | Compact reproducible commands, fixture/model hashes and measured results |

## Modified files

| File | Change |
|---|---|
| backend/lab/marl/pf_ch_episode.py (ported file) | Admit the5 named fixtures explicitly; preserve native faults and horizons; retain old PF-CH behaviour |
| backend/lab/marl/common.py (ported file) | Support the optional versioned UC2 schema alongside existing schemas |
| backend/app/policies/learned/learned_ppo_policy.py (conditional) | Load new UC2 schema/validated width with shared frozen model cache preserved |
| backend/app/policies/registry.py (conditional) | Expose a separately identified validated UC2 model after gates pass |
| backend/app/planners/replan.py | Port the existing strict-stop/wait-state-compatible native bridge required by the reused teacher; preserve legacy defaults |
| backend/lab/marl/train_ppo.py (ported file) | Periodic inference snapshots contain CPU tensors and JSON-primitive metadata; resumable final checkpoints retain their training state |
| .gitignore | Exclude local large training runs/checkpoints from review commits |

Record native malfunction-counter changes/exposure in the episode's metrics
without querying the future fault list for observations. This is separate from
session-injected fault accounting; the native file remains the source of truth.

Large corpora/checkpoints remain gitignored. Freeze source and candidate hashes
before final fixture/runtime verification; preserve old assets. Any user-visible
selection change needs production-app verification and relevant existing gates.

## Frozen robustness inputs

The5 originals are explicit training/demo targets. Also freeze100 TRAIN cases
(20 per fixture),20 development cases (4 per fixture) and50 final cases
(10 per fixture, outcomes unopened during selection). Vary only independent
per-train timetable offsets0..6; preserve native horizons, speeds and faults.
Canonicalise empty offsets to all-zero and deduplicate all sets physically.
Mix exact-demo replay with TRAIN labels; neither development nor final labels
enter training. Monitor exact5 plus development20; select before final50.

## Reviewable application integration

New `app/policies/learned/uc2_bundle.py` and fixed inference asset/manifest expose
the separately identified `uc2_rl` policy after exact-demo gates pass. Extend
the existing registry, asynchronous fixed-actor control, preflight and atomic
create/switch/reset gates to both existing PFCH and UC2 specialists. Keep main's
shared frozen model cache and compact environment observations to avoid rollout
memory growth. Test wrong-map rejection before mutation, native forks and resets.

Frontend additions:5 explicit tours (`uc2-rl-tutorial`, `uc2-rl-1` through`-4`),
`preset-uc2-rl` supervision layout, translations and focused session/tour tests.
Modify the existing fixed-actor predicate/lifecycle where needed, preserving
manual overrides and stop/pause/restart behaviour. Native locked horizons and
faults have no tour overrides. Existing PlanB participant conditions and their
DLA defaults remain unchanged; these are separately labelled RL demos.

## Optional punctuality PPO ablation

Add `PFChEpisode(..., lateness_cost=0)` and trainer `--lateness-cost` (default0)
to charge the measured per-train increase in lateness during each physical
step. The sum must equal cost×final total lateness, including unfinished trains,
without changing native physics, horizons or completion rewards. Nonzero cost
and reward schema are explicit in checkpoint provenance/resume recipe. Old
default behaviour and seven-field rollout tasks remain compatible. Test native
late arrivals, non-arrivals, default-zero equivalence and worker forwarding.
Start conservatively from a passing BC candidate; promote PPO only if exact5
completion is preserved and punctuality/development evidence improves.

## Verified teacher-quality ablation

The existing causal DLA completes UC2-3 with39 lateness versus the PP teacher's
50, at a longer makespan128 versus122. For exact/variant UC2-3 TRAIN cases only,
compare fully verified PP and DLA trajectories and distil the lower-lateness
teacher while preserving all other PP labels. New
`lab/marl/collect_uc2_verified_teachers.py` and focused tests reuse existing
native validation. DLA rows have a separate `uc2-verified-teacher-v1` schema,
owner`verified_teacher`, source`native_verified_dla`, proof digest, explicit
UC2-3 preset and313-feature schema. Extend the demonstration loader narrowly
for this honest provenance; old PP checks remain unchanged. BC metadata lists
the actual teacher sources. Preserve raw files and casewise selection evidence.
No development/final labels or runtime teacher fallback enter this experiment.

## Truthful completed-train KPI display

Live browser review found the existing serializer intentionally clears `delay`
for DONE trains; ShiftReview summing that field therefore displayed0 despite
the selected UC2-3 native lateness39. Add native `arrival_time` and
`accrued_lateness` fields in `app/core/serializer.py`: freeze actual arrival
lateness after DONE, use current elapsed lateness while active,0 without a
deadline and null when a DONE arrival record is unavailable. Preserve the old
live-delay/sidebar fields. Add optional frontend DTO fields and use
`accrued_lateness ?? delay` in ShiftReview KPIs with legacy compatibility.
Focused serializer/native tests and frontend regressions check the distinction;
the final browser screenshots must show9/19/24/39/30 for the five original
scenarios. This changes displayed accounting, not policy, physics or rewards.

## Final selected result and review evidence

The selected network is verified PP/DLA teacher distillation in the PPO actor
architecture; the punctuality PPO experiment was not promoted. With the original
native horizons, faults and fractional speed, it completes tutorial and UC2-1
through UC2-4 (14/14 trains), with total lateness 121 versus PP 132.
Development completion is 20/20. The checkpoint was frozen before the final
50 timetable variants: 48/50 complete and 135/140 arrivals, versus PP 50/50
and 140/140. Both UC2-1 failures remain published.

The portable [results and reproduction guide](../examples/uc2-rl/README.md)
contains casewise outcomes, the frozen selection lock, runtime hashes, browser
proof, source/asset verification and selected-model memory measurements. The
five labelled RL tours are separate from the unchanged PlanB study conditions.
