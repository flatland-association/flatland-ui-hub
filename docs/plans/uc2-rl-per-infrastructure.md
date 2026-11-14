# UC2 RL: one model per infrastructure

Status: done, 14 November 2026. Builds on
[uc2-rl-user-command-recovery.md](uc2-rl-user-command-recovery.md)
(branch `feat/uc2-rl-user-command-recovery`).

## Problem

`uc2_rl` selects one of five checkpoints by fixture identity. The manifest
calls them "infrastructure specialists", but four of the five scenarios share
one infrastructure:

| Scenario | Rail | Horizon | Rolling stock |
|---|---|---|---|
| uc2-1 | UC2 track (`200caaee…`) | 168 | standard |
| uc2-2 | UC2 track | 102 | different stock |
| uc2-3 | UC2 track | 240 | standard |
| uc2-4 | UC2 track | 180 | standard |
| tutorial | tutorial track (`4bdbfd7e…`) | 40 | own |

So there are four models for the UC2 track. Each also receives a scenario
one-hot (features 272–276 of `uc2-context-v1`), which is an identity flag
rather than a physical input.

Goal: **one model per infrastructure**. That means one for the UC2 track and
one for the tutorial, which already has its own. Performance must be at
least as good as the current setup.

## Feasibility (measured)

Each current UC2 specialist ran on its 343 known timetables, giving 283,439
decision states. The scenario one-hot was then blanked:

- No state occurs in two scenarios, so there are no direct conflicts. The
  scenarios still differ in physical inputs: time relative to the horizon,
  timetable slack and rolling stock.
- The nearest other-scenario state with a different action is at least 0.1
  away (L2). uc2-1 and uc2-4, which share stock, are closest. 20 of 3,000
  sampled states have such a conflict within 0.2; uc2-2 and uc2-3 have none.

A scenario-blind network can therefore represent all four specialists.

## Approach: distil four specialists into one scenario-blind student

1. **Teacher states:**
   - every multi-choice decision of each current specialist on its scenario's
     343 known timetables;
   - the off-plan states from the user-command collection (round 1), relabelled
     with the current specialist's logits.
2. **Student input:** the `uc2-context-v1` features with the scenario
   one-hot zeroed, in training and at runtime. The checkpoint declares
   `blind_inputs: [[272, 277]]`, and `LearnedPpoPolicy` zeroes those inputs
   before every forward pass. The student cannot read the scenario even if the
   builder still computes it, and schema and width (313) stay unchanged.
3. **Fit:**
   - Initialise from `uc2_demo_ppo.pt`, the original actor trained on all
     five fixtures, widened with the existing `load_model(hidden_size=…)`.
   - Loss: CE on the teacher action, plus KL to the teacher distribution,
     plus an argmax-margin hinge on every state.
   - Selection target: zero disagreements with the teacher on all known
     timetable states.
4. **Gates.** All must hold for the shipped runtime, otherwise nothing changes:
   - G1: all 1,472 known timetables complete, zero casewise lateness regrets
     against PP (as now).
   - G2: study scenarios no later than now (tutorial 9, uc2-1 19, uc2-2 24,
     uc2-3 20, uc2-4 30).
   - G3: held-out user-command suite at least 826/883 solvable cases solved,
     with every newly failing case listed.

Generalisation to unseen horizons on the UC2 track is not claimed. The
fixture check still admits only the five known fixtures; relaxing it is a
separate decision.

## New files

| File | Purpose |
|---|---|
| `backend/lab/marl/train_uc2_infrastructure.py` | Collect teacher states/logits, distil the student, report disagreement per scenario, run G1/G2 |
| `backend/app/policies/learned/checkpoints/uc2_roam_uc2_track.pt` | The shared UC2-track model |
| `backend/app/policies/learned/checkpoints/uc2_roam_teacher_uc2_{1,2,3,4}.pt` | Pinned teachers (training inputs only) |
| `backend/tests/test_uc2_infrastructure_model.py` | One file per infrastructure, scenario inputs blinded at inference, identical actions whatever the one-hot says |
| `docs/examples/uc2-per-infrastructure/` | Fit report, gate results |

## Modified files

| File | Change |
|---|---|
| `backend/app/policies/learned/learned_ppo_policy.py` | `load_actor_critic_checkpoint` reads and range-checks optional `blind_inputs`; `infer_prepared` and `value_estimate` zero those feature ranges (`_blinded`) |
| `backend/app/policies/learned/uc2_roam_bundle.py` | `INFRASTRUCTURES` (infrastructure → scenarios), `INFRASTRUCTURE_FILES`, `infrastructure_for_scenario`; `MODEL_FILES` derived from them; `verify_bundle` also checks the manifest's `infrastructures` section; new `MANIFEST_SHA256` |
| `backend/app/policies/learned/checkpoints/uc2_roam_specialists.json` | uc2-1…4 entries reference the shared model; `infrastructures` and `teachers` sections |
| `backend/app/policies/learned/checkpoints/uc2_roam_uc2_{1,2,3,4}.pt` | Removed from the runtime set; the same weights are kept as the pinned `uc2_roam_teacher_*` files |
| `backend/tests/test_uc2_roam_specialists.py` | Expectations for one file per infrastructure |
| `backend/app/policies/registry.py` | `uc2_rl` description, provenance and grounding wording |

## What it took

Distilling straight to zero disagreements did not work.

- **Stage 1** (256 units, sampled batches, 30,000 updates) ended with 54 of
  283,439 known-timetable decisions different from the teachers. Those
  caused 2 PP lateness regrets on uc2-1 alone. Roughly one regret per two
  disagreements, so the target really is zero.
- **What was left was not cross-scenario conflict.** The remaining states
  are step- and cell-precise boundaries inside one scenario. Example, uc2-4:
  FORWARD with `peer0.column` 0.2078 and STOP at 0.1948 (one cell), with
  departure slack 1/180 apart. The specialists memorised these PP timing
  choices.
- **Stage 2** (the polish that worked):
  - widen the stage-1 model to 384 units (`load_model` keeps its function);
  - train on per-feature standardised inputs, folded back into the first
    layer on save;
  - use full-batch gradients over all 474,179 states;
  - spread the hinge over the current violators only, with the margin
    capped at 0.05 logits (only the right argmax is required).

  Known disagreements went 23 → 10 → 7 → 5 → 4. The 4 left (uc2-3) change no
  outcome.

Rejected variants are in the stage logs: sampled hard mining (oscillates),
uncapped margin (stalls at 14 uc2-4 states) and 256 units without
standardisation (plateaus at about 25).

## Results (14 November 2026)

Shipped: `uc2_roam_tutorial.pt` (unchanged) and `uc2_roam_uc2_track.pt`
(384 units, `blind_inputs` = scenario one-hot), through the registry
runtime.

| Gate | Per-scenario specialists (before) | One model per infrastructure |
|---|---|---|
| G1 known domain (1,472) | complete, 0 PP regrets; lateness 823 / 6,552 / 8,397 / 7,922 / 10,674 | **identical**: complete, 0 PP regrets, same lateness per scenario |
| G2 study scenarios | 9 / 19 / 24 / 20 / 30 | **identical** |
| G3 held-out user commands | 826 / 883 | **828 / 883**: +4 (heldout-0234, -0504, -0575, -0913), −2 (heldout-0768 uc2-3, heldout-1020 uc2-4, both chaotic multi-command); lateness on the 824 both solve +0.4% |

- Scenario identity: by test, forging any scenario one-hot leaves the
  track model's actions and probabilities unchanged
  (`tests/test_uc2_infrastructure_model.py`).
- Backend suite: 1,007 passed, 22 skipped.
- Evidence is in `docs/examples/uc2-per-infrastructure/`.

## Remaining

- The track model is still validated only on the five fixtures; the fixture
  check rejects other horizons on the UC2 track. Relaxing it needs a new
  validation set (unseen horizons) and is a separate decision.
- Teachers are pinned in the repository as `checkpoints/uc2_roam_teacher_uc2_{1,2,3,4}.pt`
  (manifest `teachers`; `uc2_roam_bundle.teacher_checkpoint`). They are never loaded at runtime,
  and `train_uc2_infrastructure` uses them by default.
