"""Shared test setup."""
import os

# Tests neither read nor write the Director's step-0 cache
# (app/policies/goal_based_policies/step0_cache.py): a shipped answer would
# turn a planning test into a file read, and a test run would leave its own
# scenarios' plans in app/fixtures. test_director_step0_cache.py switches it on
# for itself, against a temporary directory.
os.environ.setdefault("DIRECTOR_STEP0_CACHE", "0")

# One torch / BLAS thread per test process. The models under test are small,
# and a thread pool per core loses more to synchronisation than it gains:
# test_short_ppo_run_writes_checkpoint_and_curve takes 3 s like this and 15 s
# with the default pool. Under pytest-xdist it matters more, since N workers
# × N threads thrash. Set before any test module imports torch or numpy; an
# explicit OMP_NUM_THREADS in the environment still wins.
for _var in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ.setdefault(_var, "1")


# ── test tiers (docs/plans/backend-test-tiers.md) ────────────────────────
# `slow` and `training` tests are skipped, not deselected, so the summary
# still shows that they exist; `-m` stays free for the caller.
import pytest  # noqa: E402

_OPT_IN_TIERS = {
    "slow": ("--run-slow", "slow test: pass --run-slow"),
    "training": ("--run-training", "full-scale training: pass --run-training"),
}


def pytest_addoption(parser):
    parser.addoption("--run-slow", action="store_true", help="also run tests marked slow")
    parser.addoption("--run-training", action="store_true", help="also run tests marked training")


def pytest_collection_modifyitems(config, items):
    for marker, (option, reason) in _OPT_IN_TIERS.items():
        if config.getoption(option):
            continue
        skip = pytest.mark.skip(reason=reason)
        for item in items:
            if marker in item.keywords:
                item.add_marker(skip)
