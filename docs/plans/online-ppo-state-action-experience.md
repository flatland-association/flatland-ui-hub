# Online PPO v2: state-action experience estimator

## Goal

Extend Online PPO v2 with an auxiliary neural estimator for
`NumberOfSeenActions(s, a)`, show action-distribution entropy, and expose both
metrics in the existing per-agent decision matrix. The estimator measures
experience/familiarity, not action quality or probability of success.

## State-action counting

- A state key is the 36-dimensional FastTreeObs rounded to 0.01 plus its
  five-action validity mask. The mask is part of the key because the same
  observation with different available actions is a different decision state.
- Keep a bounded exact counter per quantized state and raw action. Keep
  executed observations (PPO and human-selected actions) distinct from
  counterfactual simulator evaluations. The count head is trained against the
  combined exposure count; the source split remains available for explanation.
- Counterfactual candidates count as simulated exposure, not as executed PPO
  actions. They never enter the PPO policy-gradient or value losses.
- The counter is bounded by configuration and saved with each PPO checkpoint.
  Older checkpoints load without count data and keep the estimator unavailable
  until it has trained.

## Neural estimator and training

Add a three-member action-count head ensemble to the shared ActorCritic trunk.
Each head predicts `log1p(NumberOfSeenActions(s, a))` for each of the five raw
actions. Train the heads with masked Smooth L1 auxiliary losses and independent
bootstrap samples from the exact counter targets. The ensemble mean estimates
the count; its spread is an uncertainty signal. The ensemble uses its own
coefficient and experience buffer; logged human/simulator data is not inserted
into PPO's on-policy rollout buffer. Existing PPO outputs and action selection
remain unchanged. The normal candidate acceptance and rollback gate also
evaluates versions with this ensemble.

At inference, use an exact quantized counter value when available. For an
unseen quantized state, use the trained head's non-negative estimate to
generalize from similar observations. Convert the selected option's estimate
`n` to a bounded familiarity percentage with `100 * n / (n + 10)`: zero means
no estimated exposure, 10 estimated visits means 50%, and the score approaches
100% as exposure grows. Keep the hover text short and plain: identify exact
counts versus a network estimate, show executed versus simulated totals when
counts are exact, and state that familiarity is not action quality.

Report count uncertainty per selected HMI option as a bounded percentage:
`100 * min(1, max(1/sqrt(n+1), sigma/(n+1)))`, where `n` is the exact count or
ensemble mean and `sigma` is the ensemble standard deviation after folding raw
actions onto the HMI option. Low counts therefore remain visibly uncertain,
even if ensemble members agree. At 50% and above, label the estimate as having
few observations; below 20%, label it as lower uncertainty. This is an
uncertainty heuristic, not a calibrated probability. Exact counts describe the
quantized key; the ensemble spread describes model disagreement.

## Decision matrix

- Log-likelihood: `ln(pi(a_selected | s))`, using the selected HMI option's
  probability. Its interpretation compares that probability with a uniform
  choice among currently available options. The tooltip shows the probability
  and log-likelihood in one short sentence.
- Entropy: `-sum(p * ln(p))` over available HMI options, in nats. The tooltip
  briefly says that higher values spread probability across more actions.
- Experience: the selected HMI option's `NumberOfSeenActions(s,a)` familiarity
  percentage. Raw-action estimates are folded onto HMI options consistently
  with the existing probability mapping.
- Count uncertainty: the selected option's bounded uncertainty percentage,
  with a visible sparse-data marker at 50% or higher and a short tooltip saying
  that high values mean few observations or model disagreement, not a precise
  probability.
- Preserve the existing Q-value and advantage columns.

## Compatibility and verification

- Keep `ActorCritic.forward()`'s existing two-value API. Add a separate
  experience-aware forward method so current policy consumers do not break.
- Accept legacy checkpoints that lack the new head; do not mark their
  estimator ready until an online update has trained it.
- Add backend tests for quantized counts, source separation, bounded storage,
  auxiliary training, checkpoint round-trip and legacy loading; extend the
  lab-choice API test for estimator values. Add a focused frontend test for
  entropy, log-likelihood and experience presentation/tooltips.
- Run the focused backend tests, frontend i18n/style checks and production
  build. Run the narrow E2E coverage for the matrix if the existing setup can
  reach the online PPO evaluator without adding unrelated fixtures.
