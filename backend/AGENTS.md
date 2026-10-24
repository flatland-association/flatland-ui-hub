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
pytest -q                                    # CI gate: unit + integration, in parallel (<2 min)
pytest -q -m "not integration"               # unit tests only, while iterating
pytest -q --run-slow -m slow                 # slow tier (nightly in CI)
pytest -q --run-training -m training         # full-scale training (nightly in CI)
pytest -q -n 0 tests/test_x.py::test_y       # serial, e.g. under a debugger
```

Tests come in tiers ([plan](../docs/plans/backend-test-tiers.md)):

- **Unit** (no marker): pure logic, under 0.5 s.
- **`@pytest.mark.integration`**: the FastAPI app, a session, an env episode
  or the planner, under 10 s. A file that starts the app marks the whole
  module with `pytestmark = pytest.mark.integration`.
- **`@pytest.mark.slow`**: 10 s or more. Skipped unless `--run-slow`.
- **`@pytest.mark.training`**: full-scale model training. Skipped unless
  `--run-training`.

Mark a new test by what it does and how long it takes. CI prints the tests
over their tier's budget (`PYTEST_TIER_BUDGET=1`). Slow and training tests run
nightly on `explore_db` and `main`, not on PRs. If your change touches
training, data generation or the parallel planner, start CI by hand with
`backend_tests: slow` (Actions → CI → Run workflow) before you merge.

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
