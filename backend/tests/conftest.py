"""Shared test setup."""
import os

# Tests neither read nor write the Director's step-0 cache
# (app/policies/goal_based_policies/step0_cache.py): a shipped answer would
# turn a planning test into a file read, and a test run would leave its own
# scenarios' plans in app/fixtures. test_director_step0_cache.py switches it on
# for itself, against a temporary directory.
os.environ.setdefault("DIRECTOR_STEP0_CACHE", "0")
