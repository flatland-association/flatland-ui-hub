# UC2 RL: recovering after unusual user commands

Status: round 1 done, 14 November 2026. Parent: `778e37cd` (`codex/uc2-rl-20261113`).

## Problem

In the study, participants can hold trains (sticky STOP) and force one-shot
LEFT/FORWARD/RIGHT/DO_NOTHING at the next switch. After such a command, the
`uc2_rl` driver should still bring every train home unless a deadlock has
become unavoidable.

A perturbation suite built from the five study scenarios (session env,
seed 42) issues user commands through the real `override_manager` and
`OverridePolicy`:

- single commands: STOP held 5/15/40 steps, or LEFT/FORWARD/RIGHT/DO_NOTHING,
  per train, at six start times;
- pairs of commands on two trains;
- 40 "chaotic" three-command sequences per map.

918 cases change at least one action. A case counts as solvable when DLA
finishes the same perturbed episode, or when a reference solver finishes
from the state where the last command ends.

| Driver | Solvable cases solved (of 883) |
|---|---|
| Original actor `uc2_demo_ppo.pt` | 723 (82%) |
| Original actor + forecast guard (scratch experiment, about 38 s per episode) | ≈783 (89%) |
| Current `uc2_rl`: specialists + joint ROAM (`778e37cd`) | 804 (91%) |

Without ROAM, the original actor's failures are all deadlocks, typically a
train stopped on a merge with nothing coming. Its decisions there depend on
its own departure slack. They also depend on padding features of trains that
don't exist. The specialists are fitted on timetable variations only, so they
have never seen states created by user commands. ROAM removes most of the
unsafe *moves*, but it cannot add a missing move or a better route. Of the 79
remaining failures, DLA solves 45 with the same commands.

## Approach: DAgger with verified one-step corrections

Imitation-learning repair (DAgger) using the same training seam as the ROAM
specialists: supervised correction labels plus a KL term toward the frozen
specialist's own logits. This keeps behaviour on known timetables. It is
learning, not a new runtime rule: the runtime stays
`UC2RoamPolicy` → ROAM withdrawal → human overrides.

1. **Training commands.** These are generated separately from the held-out
   suite:
   - STOP durations 3/10/25/60 instead of 5/15/40;
   - start fractions 0.05/0.15/0.3/0.5/0.7/0.9;
   - a different chaos seed.

   They run on the study env and on a sample of known systematic timetables
   per map (`PFChEpisode`, native faults included).
2. **Rollout.** The candidate driver runs exactly as at runtime:
   - the model proposes;
   - an optional correction replaces one train's proposal, and only if the
     ROAM-masked action set allows it;
   - `finalize_actions` (ROAM) runs;
   - `OverridePolicy.apply_overrides` applies the user's commands.
3. **Verified corrections.** For a failed episode:
   - Find the last step `t*` from which DLA, still under the same pending
     user commands, can finish (bisection over replays from step 0).
   - At `t*`, try every alternative allowed action for each train the policy
     controls.
   - Keep the alternative that lets the *candidate itself* finish, at the
     lowest lateness. If none does, keep one after which DLA can still
     finish, and repeat (at most 6 corrections per episode).
   - Only corrections whose combined episode completes become labels.
4. **Prior.** Frozen logits of the current specialist go on all
   multi-choice states that it already handles. Those come from completed
   perturbed episodes, completed corrected episodes and nominal systematic
   timetables.
5. **Fit, per map.** From the current specialist: Adam `1e-4`, prior KL 10,
   correction CE 1, one Torch thread, existing `ActorCritic`/`masked_logits`.
   Further DAgger rounds roll out the new candidate, add its new labels and
   refit from the same base.
6. **Selection gates (per map).** In order; a candidate that fails a gate is
   not shipped, and the map keeps its current specialist:
   - G1 known systematic domain (343 timetables per UC2 map, 100 tutorial):
     every mission complete and zero casewise lateness regressions against PP.
     This is the standard the current specialists pass.
   - G2 study scenario (seed 42, no commands): complete, lateness no worse
     than now (tutorial 9, uc2-1 19, uc2-2 24, uc2-3 20, uc2-4 30).
   - G3 held-out user-command suite (the 918 cases above, never used for
     training or selection of labels): more solvable cases solved than the
     current specialist. Every newly failing case is listed.

Observation changes (masking empty peer slots, dropping slack features) are
**not** part of this plan. They change `uc2-context-v1` for all five maps and
invalidate the 1,472-case evidence. Revisit only if DAgger alone stalls.

## New files

| File | Purpose |
|---|---|
| `backend/lab/marl/uc2_user_commands.py` | Command generators (training and held-out), user-command schedule on the real `override_manager`, runtime-identical rollout with optional corrections/DLA tail, verified correction search |
| `backend/lab/marl/collect_uc2_recovery.py` | DAgger collection per map: rollouts, correction labels, prior states, manifests |
| `backend/lab/marl/train_uc2_recovery.py` | Fit correction CE + frozen-prior KL from the current specialist; gates G1/G2 |
| `backend/lab/marl/evaluate_uc2_user_commands.py` | Held-out suite G3 for any checkpoint set; parity mode reproduces the current 804/883 |
| `backend/tests/test_uc2_user_commands.py` | Schedule semantics (sticky STOP release, one-shot turns), rollout parity with `create_runtime_policy('uc2_rl')`, corrections only within the ROAM mask |
| `docs/examples/uc2-user-command-recovery/` | Frozen held-out cases, collection/selection manifests, gate results |

## Modified files

| File | Change |
|---|---|
| `backend/app/policies/learned/checkpoints/uc2_roam_*.pt` | Replaced only for maps whose candidate passes G1–G3 |
| `backend/app/policies/learned/checkpoints/uc2_roam_specialists.json` | New hashes and training note for replaced models |
| `backend/app/policies/learned/uc2_roam_bundle.py` | `MANIFEST_SHA256` |
| Tests pinning specialist hashes, if any | Updated hashes |

No change to Flatland, ROAM, the observation schema, overrides, the frontend
or Plan B (which keeps `deadlock_avoidance`).

## Changes made during implementation

- **Prior anchoring.** KL alone (weight 10, sampled batches) moved hundreds of
  near-tie decisions on known timetables. The first uc2-2 candidate had 18
  incomplete missions and 96 PP lateness regrets. The fit now uses:
  - every multi-choice state of every known timetable of the map;
  - an argmax-margin hinge, weight 10, over all prior states at every update;
  - lr `5e-5`.

  Gates run only once no known-timetable decision flips.
- **Indistinguishable corrections are dropped.** Some verified corrections
  are *exact duplicates* of known-timetable observations whose correct
  action differs. In uc2-2, 13 of 48 are exact duplicates and 20 are within
  0.05. In those states only the user's hold on another train differs, and
  the observation does not contain it. No network can learn both actions, so
  corrections within 0.05 of a known-timetable state with another base
  action are excluded (`--conflict-radius`).
- **Collection** writes per-episode results and resumes after interruption.

## Results (round 1, 14 November 2026)

Collection: 6,636 training episodes (study timetable plus five known
timetables per map); manifests are in
`docs/examples/uc2-user-command-recovery/collection-round1/`. Most
unlabelled failures are unavoidable: in 46 of 50 sampled, DLA cannot finish
even when it drives from step 0.

| Map | Failed / labelled episodes | Labels kept (dropped) | G1 known domain | G2 study | G3 held-out solvable solved | Decision |
|---|---|---|---|---|---|---|
| tutorial | 280 / 24 | 24 (46) | pass | pass | 84 → 84 (+0 −0) | keep current |
| uc2-1 | 244 / 146 | 306 (31) | pass, 343/343, 0 regrets | pass | 169 → 178 (+10 −1) | **replaced** |
| uc2-2 | 205 / 26 | 28 (20) | pass, 343/343, 0 regrets | pass | 179 → 192 (+13 −0) | **replaced** |
| uc2-3 | 60 / 17 | 20 (1) | fail, 3 PP lateness regrets | pass | not run | keep current |
| uc2-4 | 94 / 36 | 79 (31) | pass | pass | 185 → 185 (+2 −2), lateness +496 | keep current |

Shipped runtime (`create_runtime_policy('uc2_rl')`) after replacing uc2-1
and uc2-2:

- Held-out: **826 / 883** solvable cases solved, up from 804. 23 fixed, one
  newly failing (`heldout-0234`, uc2-1, T0 held 40 steps at step 35).
  Lateness on the 803 cases both solve: 32,329 vs 32,233 (+0.3%).
- Known domain: all 1,472 cases complete, zero casewise lateness regrets
  against PP. Lateness is unchanged per map (tutorial 823, uc2-1 6,552,
  uc2-2 8,397, uc2-3 7,922, uc2-4 10,674).
- Study scenarios: tutorial 9, uc2-1 19, uc2-2 24, uc2-3 20, uc2-4 30
  (unchanged).
- Backend tests: 998 passed, 22 skipped.

Evidence: `known-domain-final.json`, `heldout/final-runtime.json`,
per-candidate held-out results and fit reports in
`docs/examples/uc2-user-command-recovery/`.

## Remaining

- **Observation gap.** The observation does not show that a train is held
  by a user command. That gap blocks 129 of 586 verified corrections. A per-train
  "held by user" feature would let the policy distinguish these states. It
  is a schema change (`uc2-context-v2`) for all five maps and needs a new
  known-domain run. Separate decision.
- Further DAgger rounds for uc2-1/uc2-2. uc2-3 (only 4 held-out failures)
  and uc2-4 might pass with a stronger margin; not attempted.
- 57 solvable held-out failures remain. Some are solvable only by reference
  solvers from the state after the last command, not by DLA with the same
  commands.

## Superseded runtime layout

The replaced uc2-1/uc2-2 specialists are now teachers of the single
scenario-blind UC2-track model
([uc2-rl-per-infrastructure.md](uc2-rl-per-infrastructure.md)). The shipped
runtime solves 828/883 solvable held-out cases. The per-scenario files were
removed from `checkpoints/`.
