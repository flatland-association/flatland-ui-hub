# Online PPO learning — a learning policy among equals (branch Explore_online_learning)

> Dated plan, 2026-10-20. Status: **implemented and measured on the branch
> the same day** (see "Status" at the end). Builds on the MARL lab
> ([`marl-lab-plan.md`](marl-lab-plan.md), steps 1–4).

## Goal

A trainable PPO policy that keeps learning while the hub runs. It interacts
with Flatland itself, asks every other active policy what it would do,
tests candidate actions in forked simulations, and learns from the results,
including actions no policy proposed. A new version replaces the old one only
after it has been evaluated against the last stable version and a baseline.

**Constraints from the request:**

  policy picker like DLA or the learned PPO. Nothing in Recommendation or
  Director changes; it is not forced on any mode.

## What already exists and is reused

| Need | Exists | Where |
|---|---|---|
| Network, observation | ActorCritic 3×128, FastTreeObs (36 + mask) | `app/policies/learned/` |
| Policies to ask | the registry: DLA, Shortest Path, learned PPO, lab checkpoints | `app/policies/registry.py` |
| Forking a state | `copy.deepcopy(env)` (the Director uses it), `TrajectoryBranchRunner` | `app/core/scenario_runner.py` |
| Punctuality reward | Flatland's own step/episode reward (`DefaultRewards`) | installed flatland-rl |
| Safety metric | `count_deadlocked_agents` (operator definition) | `app/core/scenario_runner.py` |
| Shaped PPO reward | arrival, progress, time cost, not arrived | `lab/marl/train_ppo.py` (same constants) |
| Checkpoint → policy | every `lab/checkpoints/<name>.pt` is `lab:<name>` | `registry.py`, `lab_checkpoints.py` |
| User overrides | `POST /agent/{h}/override` with `mode` and `owner` | `api/overrides.py` |

## Data model — six separate buffers

All in `app/core/online_learning/buffers.py`, bounded (configurable size).

| Buffer | Holds | Used for |
|---|---|---|
| `ppo_rollout_buffer` | `RolloutStep`: obs, mask, action, log-prob, value, reward, done, policy version, episode, step, handle | **PPO loss only**. Accepts only steps the current learner version sampled itself; anything else raises `OffPolicyDataError`. Emptied when the version changes. |
| `multi_policy_prediction_buffer` | `PolicyPrediction`: policy id and version, obs, action, confidence, logits, value, mode, session, episode, step, handle, error | evaluation, ranking, distillation sources |
| `user_interaction_buffer` | `UserInteraction`: override / rejected suggestion / feedback, AI action, human action, mode, session, step, simulated outcome | human behaviour policy and feedback; never PPO |
| `counterfactual_evaluation_buffer` | `CounterfactualResult`: candidate action, who proposed it, fork step, horizon, reward components, score, feasible | choosing distillation targets; audit |
| `distillation_buffer` | `DistillationSample`: obs, mask, target action, source, score gap | auxiliary supervised loss (behaviour cloning on simulated-best actions) |
| `experience_count_buffer` | `ExperienceCountSample`: observation, action mask, cumulative `log1p` counts per action, source | auxiliary count-head ensemble loss; never PPO policy/value data |

**Off-policy rule.** Predictions of other policies and user actions never
enter the PPO loss. No importance sampling is implemented, so off-policy data
is used only for distillation, ranking and evaluation. The auxiliary loss is a
separate supervised term on the distillation buffer, weighted by
`distill_coef`.
The state-action count ensemble has a separate masked auxiliary loss and buffer.
It can learn from executed human/PPO actions and simulated candidate evaluations,
but those records never become on-policy PPO rewards.

**Not-executed actions** get no reward. They get a *simulated* score only when
a fork actually ran them (counterfactual buffer).

## Training flow (one worker step)

The learner runs in its own **worker process** (`multiprocessing`, spawn), on
its own background environments. The API process only starts, pauses,
resumes and stops it and reads its status file.

1. **Observe** the background env (FastTreeObs per train).
2. **Ask all active policies** (configurable, default DLA, Shortest Path,
   learned PPO) for their actions, in a thread pool. A policy that raises or
   returns nothing is recorded as a failed prediction and skipped.
3. **Learner action**: sampled from the current version (on-policy), with its
   log-prob and value.
4. **Candidates** at relevant steps (every `cf_every` steps, at most
   `cf_max_trains` trains that have a real choice): the learner's action, the
   other policies' actions, a user action if one is pending, the safe fallback
   (DLA), and **every other valid action**, so the learner can find a move
   nobody proposed. Each distinct action is run in a **fork**
   (`copy.deepcopy(env)`) for `cf_horizon` steps, with the learner's greedy
   policy driving the rest.
5. **Score** each fork with the multi-objective reward (below). The best
   candidate is chosen by that score, never by a policy's confidence. If it
   beats the learner's own action by `cf_margin`, it becomes a distillation
   sample.
6. **Execute** the learner's sampled action in the real background env
   (keeps the rollout on-policy), store the `RolloutStep`.
7. After `min_rollout_steps` decisions: **GAE** advantages and returns.
8. **PPO update**: epochs, minibatch, learning rate, advantage normalisation,
   entropy and value terms, gradient clipping, PPO clipping, plus the
   distillation term. **KL monitoring**: an epoch is cut short when the
   approximate KL exceeds `target_kl`.
   A three-member state-action count ensemble trains with independent bootstrap
   weights and a separate coefficient. Its samples never enter the PPO rollout
   buffer or reward calculation.
9. **New version** `v(n+1)` as a candidate. **Collapse check**: entropy below
   `collapse_entropy` or KL above `collapse_kl` → rejected without evaluation.
10. **Evaluate** on `eval_episodes` independent episodes (fixed seeds, greedy):
    the candidate, the last stable version and the baseline (DLA).
11. **Decide**, always against the last stable version (never the previous
    candidate, so drift stays bounded):
    - **better** than stable **and safe** → **accepted**: the new stable
      version, published. Safe (hard constraint) means no more deadlocks per
      episode than the stable version, or at least no more than the baseline
      (`safety_tolerance`);
    - **within `accept_tolerance`** of stable → **kept training**: learning
      goes on from these weights, the stable (published) version stays. Its
      score already counts deadlocks, and nothing is published;
12. **Otherwise roll back** to the last stable weights and optimizer state.

    (A first version accepted only clearly-not-worse candidates and rolled
    everything else back. Started from scratch, it never kept a single update:
    one PPO update rarely makes the greedy policy better at once, so the
    rollback threw every bit of progress away. Measured 2026-10-20: 19
    candidates in a row rolled back, all at 0 % arrivals. A second version
    also gated continued training on deadlocks; the scratch policy had 0.83
    deadlocks per episode and every candidate that drove more had 1.0, so it
    rolled back as well.)

Every update writes one line to the **audit log**; every version is a
checkpoint. The stable version is also written as
`lab/checkpoints/online-ppo.pt`, so the hub offers it as the policy
`lab:online-ppo` ("Online PPO (vN)"). Sessions running it pick up a new stable
version on their next step (the model cache is keyed by file time).
Each version checkpoint also saves the count-head weights and bounded
state/action counters, with executed and simulated sources kept separate.

## Multi-objective reward (counterfactual forks and evaluation)

Over a fork's horizon, per candidate (documented in `reward.py`):

| Component | Measure | Weight |
|---|---|---|
| punctuality | Flatland's own reward summed over the horizon | 0.01 per unit |
| arrivals | trains that reached their target | +1.0 each |
| delay | growth of the summed delay against `latest_arrival` | −0.02 per step |
| waiting | train-steps standing (STOPPED or ready but not departed) | −0.005 each |
| conflicts | trains blocked face to face at the end (`count_deadlocked_agents`) | safety |
| manual corrections | the candidate is a human override | −0.05 |

**Hard constraint:** a candidate that creates a deadlock that was not there at
the fork is infeasible; it is recorded, but can never be the best candidate
or a distillation target. This keeps the learner from trading safety for
punctuality (reward hacking).

The PPO rollout reward is the trainer's shaped reward (arrival +1 minus
lateness, progress, time cost, not arrived −0.5), so offline and online
training optimise the same thing.

## User interactions from the hub

When a hub session runs `lab:online-ppo` and the learner is running, an
override (`POST /agent/{h}/override`) also writes a **snapshot** of the env
into the learner's inbox, with the human action, the AI action, the mode and
the owner. The worker forks the snapshot, scores the human action, the AI
action and the other candidates, and stores the outcome in the
`user_interaction_buffer`. A human override counts as better only when its
fork scores better; only then it becomes a distillation sample (source
`user`). An override where human and AI differ is also recorded as a
rejected AI suggestion. Explicit feedback (`POST /lab/online/feedback`) is
recorded, but gives no reward by itself.

Nothing about how Recommendation, Co-learning or Director behave changes: the
hook only writes a file when the learner runs and the session already runs
the online policy.

## API (`app/api/lab.py`)

| Endpoint | Does |
|---|---|
| `GET /lab/online/status` | state, stable and candidate version, buffer sizes, rollout progress, version history with evaluations |
| `POST /lab/online/start` | start the worker (`init`: scratch, ecml or a lab checkpoint; optional config) |
| `POST /lab/online/pause` · `/resume` · `/stop` | control |
| `GET /lab/online/audit` | the audit log |
| `POST /lab/online/feedback` | explicit feedback on a decision |

## UI

A **Learning monitor** panel (`online-learning`, all modes, read and control):
state, the stable version ("Online PPO v7"), the candidate under evaluation,
rollout progress, the six buffer sizes, start / pause / resume / stop, and
the version history (accepted, rolled back, collapsed) with candidate vs
stable vs baseline scores. It shows the newest three rows and scrolls within
the history area for older versions, keeping the column headings visible.
When the stable version changes, the panel shows
"Policy updated to vN". Added to the MARL Lab layout preset.
The agent decision matrix also shows selected-action log-likelihood and
interpretation, entropy, the bounded `NumberOfSeenActions(s,a)` familiarity
percentage, and a sparse-data uncertainty marker.

The monitor also shows source counts from the bounded buffers: predictions by
policy ID, distillation targets by proposing source, and experience samples
split into executed and simulated. These are retained-buffer counts, not the
exact minibatch currently being optimized. PPO policy/value losses still use
only the learner's own on-policy rollout; policy proposals enter distillation
only when their forked candidate beats the learner's action by the configured
margin.

## Files

  `buffers.py`, `reward.py`, `candidates.py`, `learner.py`, `worker.py`,
  `manager.py`), `backend/tests/test_online_learning.py`,
  `frontend/src/app/features/online-learning/`.
  `app/policies/registry.py` (label from sidecar), `frontend` seams, models,
  API service, i18n, layout preset.

## Risks

  two threads. On a small laptop it still competes with the hub for cores.
  background envs are small generated networks by default.
  are not calibrated probabilities. Exact quantized-state counts and neural
  estimates generalized to similar states are labelled separately.
  under the learner's own greedy continuation (policy improvement), so early
  versions give noisy scores. The margin and the evaluation gate limit the
  damage; rollback undoes it.
  small samples.

## Tests (`tests/test_online_learning.py`)

Several active policies; predictions per step; a failing and a missing policy
prediction; candidate comparison with simulated reward including an
unproposed action; real vs simulated reward kept apart; the rollout buffer
refusing off-policy data and stale versions; an online update creating a new
version; bounded state/action count tracking, ensemble training and checkpoint
round-trip; evaluation against stable and baseline; accept and rollback; collapse
rejection; user overrides from all three modes, an override not counted as
better without a better fork; the worker process start, pause, resume, stop;
the API.

## Status 2026-10-20: implemented and measured

  reward, candidates, learner, worker, manager); endpoints in
  `app/api/lab.py`; override hook in `app/api/overrides.py`; registry label
  from the sidecar (`Online PPO (vN)`); frontend panel
  `features/online-learning/` in the MARL Lab preset, palette and widget
  catalog; `online.*` keys in en/de/fr (French needs a native review).
  data refused by the rollout buffer, six bounded buffers, parallel queries
  with a failing and a missing policy, an unknown policy, every active
  policy asked each step, candidates including unproposed actions and
  dropping invalid ones, best candidate by feasible score, forks leaving the
  env untouched, only executed learner actions as PPO samples, an update
  creating a version and an audit line, accept and publish, keep training,
  rollback to the stable weights, an unsafe version never published, a
  collapsed version rejected without evaluation, overrides from all three
  modes judged by their fork, feedback without reward, the override hook only
  for the online policy and human owners, the inbox processed, the worker
  process start/pause/resume/stop, the idle API.

**Proof that it learns** (defaults, from scratch, background networks
`gen:30x30:3:*`, evaluation on six fixed networks, baseline DLA = 100 %
arrived, score 1.0):

| Version | after | Decision | Score | Arrived |
|---|---|---|---|---|
| v0 | start | — | −0.064 | 0 % |
| v1 | 6 s | kept training | −0.075 | 0 % |
| v2 | 12 s | **accepted** | 0.338 | 39 % |
| v4 | 26 s | **accepted** | 0.866 | 89 % |
| v6 | 42 s | rolled back | 0.810 | 83 % |
| v11 | 79 s | rolled back | 0.643 | 67 % |
| v16 | 116 s | **accepted** | 0.9998 | **100 %**, 0 deadlocks |

14 158 environment steps, 109 distillation samples from forks, KL between
0.003 and 0.03 per update. The same run started from the hub panel gives the
same sequence (same seeds).

**Verified in the hub** (worktree build on port 8002):

- the panel starts the learner and shows state, rollout progress, the six
  buffers, the evaluation against DLA and the version history; the banner
  "Policy updated to v2" appears when a version is accepted;
- the picker offers "Online PPO (v4)" while it runs;
- a session step takes 8–18 ms (median 12 ms) while the learner trains;
- an override in Co-learning on a session running `lab:online-ppo`
  reached the learner, was forked and judged "worse" (human −0.48 against
  AI −0.425), so it did not become a training target.

**Addendum 2026-10-22: state-action experience metrics.** Online PPO v2 now
trains a three-head `NumberOfSeenActions(s,a)` estimator using a separate
masked auxiliary loss. Quantized exact counts and the estimator are versioned
in checkpoints; executed decisions and simulated candidate evaluations remain
separate sources. The decision matrix displays log-likelihood, interpretation,
entropy, familiarity percentage and count uncertainty. The uncertainty is a
documented heuristic, not a calibrated probability; see
[`online-ppo-state-action-experience.md`](online-ppo-state-action-experience.md).

**Addendum 2026-10-26: scenario coverage without discarding progress.**

Session creation already adds each preset or concrete generated scenario to
the persisted training pool. The worker samples from that growing pool; a
running worker applies additions at the next episode. The evaluation suite is
the fixed regression set plus the currently registered training scenarios.
When that suite changes, reevaluate the stable policy and DLA on the same suite
before comparing the next candidate, so scores remain comparable.

Keep the publication and training tracks separate. A non-collapsed candidate
continues training even when its score is more than `accept_tolerance` below
stable; it is not published. Publish only a candidate that is both safe and
strictly better than the stable policy on the shared suite. Roll back only a
collapsed candidate. This preserves the published v2 checkpoint while giving
the learner room to recover and generalize from newly encountered scenarios.

The Learning Monitor shows the active episode scenario and the registered
scenario pool alongside the existing version score history. Scores are
measured over the current suite and can move when a new scenario is added;
they are evidence of progress, not a guarantee of monotonic improvement.

**Limits:**

- the learner's own episodes are small generated networks; it does not
  train on the hub sessions' states (their actions are greedy and
  overridden, so not on-policy);
- one learner per backend; a restart of the backend stops it (the stable
  version stays published);
- forks continue under the learner's own greedy policy, so early candidate
  scores are noisy;
- matching DLA on 3-train networks is the easy case; the corridor and Olten
  are untested with this loop.

## Walensee tour with the time-distance diagram (2026-10-20)

**Tour** `walensee-online-learning` ("Walensee: an AI that learns while you
watch", en/de), on the PF-CH single-track conflict, layout
`preset-online-learning-zwl` (ZWL Ziegelbrücke → Walenstadt as the first
tab with decision pills, Learning Monitor and train detail on the right).

- **The briefing sets the learner** (`TourBriefing.onlineLearning`): start
  from the ECML PPO, practise `pf-ch-wn-wal-conflict`, evaluate on the
  conflict and the long approach (so a version that memorises the conflict
  and forgets the approach is not taken for better), 1024 decisions per
  update, learning rate 1e-4. Outside a tour the panel offers "learn on this
  scenario" (evaluated on it plus two generated networks) or "generated
  networks".
- **Guide** (ticks itself from the learner's status, via the shared
  `OnlineLearningService`): start the learner → a version is accepted →
  drive with "Online PPO (vN)" → watch it in the ZWL (20 steps under the
  policy) → step in.
- **A policy that appears during a session**: the enabled policy set is
  fixed at session start, so `ensure_policy_enabled` admits a lab
  checkpoint on first use, and the frontend adds it to the picker when the
  learner publishes (`SessionStore.adoptPolicy`). Only `lab:` checkpoints;
  hidden built-ins stay refused (tested).
- **View tabs** take a layout `defaultTab`, ahead of the mode's default view,
  so this layout opens on the ZWL without changing Recommendation.
- **Guide closing line** without a debrief no longer promises one.

**Measured on Walensee** (from ECML, which gets 1 of 3 through the conflict;
DLA: 3/3 with 3 steps of delay, score 0.9995):

| Version | after | Decision | Conflict | Long approach |
|---|---|---|---|---|
| v0 | start | — | 1/3, 150 late | 3/3 |
| v1 | 4 s | kept training | 1/3 | 3/3 |
| v2 | 11 s | **accepted** (score 1.0) | **3/3, 0 late** | 3/3, 0 late |

**Played through in the hub** (port 8002): tour picker → mode intro → ZWL
open; "Start learning" → "Policy updated to v2" after 12 s, picker offers
"Online PPO (v2)"; under it all three trains arrive at step 44 with no delay;
v3 and v4 (0 % arrivals) rolled back by the gate while v2 stayed stable; an
override (STOP instead of forward, Recommendation) judged "worse" in its fork
(−0.055 against 0) and not learned from; all five guide steps ticked.

## Addendum 2026-10-23: persistent always-on learning and source controls

The online learner is a backend-wide service, not an experiment control. On
backend startup it starts automatically when PyTorch is available. It resumes
from the last published `lab:online-ppo` checkpoint, or starts from scratch
when no checkpoint exists. Shutdown/reload stops the worker cleanly; the next
startup starts a new run from the last stable checkpoint. Run audit/version
directories remain intact. The only user-facing training action is a confirmed
**Reset to scratch**, which starts a new run from fresh weights without
clearing the stored source preferences or scenario curriculum.

The Learning Monitor exposes global settings persisted by the backend and
reused by every later experiment and run:

- the existing comparison-policy sources (DLA, Shortest Path, learned PPO),
- user interactions/feedback (only eligible `lab:online-ppo` session
  overrides, as today),
- counterfactual fork evaluation,
- distillation targets, and
- the experience estimator.

All sources are enabled by default. Each can be turned off and back on without
restarting the learner. The PPO rollout itself is always enabled and remains
strictly on-policy; the UI explains this rather than offering a switch that
would stop PPO learning. Human and other-policy actions are only used by their
existing counterfactual, distillation, and experience paths; they never enter
the PPO policy/value loss.

Every successfully created preset or standard generated experiment contributes
its scenario spec to the shared background curriculum. The learner picks from
that persistent curriculum at episode boundaries, including while it is
already running. It does not import arbitrary experiment trajectories as PPO
rollouts. Source controls and the accumulated curriculum are stored under the
online learner data root, independently of a browser and of individual
sessions.

Acceptance criteria:

1. A backend with PyTorch starts one online learner automatically; a restart
   resumes from the published stable checkpoint, and missing PyTorch is
   reported in monitor status without preventing the API from starting.
2. The monitor has no ordinary start/pause/stop workflow; it shows persistent
   source controls (all on initially) and one confirmed Reset to scratch
   action.
3. Source changes are persisted, take effect in a running worker, and remain
   unchanged across reset, backend restart, and new experiments.
4. Disabling a source prevents new samples from that source and excludes its
   auxiliary samples from updates, while enabled sources continue contributing
   to their designated loss/buffer. PPO policy/value updates remain on-policy.
5. Created preset and standard generated scenarios are added to the curriculum
   and become eligible for subsequent background episodes. Audit data from
   earlier runs is not deleted by reset.
6. Backend tests cover source persistence/live application, scenario
   accumulation, autostart/resume/reset, and the off-policy guard; frontend
   tests cover source controls and reset confirmation.

## Addendum 2026-10-23: global learning settings and comparison policies

Learning source settings are also available in a dedicated **Learning** tab in
Session Settings, while remaining available in the Learning Monitor. Both
surfaces edit the same backend-persisted settings, which apply across
experiments and backend restarts.

The comparison-policy source is selectable per policy (DLA, Shortest Path, and
learned PPO). This selection controls which policy suggestions can contribute
to Online PPO's learning data only; it does not change which recommendations
are shown in an active session. The other source labels and explanations use
plain language, describe what the learner actually uses, and state that its
own on-policy PPO rollouts remain enabled.

Acceptance criteria:

1. Session Settings has a global Learning tab available during an active
   session, with source controls shared with the Learning Monitor.
2. Each comparison policy can be enabled or disabled independently; changes
   persist and take effect in the running learner without a restart.
3. The selected comparison policies affect only Online PPO learning inputs, not
   recommendations displayed to the user in a session.
4. Learning-source labels and help text plainly explain the data used, and
   clearly state that PPO always learns from its own on-policy actions.
