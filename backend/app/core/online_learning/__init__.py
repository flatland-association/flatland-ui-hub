"""Online PPO learning — docs/plans/online-ppo-learning.md.

A learning policy among equals: it runs in its own worker process, plays
Flatland itself, asks the other active policies what they would do, tests
candidate actions in forks and keeps a new version only after an evaluation
against the last stable version and a baseline. The stable version is offered
in the hub as `lab:online-ppo`.

torch is imported only inside the learner (worker process and tests), so the
app still starts without it.
"""
