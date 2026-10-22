# backend/AGENTS.md

These rules apply on top of the root [`AGENTS.md`](../AGENTS.md) for anything
under `backend/`.

## Stack

- **FastAPI + Flatland-RL**, pinned in `requirements.txt`. The API modules are
  in `app/api/`.
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
- **EnvAgent attribute access goes through `agent_compat.py`.** flatland-rl
  4.3.0 removed `.position`/`.direction`/`.target`/`.old_position`/
  `.old_direction`/`.initial_position`/`.initial_direction`; read them through
  `app/utils/agent_compat.py`'s helpers, never directly. A missed call site
  silently returns `None` or raises `AttributeError`.
- **`agent.targets` can hold more than the planned stop.** Under
  `flexible_terminus`, a train's `targets` can include a second platform so a
  rerouted train still counts as arrived. Use `agent_planned_target` for
  "where is this train scheduled to stop" and `agent_target_positions` only
  for "is this an acceptable arrival cell" — picking an arbitrary member of
  `targets` for the former silently targets the wrong platform (issue #92).
