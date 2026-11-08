# Agent Inspector: decision-support view

## Goal

Make each agent's recommendation, expected effect, estimate reliability and
experience understandable at a glance. Keep the current agent groups and
action-override workflow; replace the wide metric matrix with one collapsed
summary row per agent.

## Presentation

- The collapsed row shows only the agent, preferred action, expected-effect
  band, estimate-reliability band, experience band with an approximate
  observation count, and a short rationale. It contains no bars or confidence
  percentage.
- Opening a row shows the rationale, overall assessment and caution reasons,
  decision-quality metrics, recommendation margin, and probability-sorted
  action cards. Each action card keeps expected effect visually separate from
  policy preference.
- A second, initially collapsed expert section exposes action probability,
  advantage, Q, V, Q−V, entropy, log-likelihood, action experience and count
  uncertainty, plus their definitions.
- All labels and explanations use EN/DE/FR translations. Reliability and
  experience bars are indices, not success probabilities or quality
  guarantees.

## Metric semantics

- Action preference is the normalized probability mass of each available
  option. Decision confidence is the normalized gap between the top two
  options; recommendation margin is their absolute percentage-point gap.
  Copy must state that confidence measures preference clarity, not the chance
  of success.
- Estimate reliability is the uncalibrated mean of the familiarity index, inverse
  count uncertainty, normalized entropy clarity, the top-two probability gap,
  and the absolute Advantage magnitude (capped at 0.20). Missing inputs keep
  the value unavailable.
- Experience uses the existing familiarity index `100 * n / (n + 10)` and
  shows the raw approximate observation count in the overview and detail view.
- Expected effect is each action's Q−V, with operator-facing bands at -0.20,
  -0.05, +0.05 and +0.20. Expert details retain Q, V and Advantage.
- Expert definitions match the backend estimator: Q is shaped immediate
  reward plus `0.99 *` future value; Advantage is Q−V; log-likelihood is the
  natural log of option probability; entropy is over the available options.

## Verification

- Unit tests cover action ordering, metric bands, forecast quality, missing
  data and expert values.
- The existing guided-tour E2E setup checks that agent summaries start
  collapsed and expert details remain collapsed until requested.
- Run the focused Inspector tests, E2E tour check, i18n/style checks and
  production build; verify the open details in the running app.