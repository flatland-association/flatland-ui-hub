# backend/AGENTS.md

These rules apply on top of the root [`AGENTS.md`](../AGENTS.md) for anything
under `backend/`.

## Stack

- **FastAPI + Flatland-RL**, pinned in `requirements.txt`. The API modules are
  in `app/api/` (`sessions`, `hmi`, `operator`, `overrides`, `policies`,
  `websockets`).
- **Policies** are in `app/policies/`. Start from
  `templates/template_policy.py` and register the new policy in `registry.py`.
- **Planners** are in `app/planners/`: the vendored `blackbox` PP/CBS solver and `replan.py`.

## Commands

```bash
pip install -r requirements-dev.txt          # runtime deps + torch + pytest/ruff
uvicorn app.main:app --reload --port 8000    # API docs at http://localhost:8000/docs
pytest -q                                    # CI gate
pytest -q -m "not integration"               # fast subset while iterating
```

`ruff check` is not a CI gate yet, because of pre-existing findings. Don't
reformat files you aren't otherwise changing.

## Rules

- **New gating needs a test in `tests/`.** That covers anything that behaves
  differently per interaction mode or blocks or permits an action. Keep the
  existing tests green.
- **Prefer gating presentation in the frontend over reshaping payloads.** Add
  fields; don't rename or remove them without updating every consumer.
- **Policy is global per session.** Per-agent policy is a separate, planned
  change (brief §4.4).
- **Check the installed `flatland-rl` first.** It already provides trajectory
  forking, targeted malfunction injection and multi-objective rewards.
  Algorithms with a consortium reference implementation are integrated, not
  rewritten ([`docs/reference/ecosystem.md`](../docs/reference/ecosystem.md)).
- **Scenario and timetable data** follows the `flatland-scenarios` JSON keys
  from flatland-association, not the older drawing-board fork found in the
  AI4REALNET HMI repos.
