# MARL lab — practise human-AI collaboration with a learned multi-agent policy

> Dated plan, 2026-10-18. Status: **steps 1–3 done (2026-10-18/19), step 4 open.** Background:
> the learned-policy section of [`ecosystem.md`](../reference/ecosystem.md) and
> the MARL research of 2026-10-18 (kept outside the repo).

## Goal

The goal is **learning how the collaboration works**, not just training a MARL
agent. A learned multi-agent policy runs in the hub, and the human works with it
in all three modes. What the human does (accept, override, choose) flows back
into the next training run. The loop then makes visible whether and how the
collaboration improves.

```
  train (local)  ──►  checkpoint  ──►  play in the hub (mode X)
        ▲                                     │
        └──── interventions + choices ◄───────┘
```

It runs **locally first**: CPU, or the GPU of an Apple-silicon Mac (`mps`).
Hugging Face is optional for larger GPU runs, using the same scripts with
`--device cuda`.

## Why this shape

- Every Flatland challenge was won by planning (PP, LNS, CBS). So the learned
  policy here is for **practising and comparing**, not a replacement for the
  PP/CBS core.
- The interesting human-AI research results all come from this loop:
  - **Interventions as a learning signal.** HG-DAgger and IWR learn from the
    human's corrections, and our override is exactly the tuple they need (state,
    AI action, human action).
  - **Coordination with a human.** Agents trained only with themselves coordinate
    worse with humans (Carroll 2019; Fictitious Co-Play 2021).
  - **The operator model** (`backend/app/core/operator_model.py`) already
    estimates the operator's KPI weights from deliberate choices (co-learning
    Level B). The lab adds the *action level* next to it.

## What already exists and is reused

| Building block | Where | Use in the lab |
|---|---|---|
| ECML 2026 PPO checkpoint, observation builder and curriculum generator | [`flatland-association/ecml2026-starterkit`](https://github.com/flatland-association/ecml2026-starterkit), MIT, same `flatland-rl==4.2.6` | Starting policy and observation (36 features plus action mask). Vendored with the licence note |
| Policy registry and `Policy` interface | `backend/app/policies/registry.py`, `base.py` | The learned policy becomes a normal, selectable policy (still global per session) |
| Overrides | `override_manager.py`, `override_policy.py`, `api/overrides.py` | Source of the interventions |
| Operator model | `core/operator_model.py` | Preference level. Stays as it is; the lab reads its view |
| Trajectory fork | installed `flatland-rl` | "AI alone" counterfactual from the same step for comparison |
| Torch training infrastructure | `goal_based_policies/train_*.py` | Pattern for device selection and checkpoint handling |

## Own-algorithm decision (AGENTS.md "Reuse, don't reinvent")

The ECML kit ships a checkpoint but **no training code**. We therefore write
our own, deliberately small:

1. A **shared-parameter PPO trainer** (one network for all trains, as in the
   ECML kit). It is standard PPO, about 300 lines of torch, and no new method.
2. **Fine-tuning from interventions**, HG-DAgger style: behaviour cloning on the
   override tuples, weighted against the existing PPO loss (IWR idea).

This is the explicit decision. Reason: it is a practice lab, and the training
loop is exactly what the human is meant to understand. If an MIT-licensed
Flatland trainer turns up later (e.g. maze-flatland after a licence check), we
switch over.

## Steps

### Step 1 — learned policy in the hub (small)

- `backend/app/policies/learned/`: vendored ECML observation builder and
  `ActorCritic`, loadable from a checkpoint path, plus a `LearnedPpoPolicy` in
  the registry ("Learned PPO (ECML 2026)").
- **Done when** a session on the project's scenarios (demo, PF-CH corridor) runs
  under the policy.
- **Measure first:** how many trains arrive compared with the deadlock-avoidance
  policy and PP. It is unknown whether the ECML observation generalises beyond
  the ECML topology. If it does not, step 3 trains on our own scenarios.

**Status 2026-10-18: done.**

- **Code:**
  - `app/policies/learned/` holds the vendored network and observation, the
    MIT licence and `checkpoints/ecml2026_ppo.pt`.
  - The policy is registered as `learned_ppo` in `registry.py`.
  - Tests are in `tests/test_learned_ppo_policy.py`.
  - The measurement is `python -m lab.marl.evaluate`.
- **Local change to the vendored observation:** one guard in `_explore` stops
  at the grid edge. Olten has open track ends at the border, and without the
  guard the observation crashes there.

Measured with `python -m lab.marl.evaluate`: no human, episode run to the end,
"arrived" = trains at their target.

| Scenario | DLA (default) | Shortest Path | Learned PPO |
|---|---|---|---|
| ECML 2026 scene 1 (its own topology) | 6/6, delay 33 | 2/6 | **6/6, delay 0** |
| generated 30×30, 3 trains | 3/3 | 3/3 | 3/3 |
| generated 36×24, 7 trains | 7/7 | 4/7 | 4/7 |
| PF-CH wn–wal long approach | 3/3, delay 0 | 0/3 | **3/3, delay 0, faster** |
| PF-CH wn–wal conflict | 3/3, delay 3 | 0/3 | 1/3 |
| PF-CH corridor (16 trains) | 11/16 | 1/16 | 1/16 |
| PF-CH corridor with stops (16 trains) | 11/16 | 1/16 | 1/16 |
| Olten (52 trains) | 52/52 | 30/52 | 28/52 |

**Reading:** the checkpoint does **not** generalise. Off its own topology it
deadlocks on single-track sections about as badly as Shortest Path. Two
consequences:

1. For practice that is useful as it is. In the corridor scenarios the human
   *has* to intervene, so the interventions are real learning data (step 2).
2. Step 3 has to train on the project's own scenarios. Fine-tuning the ECML
   checkpoint is the obvious start.

The cost per step is 1–5 ms, so no extra load on the play loop.

### Step 2 — log interventions (small)

- Per lab session a JSONL file under `backend/lab/runs/<session>/` (gitignored).
  Each override writes `{step, handle, obs, mask, ai_action, ai_probs,
  human_action, mode}`. Each option choice in co-learning writes the chosen and
  the rejected options.
- Only active when the session runs under a learned policy, so nothing changes
  for studies.

**Status 2026-10-19: done.**

- **Where a line is written:**
  - `app/core/intervention_log.py` writes one line per override, at the moment
    the override replaces the policy's action at the decision point
    (`OverridePolicy`).
  - The line holds `obs` (36), `mask` (5), `ai_action`, `ai_probs`,
    `human_action`, `agreed`, `mode`, `owner`, `requested_step` and `step`.
  - The request (`POST /agent/{handle}/override`) now also carries `mode` and
    `owner` (frontend `api.setOverride`). A system hold therefore arrives as
    `owner: "system"`, and step 3 can filter it out.
- **What is logged and what is not:**
  - Only policies with `intervention_features()` write lines, so today only
    `learned_ppo`.
  - Branch sessions (`branch-…`) are never logged.
  - A STOP held for several steps counts once.
  - Reroutes (action 5) are not logged yet: they are a route, not one action
    at a decision point.
  - Writing is best-effort: a read-only disk does not stop a step.
- **Option choices in co-learning:** these already go to the operator model
  (`POST /operator/{id}/signal`, without a session id). Step 3 reads them from
  its profiles instead of duplicating them here.
- **Files:** `backend/lab/runs/<session>/interventions.jsonl`, or
  `MARL_LAB_RUNS_DIR`. Gitignored, like `backend/lab/checkpoints/`.
- **Verified in the app:** co-learning session under the learned policy, train
  selected, "Forward" clicked. One line was written when the train reached the
  switch, with `mode: "co-learning"`, `owner: "human"` and
  `ai_probs ≈ [0.50, 0, 0.50, 0, 0]`: the policy was undecided at exactly that
  switch.

### Step 3 — local training lab (medium)

`backend/lab/marl/`, outside the app and run from the command line:

| Script | Does |
|---|---|
| `train_ppo.py` | Trains from scratch or continues a checkpoint. Scenarios from the project presets or the ECML curriculum. `--device auto` picks cuda, mps or cpu |
| `finetune_interventions.py` | Reads `runs/*/interventions.jsonl` and fine-tunes HG-DAgger style |
| `evaluate.py` | Arrivals, delay, deadlocks and intervention rate across checkpoints, as a table |

Checkpoints go to `backend/lab/checkpoints/<name>.pt` (gitignored). The registry
offers every checkpoint found there as its own entry, so you choose in the hub
which version you work with.

**Status 2026-10-19: done.**

- **Code** (`backend/lab/marl/`, run from `backend/` with `python -m lab.marl.<script>`):
  - `train_ppo.py`: standard PPO with shared parameters, the same `ActorCritic`
    (3×128) and FastTreeObs as `learned_ppo`. From scratch or `--from` a
    checkpoint. Scenarios are preset ids or `gen:WxH:trains:seed`, seed `*`
    draws a new network per episode. The reward shaping is documented at the
    top of the file: +1 on arrival (minus lateness, capped at 0.5), +0.01 per
    cell of progress, −0.002 per step on the way, −0.5 for not arriving. One CSV
    row per iteration (arrival rate, return, losses, KL) next to the checkpoint.
  - `finetune_interventions.py`: reads `runs/*/interventions.jsonl`, keeps
    `owner == "human"`, and trains HG-DAgger style: cross-entropy on the human
    action (masked logits) plus `--kl-weight` × KL(base ‖ new) on states the
    base policy visits itself. Prints the agreement with the human before and
    after, and how many of the base policy's own decisions changed.
  - `evaluate.py`: `--checkpoint` is repeatable; every file gets its own rows
    (`ckpt:<stem>`), plus a totals block per policy.
  - `common.py`: device (`auto` = cuda, mps, cpu), scenarios, observation and
    checkpoint I/O shared by the three scripts.
- **Registry:** every `backend/lab/checkpoints/<name>.pt` is the policy
  `lab:<name>` (`app/policies/learned/lab_checkpoints.py`, `registry.py`). Same
  rules as `learned_ppo`: torch only imported when a session builds the policy,
  `show_in_ui` only with torch, `supports_scenarios=False`. The directory is
  read on each lookup, so a new checkpoint appears in the next session without a
  restart. Label and description come from a `<name>.json` sidecar the trainers
  write; they name a local file, so they stay English and have no i18n key. The
  model cache in `learned_ppo_policy.py` is now keyed by modification time, so a
  retrained file under the same name is picked up.
- **Tests:** `tests/test_marl_lab.py` (registry rules, torch-free listing, a
  two-iteration PPO run, continuing from a checkpoint, a fine-tune with and
  without the KL term).
- **Verified in the hub:** both lab checkpoints appear in the policy picker
  (`Lab: scratch-5`, `Lab: ecml-ch`) and a session steps under `lab:scratch-5`.

**Measured 2026-10-19** on the Mac (mps for the update, CPU for rollouts),
4096 decisions per iteration:

| Run | What | Time | Training arrival rate |
|---|---|---|---|
| `scratch-5` | from scratch, `gen:30x30:5:*`, 60 iterations, 67k env steps | 3.3 min | 0.08 → 0.83 (peak 0.91) |
| `ecml-ch` | from ECML, wn–wal conflict + `gen:36x24:7:*` + ECML scene 1, lr 1e-4, 40 iterations | 4.3 min | 0.78 → 0.70 (stochastic, mixed scenarios) |
| `ecml-dagger` | ECML + HG-DAgger on 120 interventions, KL weight 1, 300 epochs | < 1 min | agreement with the human 0 % → 88 %; 17 % of the base policy's own decisions changed |

The 120 interventions are **not a person's**: a scripted demonstrator overrode
the ECML policy with DLA's action at decision points where the two disagreed,
through the hub's override API (`owner: "human"`, director mode) on wn–wal
conflict and the PF-CH corridor, so the real intervention log wrote them.

Greedy evaluation (`python -m lab.marl.evaluate`), arrived and total delay:

| Scenario | DLA | ECML PPO | `ecml-ch` | `ecml-dagger` | `scratch-5` |
|---|---|---|---|---|---|
| ECML 2026 scene 1 | 6/6, 33 | 6/6, 0 | 6/6, 0 | 5/6, 1430 | 6/6, 0 |
| generated 30×30, 5 trains | 5/5, 0 | 5/5, 0 | 5/5, 0 | 5/5, 4 | 5/5, 0 |
| generated 36×24, 7 trains | 7/7, 0 | 4/7, 13 | **7/7, 0** | 2/7, 62 | **7/7, 0** |
| PF-CH wn–wal conflict | 3/3, 3 | 1/3, 150 | **3/3, 0** | 2/3, 221 | **3/3, 0** |
| PF-CH wn–wal long approach | 3/3, 0 | 3/3, 0 | 3/3, 0 | 3/3, 32 | 3/3, 0 |
| PF-CH corridor (16 trains) | 11/16, 185 | 1/16 | 2/16 | 1/16 | 0/16 |
| Olten (52 trains) | 52/52, 98 | 28/52 | 30/52 | 19/52 | 28/52 |
| **total** | **84/89** | 45/89 | **53/89** | 34/89 | 49/89 |

**Reading:**

1. A few minutes of PPO are enough to fix the small conflicts: both `ecml-ch`
   (trained on wn–wal) and `scratch-5` (never saw a PF-CH scenario) now solve
   the wn–wal conflict and the 7-train network without delay, where ECML
   deadlocked. `ecml-ch` keeps ECML scene 1 at 6/6.
2. The corridor and Olten stay out of reach. They have 16 and 52 trains and
   long single-track sections; the short runs never trained at that density.
   That is the next exercise (longer runs on the corridor), not a code change.
3. **HG-DAgger made the policy worse**, although it now agrees with the
   "human" 88 % of the time. DLA stops a train because of other trains' paths,
   which the 36 features only partly show; copied state by state, the stops
   become hesitation everywhere (scene 1 drops to 5/6). Only disagreements
   were logged, never the steps where the human let the AI drive, and 120
   lines from two scenarios is little. This is exactly what the lab is for:
   agreement with the human is not the same as better operation. For
   exercise 2, compare a higher `--kl-weight`, and the agreement on held-out
   interventions.
4. Not done in step 3: deadlock count and intervention rate per run in
   `evaluate.py`. The intervention rate needs a human in the loop, so it
   belongs to the lab review of step 4.

### Step 4 — make the collaboration visible (medium)

Small, mode-specific, built with the `create-widget` skill if it becomes a new
panel:

- **Recommendation:** the policy's action per train as the recommendation, with
  its action probability as confidence.
- **Co-learning:** the learned policy appears as **one neutral option** next to
  PP/CBS, unranked. Your choice is logged as a preference.
- **Director:** the learned policy executes and you intervene. Every
  intervention becomes training data for the next round.
- **Lab review after the session:**
  - intervention rate
  - how often you agreed with the AI
  - KPIs "with you" against "AI alone", forked from the same step
  - the comparison with the previous checkpoint

## Exercises (what "practising" means)

1. **AI alone vs. with you:** play the same scenario once without intervening
   and once intervening. Compare the review.
2. **Correct and retrain:** make 20–30 overrides in director mode, run
   `finetune_interventions.py`, play again. Does the intervention rate drop? Do
   the KPIs get worse?
3. **Train from scratch:** a small network (5–7 trains), PPO for 30–60 min on
   the Mac. Watch the learning curve, then try the agent in all three modes.
4. **Neutral or recommended:** the same options in recommendation and in
   co-learning. Do you decide differently?

## Out of scope

- Per-agent policies (brief §4.4: policy stays global per session).
- Online learning during a session. Training only runs between sessions,
  traceably.
- Changes to the PP/CBS layer or to the Director planner.
- A study setting. The lab is a practice tool, not a WP4 measurement.

## Open questions

- Does the ECML observation generalise to our scenarios? This is answered by
  measuring in step 1.
- Should the lab sessions show up in the start screen as their own "Lab"
  entry, or only in Session Settings?
- Hugging Face: a Space with a GPU or HF Jobs for longer runs? Only once local
  runs are no longer enough.
