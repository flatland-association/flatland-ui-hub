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
