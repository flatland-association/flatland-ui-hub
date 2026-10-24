# Plan — backend test tiers: unit, per-commit, CI-only

> **Status:** 2026-10-23 — proposal, nothing built. Measured on `main` @ `2f4dbcb`.
> Decisions 2026-10-23: nightly full-scale run as the post-merge line of
> defence; no pre-commit hook; CI can be started by hand with the slow tier.

## Why

`pytest -q` runs 540 tests. It takes **22 min in CI** (the `Test` step; the job
is 26 min with setup) and **49 min locally** (8-core linuxkit, Python 3.13).
Nobody runs that before a commit, so in practice the suite only runs in CI.

## What the time is made of (measured)

`pytest --durations=0 --junitxml`, full suite, local:

| per-test time | tests | total time | share |
|---|---:|---:|---:|
| < 0.3 s | 389 | 19 s | 0.7 % |
| 0.3 s – 10 s | 131 | 269 s | 9 % |
| ≥ 10 s | **20** | **2 577 s** | **90 %** |

The suite is fast almost everywhere. A handful of tests account for most of the time:

| test | time |
|---|---:|
| `test_goal_based_connection_model::test_training_beats_predicting_the_base_rate` | 954 s |
| `test_goal_based_evaluator::test_training_fits_the_data_it_is_given` | 666 s |
| `test_goal_based_connection_model::test_block_training_resumes_and_keeps_the_best` | 231 s |
| `test_goal_based_evaluator::test_block_training_resumes_…` / `test_resuming_on_different_data_is_refused` / `test_unseen_layouts_can_be_scored` / `test_generated_samples_vary_…` | 108 / 104 / 76 / 70 s |
| `test_director_parallel_strategies::test_parallel_and_sequential_plan_the_same_options` | 79 s |
| `test_goal_based_replan::test_splicing_the_continue_candidate_is_timing_neutral` | 55 s |
| `test_reroute::test_another_action_or_keeping_the_plan_drops_the_route` | 53 s |
| `test_director_step0_cache::test_the_second_run_…` | 32 s |
| 9 more (evaluator data generation, MCTS, `test_director_strategies_api` cache tests) | 10 – 24 s each |

Two training tests are **56 % of the whole suite** by themselves.

Other findings:

- **Collection** takes about 5 s warm and 41 s cold. About 3–4 s of that is `import torch`, which
  8 `test_goal_based_*` / `test_director_step0_cache` modules pull in at import time.
- `user` time is 148 min against 56 min wall. Torch already runs multi-threaded,
  so naive parallelism will oversubscribe the CPU (see step 3).
- The existing `integration` marker (26 uses) does not match its own definition
  in `pytest.ini` ("instantiate the FastAPI app / Flatland session"). It is used
  on torch/data-generation tests (some take 0.1 s) while the slow API tests
  (`test_director_*_api`) are unmarked. Nothing selects on it today.
- `pyproject.toml [tool.pytest.ini_options]` (`asyncio_mode`, `testpaths`) is
  **dead config**: pytest uses `pytest.ini` when both exist. There are no async
  tests, so nothing is broken, but the settings should be merged into one file.
- In CI, setup takes about 3.5 min (cache restore 2 min, `pip install` 1.5 min). The
  default `torch` wheel on Linux is the CUDA build.
- Unrelated: `test_goal_directed_policy::test_a_malfunction_triggers_a_residual_replan`
  fails locally ("Episode is done, cannot call step()") but passes in CI (3.12).
  This needs a separate issue.

## Tiers

| tier | selected by | what belongs there | budget per test | tier budget | runs |
|---|---|---|---|---|---|
| **unit** | unmarked | pure logic: no FastAPI app, no session, no full episode, no torch training | < 0.5 s | **< 15 s** wall incl. collection | constantly while developing |
| **integration** | `@pytest.mark.integration` | `TestClient`, `SessionStore`, env episodes, planner/Director calls, small torch inference | < 10 s | **< 2 min** wall for unit + integration | **every commit**, default `pytest` |
| **slow** | `@pytest.mark.slow` | training, dataset generation, parallel-vs-sequential equivalence, anything ≥ 10 s | — | ≤ ~10 min after step 4 | nightly, or by hand (`--run-slow`) |

Estimated from the measurements, with `-n auto` on 4 cores: unit ≈ 5 s collect
+ 5 s run. Integration ≈ 269 s / 4 ≈ 70 s, with the longest single test about
8 s. Both fit their budgets.

### Commands

```bash
cd backend && pytest -m "not integration"   # unit only, seconds
cd backend && pytest                        # unit + integration — the per-commit tier (<2 min)
cd backend && pytest --run-slow             # everything (CI)
cd backend && pytest --run-slow -m slow     # only the slow tier
```

Two choices here:

- **The default `pytest` is the per-commit tier.** `AGENTS.md`, `CONTRIBUTING.md`
  and every agent already run `pytest -q`. They get the useful tier without
  learning anything new.
- **`slow` is skipped through a `--run-slow` option, not deselected with
  `addopts = -m "not slow"`.** This is the standard pytest recipe
  (`pytest_addoption` and `pytest_collection_modifyitems` in `conftest.py`). Skipped tests
  show up as `s` in the summary, so nobody forgets they exist, and `-m`
  stays free for the user. With `addopts -m`, a second `-m` silently replaces it.

Why markers and not directories (`tests/unit/`, `tests/integration/`):
about 10 files mix tiers (evaluator, connection_model, search, replan, reroute,
the `director_*_api` files). Splitting them would break `git blame` and the file
↔ module pairing. Markers can be set per file (`pytestmark = …`) where a file is
uniform, and per test where it is mixed.

## Steps

### 1. Markers and the skip mechanism (small PR)

- Merge `pyproject.toml [tool.pytest.ini_options]` into `pytest.ini` and delete
  the dead block.
- Redefine the markers:
  - `integration`: app, session, env episode or planner; under 10 s
  - `slow`: 10 s or more, or training; CI only
- Add `--run-slow` to `tests/conftest.py`.
- Add `pytest-xdist` to `requirements-dev.txt`.

### 2. Classify all 540 tests (one PR, mechanical)

Drive it from the junit timings, not from guesses. Commit the classification
script under `backend/scripts/` so it can be re-run:

- ≥ 10 s → `slow` (the 20 tests above)
- 0.3 – 10 s, or any test using `TestClient` / `SessionStore` / a full episode →
  `integration`
- everything else stays unmarked (unit)

Re-audit the 26 existing `integration` marks against the new definition, since
several are really `slow` and some are unit. Expected result: about 390 unit, about 130
integration and 20 slow.

### 3. Parallelism (`pytest-xdist`)

- `addopts = -n auto --dist loadgroup` keeps module-level state
  (`client = TestClient(app)` in 12 files, module- or session-scoped fixtures in about 10
  files) per worker. A test file that relies on another test's session state
  gets `@pytest.mark.xdist_group(<file>)`.
- Pin torch to one thread per worker with `torch.set_num_threads(1)` in a
  `conftest.py` fixture when running under xdist, or `OMP_NUM_THREADS=1`.
  Otherwise 8 workers × N torch threads thrash, as the 148 min / 56 min
  user/wall ratio already shows.
- Tests that spawn their own process pools
  (`test_parallel_generation_*`, `test_director_parallel_strategies`) are
  `slow` and run in the slow job, where xdist uses fewer workers (`-n 2`).
- Verification: run `pytest -n auto` 3× and `pytest -n 0` once, then compare
  pass sets. Check that no test writes into `app/fixtures/` or `models/`
  (the step-0 cache is already off via `conftest.py`).

### 4. Make the slow tier cheap (the real lever, one PR per family)

Even with tiers, the slow run is bounded by the 954 s test. In order of payoff:

1. **The two training-convergence tests (1 620 s).** They check that training
   learns *something*. Do that on a tiny dataset that can be learned
   (tens of samples, a few epochs, fixed seed) in seconds. Keep the
   real-scale run under a fourth marker, `training`, skipped unless
   `--run-training` is passed (same `conftest.py` recipe as `--run-slow`). It
   runs only in the nightly full-scale run and acts as a model-quality check
   rather than a code check.
2. **Block-training resume tests (231 + 108 + 104 s).** Resume and early-stop logic
   does not need a real model. Use 1-layer nets and 2-sample blocks.
3. **Evaluator data generation (76 + 70 + 24 + 20 s).** Generate fewer, smaller
   scenarios, and share one generated set per module with `scope="module"`.
4. **`test_director_parallel_strategies` (79 s), `test_reroute` (53 s),
   `test_goal_based_replan::test_splicing…` (55 s),
   `test_director_strategies_api` cache tests (13–17 s).** Check whether a smaller
   scenario or a shared, module-scoped planned session keeps the assertion. Several
   plan the same scenario more than once per test. Each test that drops under 10 s
   moves to `integration`.

Target: slow tier ≤ 10 min. Full-scale training runs only nightly.

### 5. CI

All in `.github/workflows/ci.yml`, so that there is one workflow, one set of
setup steps, and one place to look.

| trigger | backend runs | purpose |
|---|---|---|
| `pull_request`, `push` (main, explore_db) | `pytest` (unit + integration) | gate, about 2 min of tests |
| `workflow_dispatch`, input `backend_tests` | `commit` (default): as above · `slow`: also `--run-slow` · `full`: also `--run-slow --run-training` | started by hand, e.g. before a release PR or on a branch that touches planning or training |
| `schedule` (nightly) | `full` on `explore_db` and `main` | **post-merge line of defence**: whatever the PR gate skipped runs within 24 h of merging |

Jobs:

- `backend`: always runs, `pytest -n auto`. This is the required check.
- `backend-slow`: runs in parallel with `backend`, only when
  `github.event_name == 'schedule'` or `inputs.backend_tests != 'commit'`. It runs
  `pytest --run-slow -m "slow or training"` (adding `--run-training` for `full`),
  with `-n 2` because these tests start their own process pools.

```yaml
on:
  workflow_dispatch:
    inputs:
      backend_tests:
        description: Backend tests to run
        type: choice
        options: [commit, slow, full]
        default: commit
  schedule:
    - cron: '0 2 * * *'
```

Notes:

- GitHub runs a `schedule` trigger only on the default branch (`main`). To test
  `explore_db` nightly, the scheduled run uses a `strategy.matrix.ref:
  [explore_db, main]` and `actions/checkout` with `ref: ${{ matrix.ref }}`.
  `explore_db` is the one that matters, because that is where work lands first.
- Nightly failures are reported through a **CI badge in `README.md`** and nothing
  else. Put it under the title, and filter it to the nightly run so that a red
  badge means the full-scale run failed, not some PR:
  `[![nightly](https://github.com/flatland-association/flatland-ui-hub/actions/workflows/ci.yml/badge.svg?event=schedule)](https://github.com/flatland-association/flatland-ui-hub/actions/workflows/ci.yml?query=event%3Aschedule)`
- A consequence to accept: PRs are no longer gated on the slow tier. A
  regression in training, data generation or the parallel planner can land on
  `explore_db` and is caught the next night, not before the merge. Run
  `backend_tests: slow` by hand on PRs that touch those areas, and say so in
  `backend/AGENTS.md`.
- Install the CPU torch wheel
  (`--extra-index-url https://download.pytorch.org/whl/cpu`) in CI. This makes the
  cache and the install much smaller. Check that it doesn't change any result.

### 6. Keeping tiers honest

Tiers rot as tests grow. Add a `conftest.py` hook (`pytest_runtest_logreport`)
that, when `PYTEST_TIER_BUDGET=1` (set in CI), lists every test over its tier
budget in the terminal summary: unit > 0.5 s, integration > 10 s, with about 2×
slack for CI noise. Start as a warning and make it fail once the classification has
been stable for a while. Document the tiers and commands in
`backend/AGENTS.md` and `AGENTS.md` → Commands.

## Decided

- Slow and training tests don't gate PRs. They run nightly at full scale as the
  post-merge line of defence, and can be started by hand (`workflow_dispatch`).
- No pre-commit hook. The tiers are documented only.
- Nightly failures are reported only through a CI badge in `README.md` (step 5).
- The nightly run covers both `explore_db` and `main` (2026-10-24). `explore_db`
  is where work lands first: it was 74 commits ahead of `main` on 2026-10-23.
  `main` is the release line.
