# Synthetic dispatcher: measured results

Measured on 6 November 2026 on `explore_db` after the merge of `main` (`1695456`),
with Flatland 4.3.0 and seed 42. Reproduce with the batch commands in the
[guide](dispatcher-agents.md#batch-and-exports).

These are technical demonstrations. They establish neither scientific validity
nor correspondence to human behaviour, and the three Recommendation runs below
are not a performance comparison with the Director run.

## Runs

All runs use `pf-ch-wn-wal-long-approach` and finished with all three trains
arrived. Recommendation runs share the authored `strategy-e1-breakdown-weesen`
event; the Director run has no scripted disturbance.

| Mode | Profile | Planned / executed | Response ticks | Simulation steps | Summed arrival delay |
|---|---|---|---|---|---|
| Recommendation | Baseline | 1 / 1 | 0 | 81 | 24 |
| Recommendation | Delayed, delay 3 | 1 / 1 | 3 | 81 | 24 |
| Recommendation | Priority, train order 0, 2, 1 | 10 / 10 | 0 each | 77 | 34 |
| Director | Goal-Switch, `[1,1,1]` → `[5,1,1]` at tick 5 | 2 / 2 | 0 each | 82 | 42 |

Arrival delay is in simulation steps, against the original timetable.

- Baseline and Delayed select the same PP alternative. The delay holds the
  Recommendation environment, so it adds no operational train delay.
- Priority takes a different course without improving this delay measure.
- Goal-Switch: both directives appear in committed controller plans, which is one
  effective goal change (the initial directive does not count).

## Evidence

- [Comparison](examples/dispatcher-agents/comparison.json),
  [Baseline](examples/dispatcher-agents/baseline.json),
  [Delayed](examples/dispatcher-agents/delayed.json).
- [Variants](examples/dispatcher-agents/variants-comparison.json),
  [Priority](examples/dispatcher-agents/priority.json),
  [Goal-Switch](examples/dispatcher-agents/goal-switch.json).
- Prepared demos in the running app: [launch cards](examples/dispatcher-agents/launchers.png),
  [Recommendation planned](examples/dispatcher-agents/recommendation-planned.png) and
  [accepted](examples/dispatcher-agents/recommendation-confirmed.png),
  [Director confirmed in plan](examples/dispatcher-agents/director-confirmed.png).

Earlier revisions and their exports are in the git history (`bca2685`).

## Checks

| Check | Result |
|---|---|
| `dispatcher.spec.ts` | 7 passed, including UI-to-batch metric equality, pause, takeover and disconnect |
| `tests/test_dispatcher.py --run-slow` | 33 passed |
| Effect on other sessions during a Director run (Walensee) | longest answer 0.11 s, as with a human session |

## Limits

- Co-Learning is unsupported. Director needs the installed models and a scenario
  the planner can solve.
- Requests to the same session wait while it plans, so a takeover takes effect
  when the running plan is done.
- Runtime ownership lives in the single backend process. The timeline is not a
  full replay.
- French copy is a draft pending native review.
