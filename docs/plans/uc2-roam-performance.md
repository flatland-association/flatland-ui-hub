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

## Acceptance

- Zero technical errors, resource conflicts, unexplained native prediction
  mismatches and newly stuck actual states on the selected comparison block.
- Report counts and IDs of cases better/equal/worse than PP for each metric,
  per infrastructure and overall; never conceal completion regressions.
- Focused native tests, then required repository checks for promoted changes.
- If no candidate reaches PP casewise, state the remaining counterexamples
  and practical next step rather than claim the objective is achieved.
