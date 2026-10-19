# MARL lab — practise human-AI collaboration with a learned multi-agent policy

> Dated plan, 2026-10-18. Status: **step 1 done (2026-10-18), steps 2–4 open.** Background:
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
