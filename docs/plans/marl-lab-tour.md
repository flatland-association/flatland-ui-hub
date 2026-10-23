# MARL lab tour — experience the loop, and train at the end

> Dated plan, 2026-10-19. Status: **built 2026-10-23 — variant A, as two
> tours (`marl-lab-colearning`, `marl-lab-director`); see "Decisions" and
> "Built".** Builds on
> [`marl-lab-plan.md`](marl-lab-plan.md) (steps 1–4 done) and the tour system
> (`core/demo/tours.ts`, `tour-briefings.ts`, `tour-guide.service.ts`,
> `features/tour-debrief`).

## Goal

A guided tour in which a person goes through the whole lab loop once, with no
terminal:

```
  watch the AI  →  step in  →  see what it changed  →  train the AI on it  →  play again with your model
```

Today every piece exists, but only in separate places: the learned policy in
the picker, the AI's pick in the agent inspector, the AI Track Record in a
custom layout, training on the command line. The tour puts them in order, in a
layout that has all of them, and adds the one missing piece: **training from
the browser**.

## What we already know (measured 2026-10-19)

Scenario PF-CH wn–wal single-track conflict, ECML policy:

- **AI alone:** 1/3 trains arrive, 2 deadlocks.
- **One override** (train RE_18 turns left at the WN switch, step 12): 3/3
  arrive (AI Track Record, "with you" against "AI alone").
- **Fine-tune on that single intervention** (HG-DAgger, 200 epochs, 2048
  rollout states of the same scenario) takes **2.5–5 s**:

| KL weight | wn–wal conflict | long approach | ECML scene 1 | gen 36×24, 7 trains | total |
|---|---|---|---|---|---|
| ECML (before) | 1/3 | 3/3 | 6/6 | 4/7 | 14/19 |
| 1 (forgets more) | **0/3** | **1/3** | 6/6 | 5/7 | 12/19 |
| 3 (stays closer) | **3/3** | 3/3 | 6/6 | 5/7 | **17/19** |

The second row is the most valuable moment of the tour: the same single
correction either teaches the AI or breaks it, depending on one knob, and the
person can see both. The tour should let them turn that knob.

## Variants

### A — "Correct and retrain" (recommended, ~15 min)

One scenario (wn–wal conflict), three legs, training in between.

1. **Opening page:** the loop, what a learned policy is, what will happen.
2. **Leg 1 · "The AI alone"** (Director, learned policy, about 1 min). The
   person only watches; the run ends in the deadlock. The guide strip says
   where to look. *Optional:* leg 2's comparison also shows "AI alone", so
   this leg is for the experience, not for the numbers.
3. **Leg 2 · "With you"** (Recommendation). At the WN switch the inspector
   marks the AI's pick ("Forward · AI 100 %"). The guide asks the person to
   pick the train and decide. The AI Track Record shows the result: with you
   3/3, AI alone 1/3.
4. **Debrief · "Train the AI"** (new section):
   - The interventions of leg 2, as a short list: train, AI's pick, your pick.
   - One choice in plain words: *"How much should the AI stay as it was?"*
     (little / medium / a lot = KL weight 1 / 3 / 10), preset to medium.
   - **Train** (about 5 s), then right away **a short check**: your model alone
     against the ECML model alone on this scenario and two it never saw (long
     approach, ECML scene 1). That is the table above, built live.
   - Train again with another setting; each run is kept and named.
5. **Leg 3 · "Your model"** (Recommendation or Director, the person's
   choice). The same scenario under `lab:<your model>`. Does it take the switch
   by itself now? The AI Track Record counts how often you still had to step
   in.
6. **Closing page:** what happened (HG-DAgger, why the knob matters, why
   agreement is not the same as better operation), and the commands for going
   further on the command line.

### B — "Train from scratch" (~10 min)

A small PPO run in the browser (`gen:30x30:5:*`, about 2–3 min), with the
learning curve drawn live from the CSV rows (arrival rate per iteration).
Then one leg with the new model on a network of that size. Shows *how* an RL
policy comes about, rather than how a human corrects it. Needs everything A
needs for training, plus a background job with progress and a chart.

### C — "Three modes, one AI" (~12 min)

No training. The same learned policy in Recommendation, Co-Learning and
Director on the same conflict: marked, neutral, autonomous. The track
record's wording changes with the mode. The smallest variant: tour data,
briefing pages, a layout preset and the tour policy field.

**Recommendation:** build A first. It contains C's mode differences in a
small form and uses training where it is cheapest (seconds). B can follow on
the same training endpoint.

## What A needs

| Piece | Exists | To build |
|---|---|---|
| Learned policy, AI pick in the inspector, AI Track Record | ✓ step 4 | |
| Fine-tune on interventions (`finetune_interventions.py`) | ✓ CLI | callable on **one session's** lines, with a name and a KL weight |
| Training from the browser | | `POST /session/{id}/lab/train` → job; `GET /lab/jobs/{job}` for status and result |
| Short check after training | ✓ `evaluate.py` logic | `run()` on 3 scenarios, inside the job, result as rows |
| Policy pinned by the tour | | `Tour.policy` and per leg `legPolicies`, with the sentinel `@trained` (the model trained in this run of the tour) |
| Director keeps the tour's policy | rule exists ("a policy picked while in Director wins") | the tour applies its policy after entering the mode |
| Layout with map, trains, inspector, track record | | preset `preset-marl-lab` |
| Guide steps | strip and ticking exist | new step ids: `watch-ai`, `ai-pick`, `intervene`, `compare`, `train`, `replay`, each with a rule in `tour-guide.service.ts` |
| Debrief section "Train the AI" | debrief with sections exists | new section `lab-train` (component), listed in `debriefSections` |
| Tour pages | briefing format exists | German and English briefing (authored text, as the other tours) |
| E2E | setup matrix exists | one tour test (`e2e-tests` skill) |

### Training endpoint (backend)

- `POST /session/{id}/lab/train {"klWeight": 3}` starts a fine-tune on the
  human lines of **this** session, from the policy the session ran
  (`learned_ppo` → the ECML checkpoint, `lab:<x>` → that file). Name:
  `tour-<session>-<n>`. Runs in a worker thread, one job per session at a time.
- The job ends with the short check (three scenarios, the new model and its
  base, greedy, about 2 s) and writes the checkpoint plus sidecar like the CLI.
- `GET /lab/jobs/{job}` → `{state, agreementBefore, agreementAfter,
  changedShare, check: [...], policyId}`.
- **Gating:** only where torch is installed and the checkpoints dir is
  writable, and `MARL_LAB_TRAINING` is not `0`. The Hugging Face Space sets
  it to `0` until we decide otherwise: a shared public Space should not let
  visitors write models. The section then explains this and shows the CLI.
- Seeded, so the same interventions with the same knob give the same model.

### Tests

- Backend: the endpoint trains only on the given session's human lines; the
  gating; the result shape; a tiny run (few epochs).
- E2E: the tour runs through to the debrief, the training section trains and
  shows the check, leg 3 runs under the new `lab:` policy.

## Effort

Variant A: **M–L**. Roughly: backend endpoint and job (S–M), tour policy
field and Director handling (S), layout preset and guide steps (S),
debrief section (M), briefing texts de/en (S–M), E2E (S).

## Decisions (2026-10-23)

The open questions, answered by the maintainer:

1. **Who is it for?** Others too: the SBB team, the consortium, interviewees.
   The pages explain policy, intervention and the KL knob in plain words and
   assume no RL background.
2. **Variant A, leg 1 kept.** Watch → step in → train → replay. Leg 1 is the
   experience of the deadlock, not the numbers.
3. **Mode: two tours, the whole loop per mode** (changed from "leg 3 fixed or
   the person's choice"). The idea is Co-Learning, so the loop is built once
   for **Co-Learning** (`marl-lab-colearning`: the inspector stays neutral, the
   person steps in on their own judgement, the track record says "chose the
   same") and once for **Director** (`marl-lab-director`: the AI drives
   autonomously under the learned policy, the inspector says what it will take,
   the person overrides as supervisor, the track record counts "took over").
   All three legs of a tour run in its mode. Training and the check are shared.
4. **Languages:** German (Swiss spelling, informal *du*) and English. The tour
   pages are authored text per language like the other tours
   (`tour-briefings.ts`); the debrief section, guide-strip chrome and errors
   are i18n keys.
5. **KL default:** medium = 3 (measured 17/19). Little = 1 and a lot = 10 stay
   selectable.
6. **Hugging Face Space: training on**, with checkpoints in a temporary
   directory that is wiped on restart (`MARL_LAB_CHECKPOINTS_DIR=/tmp/...` in
   the Space image). `MARL_LAB_TRAINING=0` still switches it off anywhere.
7. **Clean-up:** tour checkpoints (`tour-*.pt`) are hidden from the policy
   picker (only the tour that trained one asks for it by id) and pruned after
   24 h when a new tour job starts. Both are configurable for later:
   `MARL_LAB_TOUR_CHECKPOINTS=visible` lists them in the picker,
   `MARL_LAB_TOUR_TTL_HOURS` sets the age (0 keeps them).

## Built (2026-10-23)

| Piece | Where |
|---|---|
| Training job, gating, prune | `backend/app/core/lab_training.py`; routes in `app/api/lab.py`: `GET/POST /session/{id}/lab/train`, `GET /lab/jobs/{job}` |
| Fine-tune callable on loaded lines | `lab/marl/finetune_interventions.py` `finetune_on_lines` (the CLI calls it too) |
| Hidden tour checkpoints, asked for by id | `lab_checkpoints.is_tour_checkpoint`, `registry.selectable_policy_ids` |
| `Tour.policy`, `legPolicies`, `TRAINED_POLICY` | `core/demo/tours.ts`; applied in `SessionStore.newSession({ policy })`, which wins over the plan and over Director's planner |
| One guide over three legs | `TourGuideStep.leg`, `TourGuideService` |
| Debrief per leg, section `lab-train` | `TourBriefing.legDebriefSections`, `features/lab-train/` |
| Pages EN/DE | `core/demo/marl-lab-briefings.ts` |
| Layouts | `preset-marl-lab` (Co-Learning), `preset-marl-lab-director` (the same without the train list, which Director does not offer) |
| Tests | `backend/tests/test_lab_training.py`; E2E `e2e/tours.spec.ts` › "MARL lab tour" |

Measured in the browser (Co-Learning build, one override: the train at the
Weesen switch takes the right-hand track): AI alone 1/3, with you 3/3. Trained
with "medium" (KL 3): 3/3 on the conflict, 3/3 long approach, 6/6 ECML scene 1
(12/12). With "a little" (KL 1): the conflict is solved too, but ECML scene 1
drops to 4/6 — so the knob still shows its point, though not exactly as in the
2026-10-19 table (different rollout scenario and seed). Run 3 under the medium
model: 3/3 with no intervention. Training plus check takes about 5 s on a Mac.

**Run 3 adds a breakdown** (follow-up 2026-10-23, agreed with the user):
`legDisturbanceIds: [[], [], ['w1-door-fault']]`. In it, W1 (the train from
Walenstadt) stands for 8 steps in the single-track section, the section the
person corrected. Runs 1 and 2 stay undisturbed, and `malfunction_rate` stays 0. Run 3 is therefore
not like-for-like with run 2, and its page and guide step say so. No surface
compares runs 2 and 3 directly: the debrief's check runs the clean scenarios,
the AI Track Record compares within one run, and run 3 ends in the shift
summary. Measured, greedy, no human input:

| `pf-ch-wn-wal-conflict` | ECML alone | Trained, KL 3 (one Weesen intervention) |
|---|---|---|
| no disturbance | 1/3 | 3/3, all through by step 43 |
| `w1-door-fault` | **0/3** | **3/3**, all through by step 72 |

For comparison: the ECML policy with the same Weesen override plus W1 gets
1/3, so the trained model copes with more than the single correction it was
shown. `e1-station-hold` was rejected: it fires at step 44, after the trained
model has brought every train home (step 43), so it would never show.

Settings: `MARL_LAB_TRAINING=0` (off), `MARL_LAB_CHECKPOINTS_DIR`,
`MARL_LAB_RUNS_DIR`, `MARL_LAB_TOUR_CHECKPOINTS=visible`,
`MARL_LAB_TOUR_TTL_HOURS` (default 24, 0 keeps).

## Open questions (resolved, kept for the record)

1. **Who is it for?** You, to practise; or also others (the SBB team, the
   consortium, interviewees)? That decides how much the pages explain.
2. **Leg 1 "AI alone"**: keep it for the experience, or let leg 2's
   comparison carry it (saves a minute)?
3. **Leg 3 mode:** fixed (Director: "now it drives alone") or the person's
   choice?
4. **Languages:** German and English, as the other tours?
5. **Hugging Face Space:** training off (as proposed), or on with checkpoints
   in a temporary directory that is wiped on restart?
6. **Clean-up:** tour checkpoints (`tour-*.pt`) pile up in
   `lab/checkpoints/`. Hide them from the picker outside their own tour, or
   delete them after a day?
