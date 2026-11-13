# UC2 ROAM performance: casewise comparison with PP

Status: experiments in progress, 13 November 2026. Parent: `4a9da4a0`.

## Objective and boundaries

Improve the frozen UC2 actor plus ROAM on tutorial and UC2-1 through UC2-4.
Compare complete missions first, then total accrued lateness, against the
unchanged native `pp-trainruns-replan` reference in **each** case. Report
makespan and decision cost separately. An aggregate win is not casewise
dominance; neither finite tests nor the sufficient ROAM certificate prove
dominance on arbitrary maps or unseen future disruptions.

Keep native infrastructure, mission, speeds, horizon, fault timing and frozen
model unchanged during guard ablations. Do not expose future disturbances to
decisions. Do not change the published UI policy until the candidate has
passed independent validation. Any later PP-assisted portfolio is explicitly
a hybrid and reports its planner use and cost.

## Experiments

1. Join existing exact5, dev20, historical50 and confirmation50 results to PP;
   inspect the individual regressions rather than just their sums. All these
   sets are now known regression/development data.
2. Reuse the existing ECML `JointRoamCheck` to allow conditional following
   proposals, accepted only after native whole-batch motion resolution and
   the existing certificate. Keep the previous serial/partial guard as V2.
3. Investigate residual strategic waiting/route-choice errors. Select further
   bounded improvements from measured traces; record mechanisms and rejected
   variants. Prefer existing upstream algorithms over an invented solver.
   The nine remaining V3 counterexamples include seven one-step actor waits
   and two larger strategy errors. Test an explicit action-score bias toward
   physically advancing, permitted proposals, followed by unchanged joint
   ROAM withdrawal. This is a controller heuristic, not additional RL
   learning, and is retained only if casewise comparisons support it.
4. Freeze candidate code before testing additional timetable cases. Record
   the manifest and exclusion of all previously used cases before outcomes.
   Any tuning after confirmation converts that block to development data.

## New files

| File | Purpose |
|---|---|
| `backend/lab/marl/roam_joint_check.py` | Licensed adapter of upstream conditional proposals and joint withdrawal; no upstream observation wrapper |
| `backend/tests/test_uc2_roam_joint.py` | Native motion/certificate regression tests and comparison invariants |
| `backend/app/policies/learned/roam_check.py` | Runtime home of the unchanged serial/partial core, moved from lab |
| `backend/app/policies/learned/roam_joint_check.py` | Runtime home of the unchanged joint core |
| `backend/app/policies/learned/uc2_roam_policy.py` | Frozen UC2 actor with joint proposal masks and final whole-batch withdrawal |
| `backend/app/policies/learned/uc2_roam_bundle.py` | Verify a portable set of neural infrastructure specialists; original actor retained as baseline |
| `backend/app/policies/learned/checkpoints/uc2_roam_*.pt` and manifest | Three optimizer-free BC specialist exports for UC2-1, UC2-2 and UC2-4 |
| `backend/lab/marl/export_uc2_roam_specialists.py` | Reproducible specialist export with source/dataset/model hashes and no private paths |
| `backend/lab/marl/evaluate_uc2_roam_runtime.py` | Execute the actual registry policy and audit native outcomes with the selected model identity per case |
| `backend/tests/test_uc2_roam_specialists.py` | Specialist integrity, immutable selection, preflight and lifecycle tests |
| `backend/tests/test_uc2_roam_export.py` | Export tensor identity and exclusion of optimizer, RNG and private training paths |
| `docs/examples/uc2-roam-performance/` | Casewise results, source/input hashes, selected and rejected variants |
| This plan | Scope, acceptance criteria, implementation decisions and outcomes |

## Modified files

| File | Change |
|---|---|
| `backend/lab/marl/evaluate_uc2_roam.py` | Add opt-in joint-guard variants, explicit optional physical-progress score bias and metadata; preserve V0/V1/V2 |
| `backend/lab/marl/roam_check.py`, `roam_joint_check.py` | Compatibility imports after moving shared cores to runtime, preserving old evaluator/test imports |
| `backend/app/policies/registry.py` | Use the guarded UC2 runtime and branch factory; retain policy IDs, other policies and Plan B defaults |
| `backend/app/api/websockets.py` | Finalize optional guarded proposals on the event-loop thread after pure inference, before existing human overrides |
| `backend/app/core/pf_ch_control.py` | Preflight the additional specialist assets before beginning a UC2 inference transaction |
| `backend/tests/test_serializer_accrued_lateness.py` | Compare serialized totals against actual native arrival/deadline values instead of the old driver's hardcoded 39 |
| `backend/tests/test_uc2_roam_runtime.py` | Runtime/branch parity, reset/cleanup, pure worker inference and exact native demo tests |

Runtime integration keeps feature capture and guard masks on the stable live
environment thread. Inference remains environment-free in the existing
bounded worker. A finalization hook performs whole-batch withdrawal on the
event-loop thread before the existing manual override layer. Synchronous
REST/branch actions use the same prepare/infer/finalize sequence. Human
override semantics and participant defaults remain as currently implemented;
the guard certifies autonomous proposals, not arbitrary later human actions.
The model stays frozen until a separately validated training candidate is
selected; no rejected motion bias is enabled in runtime. Runtime promotion
requires parity with the evaluated V3 controller.

## Training and infrastructure specialists

All 125 previously evaluated cases are explicitly known development data,
not holdout data. Collect 100 native PP teacher episodes outside UC2-3 and
mix their 14,921 rows with the original 18,700 PP/DLA rows. The additional
supervised fit uses the existing `train_bc` implementation, CPU hardware and
unchanged observation/schema/model architecture. This is behavior cloning
in a PPO actor architecture, not a newly demonstrated PPO gradient gain.

Shared fine-tuning corrects old waits but introduces some errors on other
infrastructures. An explicitly permitted map-specialist design therefore
selects one frozen checkpoint by the existing immutable fixture identity:
original actor for tutorial and UC2-3; lr3e-5/epoch100 for UC2-1;
lr1e-4/epoch1000 for UC2-2; lr1e-4/epoch200 for UC2-4. These choices are made
only from known-case results. No selection by departure offset, case ID,
future fault or realized outcome is permitted. There is no PP/DLA runtime
fallback. Four small models fit the existing four-entry shared model cache.

The recombined known-case results reach 125/125 missions, 350/350 trains,
zero PP lateness regressions and total lateness 2592 versus 3272. This is
selection evidence only until the same selector is executed in runtime and
the candidate is frozen before the new 84-case confirmation block.

Further files will be listed here before changes are made. No checkpoint,
runtime policy, frontend, native fixture or published baseline is modified
by the initial experiment.

## Second candidate: denser supervision

The first actual runtime candidate passes all known125 comparisons, but its
pre-registered fresh84 block exposes four lateness regressions. Preserve that
failed casewise acceptance result. These 209 cases become development data
for the next candidate, while a new100 input block is reserved before fitting.
UC2-1/2 collect all 323 timetable vectors in 0..6 outside their respective
20 reserved next cases. The other infrastructure specialists stay fixed.

For a remaining UC2-1 boundary error, examine mislabeled predictions in the
training corpus before increasing effort: the seven errors share the same
following/restart phase. Test explicit hard-example weights and a smaller
learning rate using the existing BC trainer. As a low-cost alternative,
test three convex parameter averages of the retained and dense neural
checkpoint (dense fractions 0.25, 0.5 and 0.75), using standard Torch tensor
operations. This is offline model averaging, not an added runtime rule or
planner. Both ingredients, fractions, tensor hashes and selection metrics
must be recorded. Promote only after native known209 and dense323 rollouts;
freeze the chosen weights before any new100 outcome is opened.

## Third candidate and a finite systematic comparison

Candidate two passes the new UC2-1/2 blocks but leaves five UC2-4 and eleven
expanded-range tutorial lateness regressions in fresh100. Preserve that
failed acceptance result. Freeze a further 40 unused inputs before fitting:
20 UC2-4 vectors in 0..6 and 20 tutorial pairs in 0..9. There are no untouched
UC2-1/2 vectors left in 0..6 after dense training plus their fresh20 each.
Do not describe another balanced five-map block as fresh.

Fit only UC2-4 (323 vectors outside its reserved20) and tutorial (80 pairs
outside its reserved20), using the existing BC workflow and measured
hard-example weights. Keep the verified UC2-1/2 weights and original UC2-3
model. Test the unchanged UC2-3 model on all 343 vectors independently of
the reserved40. After candidate freeze, execute the actual registered driver
on the finite full domain: four UC2 maps times 343 triples in 0..6, plus
100 tutorial pairs in 0..9, totaling 1472 cases and 4316 train arrivals.
This systematic comparison includes training cases and is not a holdout.
Report its results separately from the independently reserved new40.

Additional new file: `backend/app/policies/learned/checkpoints/uc2_roam_tutorial.pt`.
Modify the exporter to permit a trained tutorial specialist and version-three
selection records, and modify the runtime bundle's tutorial filename and
integrity tests when this candidate is selected. The original UC2-3 actor,
native physical fixtures and four-entry bounded loader cache remain as before.
Source/identity changes will be frozen before opening the reserved40.

The expanded tutorial reveals a native action-contract defect, not missing
network fit: FastTree treats MALFUNCTION_OFF_MAP as done and masks every
action except DO_NOTHING. At a cleared current malfunction, native Flatland
permits entry through FORWARD (and STOP with a different resulting state).
Collection therefore replaces physically meaningful PP actions with NOOP
and can never match the unchanged raw PP baseline. Correct only the UC2
state-aware mask, preserving all 313 feature values and other schemas.
Preserve an explicitly permitted off-grid STOP in teacher canonicalization.
Validate raw PP/collected PP trajectory parity and native 0/2/4 transitions,
then regenerate affected tutorial data. Test the retained original tutorial
actor with the corrected mask before adding a fifth model.

Modified files for this correction: `backend/app/policies/learned/uc2_observation.py`
(only recovered off-map action availability) and
`backend/lab/marl/collect_pp_demonstrations.py` (preserve meaningful allowed
STOP). New file: `backend/tests/test_uc2_offmap_recovery_contract.py`.
This does not change native physics, scheduled faults, timetables or PP.

The complete UC2-3 grid reveals seven additional four-step lateness regrets
at offsets (0, x, 6), despite 336 casewise wins and substantially lower total
lateness. All 343 inputs are now known systematic data. Correct these with
native PP examples while retaining the existing actor's useful behavior:
test existing BC plus verified DLA replay, or standard supervised PP loss
with an offline KL/soft-distillation prior on the frozen guarded actor's good
trajectories. The latter is an explicitly chosen training seam using existing
Torch and native rollout APIs, not a new dispatch solver. Neural-prior data
must be identified as such rather than falsely attributed to PP or DLA.
No new dependencies, observation architecture or runtime lookup is needed.
Select by complete native343 casewise comparison, then freeze; the new40
reserved UC2-4/tutorial cases remain untouched.

Also compare an isolated proposal-mask alternative before choosing another
model: a same-heading follower may request its currently occupied next
configuration even when the leader cannot exit in this fractional-speed
step. Native MotionCheck resolves that request to waiting; the unchanged
whole-batch ROAM certificate remains mandatory. Current masking can instead
force a needless detour. This is a conditional proposal, never an assumed
resource release, and must exclude opposing-direction configurations.
Evaluate all343 UC2-3 cases plus known309 before any runtime promotion;
retain actual post-step certificate/resource audits and reject regressions.

New regression file `backend/tests/test_uc2_roam_pp_parity.py` will exercise
one previously observed PP-lateness counterexample per infrastructure through
the actual registered policy, with planner fallbacks prohibited. These are
known regression inputs, not the newly reserved40.

Selected C3 ingredients now pass their component comparisons: unchanged
UC2-1/2 dense specialists; UC2-3 projected-safe correction plus neural-prior
distillation; UC2-4 dense specialist; tutorial specialist collected and fitted
after the native off-map mask fix. Five active model files are selected only
by infrastructure. The original `uc2_demo_ppo.pt` remains a separately pinned
baseline. The generic queue proposal was rejected after 21 PP regressions
on the complete UC2-3 grid despite clean safety checks.
The exported registry run completes known309 with 878 arrivals, lateness6716
versus PP8521 and zero casewise regressions. New40 remains unopened.

## Final known-domain correction

Frozen C3 completes all1472 cases but retains exactly one lateness regret:
tutorial offsets(0,8),11versus PP9. Its independent fresh40 gate therefore
fails and remains archived as failed. Every tutorial pair in0..9 is now
known; no further same-domain independent tutorial confirmation is claimed.
An offline strict-PP LEFT label at the observed step13 junction, with a
frozen-neural-prior KL on99 good tutorial trajectories, corrects this final
case. The selected50-update128-wide checkpoint passes all100 known tutorial
pairs with zero per-case lateness or makespan regrets, total823versus PP826.
Other four model tensors remain fixed. A final actual-registry1472 regression
run, source lock, tests and CI are required before reporting the finite-domain
acceptance gate as passed. This final test is explicitly not a holdout.

## Acceptance

- Zero technical errors, resource conflicts, unexplained native prediction
  mismatches and newly stuck actual states on the selected comparison block.
- Report counts and IDs of cases better/equal/worse than PP for each metric,
  per infrastructure and overall; never conceal completion regressions.
- Focused native tests, then required repository checks for promoted changes.
- If no candidate reaches PP casewise, state the remaining counterexamples
  and practical next step rather than claim the objective is achieved.
