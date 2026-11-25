# UC2 RL: learning from the study's DLA-driven states

Status: proposal, 22 November 2026. Base: `codex/pf-ch-rl-main` at `bf67e6e3`.
Follows the "Remaining" item of [uc2-rl-proposal-agent.md](uc2-rl-proposal-agent.md):
*refit on DAgger labels from DLA takeover states*. Builds on the DAgger
machinery of [uc2-rl-user-command-recovery.md](uc2-rl-user-command-recovery.md)
and the distillation of [uc2-rl-per-infrastructure.md](uc2-rl-per-infrastructure.md).

## Problem

In Plan B the trains run on `deadlock_avoidance` (DLA) until the participant
takes a course. The KI column (`uc2_rl`) therefore always starts from a
DLA-driven state. The model and its teachers were fitted on states produced
by the teachers themselves (known timetables) and by user commands, never on
states produced by DLA. From some of these states the suggested course is
later than the *Plan* column it is meant to improve on.

## Measured before designing (22 November 2026)

On the 46 frozen DLA takeover cases (`docs/examples/uc2-rl-adviser/takeover-cases.json`),
every course was replayed and ranked as the API ranks it (`proposal_rank`:
not arrived, then lateness). Script and raw rows:
[`uc2-rl-dla-takeover-dagger/`](uc2-rl-dla-takeover-dagger/).

| Source | vs PP: better / equal / worse | Notes |
|---|---|---|
| Shipped `uc2_rl` adviser (best of its courses) | 12 / 23 / 9 | **9 of 46 cases are later than DLA just continuing**, e.g. uc2-1 @8/24/30: 72 vs 31; uc2-4 @27/36/54: 142–154 vs 64 |
| Per-scenario teachers (`uc2_roam_teacher_*`) | 10 / 13 / 11 | No better than the student on these states, often worse (uc2-1 @16: 72; @40: 127) |
| `pp_replan` (best order) | — | No course in 2 cases (uc2-1 @40, uc2-4 @54) |

Consequences for the design:

- **Relabelling DLA states with the teachers does not help.** The trainer's
  existing `--perturbed` path (teacher relabel) would teach the student the
  teachers' own mistakes on these states.
- **No single expert is enough.** PP is best where the model fails (uc2-1,
  uc2-2, uc2-4), the model is best on uc2-3 (22 vs PP 33–50), and DLA itself
  is best once in uc2-4 (@54).
- **A best-of verified teacher would remove the gap on this set.** Taking,
  per state, the best replayed course of {student, PP orders, DLA
  continuation} lowers lateness on the student's completed cases from 1,606
  to 1,127 (−30 %), with no completion lost. That is an upper bound for what
  imitation can reach here, not a result.

## Approach: DAgger on DLA takeover states with a best-of verified teacher

This is learning, not a runtime rule. The runtime stays `UC2RoamPolicy` →
ROAM → overrides, and the adviser still has no planner fallback
(uc2-rl-adviser-lookahead.md).

1. **Takeover states.** Drive DLA from step 0 and take over at every
   `k`-th step (k = 2) until all trains are done:
   - the study fixtures (seed 42), on all clocks **except** the 46 frozen
     development clocks;
   - the TRAIN split of the known systematic timetables
     (`systematic1472-v3-cases.json`, `prepare_uc2_splits.py`).
2. **Verified course per state.** Candidates are the current student's greedy
   course, every `replan_orders` PP course and the DLA continuation. Each is
   replayed from the takeover state with `TrajectoryBranchRunner` (PlanPolicy
   for trainruns, DLA as itself) and ranked with `proposal_rank`. Only a
   completed course that beats the student's ranking yields labels.
3. **Labels.** Replay the winning course in a `PFChEpisode` with the
   `uc2-context-v1` builder and record every multi-choice decision: features,
   ROAM-masked action mask, and the executed action canonicalised with
   `canonical_teacher_action` (from `collect_pp_demonstrations`). Labels whose
   features lie within `--conflict-radius` of a known-timetable state with a
   different action are dropped, as in the recovery plan.
4. **Fit.** From the shipped `uc2_roam_uc2_track.pt`, with
   `train_uc2_infrastructure.py`: the existing teacher CE + KL + capped margin
   on all known-timetable states (prior), plus CE on the new labels. Start
   with the stage-2 polish recipe (standardised inputs, full batch, margin
   cap 0.05). Selection still requires zero known-timetable disagreements.
5. **DAgger rounds.** Roll the new candidate out from the same takeover
   states, add labels for newly visited states where a verified course beats
   it, refit from the same base. Stop after 3 rounds or when a round adds
   no labels.
6. **Scope.** UC2 track (uc2-1…4) only. The tutorial model has one gap on
   this set (@10: 19 vs 17) and no trainer path yet; it stays unchanged.

## Gates

A candidate ships only if all hold; otherwise the shipped model stays.

- **G1 known domain** (1,472 timetables): all complete, zero casewise
  lateness regrets against PP. Unchanged from the earlier plans.
- **G2 study scenarios** (seed 42, no commands): no later than now (19 / 24 /
  20 / 30).
- **G3 held-out user commands:** at least 828 / 883 solvable cases solved;
  every newly failing case listed.
- **G4 DLA takeover, development** (the 46 frozen cases, never used for
  labels): no case loses a completion, no case gets later, and the count of
  cases later than DLA continuing falls from 9.
- **G5 DLA takeover, held-out:** a new frozen manifest from the TEST split
  timetables, written before the first fit. Same criteria as G4, reported
  separately and honestly as generalisation evidence.

## New files

| File | Purpose |
|---|---|
| `backend/lab/marl/collect_uc2_dla_takeover.py` | DLA prefixes, best-of verified course per takeover state, label recording, resumable per-case output and manifest |
| `backend/tests/test_uc2_dla_takeover.py` | Prefix states equal the live DLA run; labels only from completed courses that beat the student; labels respect the ROAM mask; frozen development clocks are excluded |
| `docs/examples/uc2-dla-takeover/` | Collection manifests, held-out manifest (G5), fit reports, gate results |

## Modified files

| File | Change |
|---|---|
| `backend/lab/marl/train_uc2_infrastructure.py` | `--labelled DIR` (repeatable) and `--label-weight`: CE on recorded expert actions instead of teacher relabel; report per-scenario label fit |
| `backend/tools/evaluate_uc2_adviser.py` | Optional `--checkpoint` to evaluate a candidate model on the same frozen cases; report DLA-continuation and PP ranks next to the adviser (G4/G5) |
| `backend/app/policies/learned/checkpoints/uc2_roam_uc2_track.pt` | Replaced only if G1–G5 pass |
| `backend/app/policies/learned/checkpoints/uc2_roam_specialists.json`, `backend/app/policies/learned/uc2_roam_bundle.py` (`MANIFEST_SHA256`) | New hash and training note, only if replaced |
| `docs/plans/uc2-rl-proposal-agent.md` | Link this plan from "Remaining" |

No change to Flatland, ROAM, the observation schema, overrides, the adviser's
search, the frontend, Plan B conditions or any stored or logged ID.

## Risks

- **Indistinguishable states.** The observation carries no history, so a DLA
  state can match a known-timetable state that needs another action. These
  labels are dropped (step 3); if too many are, the remaining gap needs a
  schema change, which is out of scope.
- **G1 is strict.** One known-timetable disagreement costs about half a PP
  regret (per-infrastructure plan). New labels pull on the same weights;
  the polish phase may need several attempts.
- **Compute.** Teacher-state cache (474,179 states), one fit and a G1 run
  each take hours on the 8-core / 7 GB dev container. Collection is
  resumable; fits run with `--workers 4`.
- **Study comparability.** Replacing the model changes the KI column between
  participants run before and after. `meta.json` records the agent id, not the
  model hash; ship before the first participant or record the hash.

## Open questions

- **Q-1 Ownership.** The shipped model and this branch belong to the
  `codex/pf-ch-rl-main` work. Is a model replacement wanted there, as a PR into
  that branch?
- **Q-2 Training on the study fixtures.** The model is bound to the five
  fixtures anyway, so training on their DLA states is in scope; G4 keeps the
  frozen development clocks out and G5 provides held-out evidence. Agreed?
- **Q-3 Meanwhile, in the UI.** Until a better model ships, should a KI course
  that is later than *Plan* be marked or not offered? That is a presentation
  decision for the co-learning panel and is not part of this plan.
- **Q-4 Model hash in study data.** Add the model's SHA256 to `meta.json`
  (one line in `trajectory_recorder.py`)?
