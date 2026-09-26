"""Precompute the Director's start-of-run answers for the tour scenarios, so a tour
starts ready instead of planning for up to two minutes
(app/policies/goal_based_policies/step0_cache.py).

It does what the app does on a fresh Director session — advance until the first
train moves (planning the first plan on the way), then plan the three options —
and the cache writes both to app/fixtures/director_step0/. Run it after anything that
changes the planner, the checkpoints, the encoder caps or a tour scenario, and
commit the files:

    cd backend && PYTHONPATH=. python scripts/precompute_director_step0.py
    cd backend && PYTHONPATH=. python scripts/precompute_director_step0.py pf-ch-corridor-stops

Live runs (random breakdowns) carry their seed in the key and are not
precomputed: their seed is new every run.
"""
import sys
import time
import warnings

warnings.filterwarnings("ignore")

from fastapi.testclient import TestClient  # noqa: E402

from app.core.session_manager import session_manager  # noqa: E402
from app.main import app  # noqa: E402

# The scenarios a Director tour starts on (core/demo/tours.ts).
TOUR_SCENARIOS = ["pf-ch-corridor-stops", "pf-ch-wn-wal-long-approach"]


def precompute(preset: str) -> None:
    """What a fresh Director session in the app does: advance one step at a
    time under the Director's policy until the first train moves (the store's
    `_autoAdvanceUntilFirstAgentReady`; the first step plans the first plan),
    then ask for the options."""
    client = TestClient(app)
    sid = session_manager.create(scenario_preset_id=preset).id
    t0 = time.time()
    for _ in range(300):
        state = client.get(f"/session/{sid}/state").json()
        if state.get("episode_done") or any(a.get("state") == "MOVING" for a in state.get("agents", [])):
            break
        client.post(f"/session/{sid}/step", json={"policy": "goal_directed", "n_steps": 1})
    t1 = time.time()
    from app.policies.goal_directed_policy import env_weights, plan_info
    session = session_manager.get(sid)
    info = plan_info(session.env) or {}
    print(f"  {preset} at step {session.env._elapsed_steps}: against="
          f"{(info.get('source'), info.get('weighted'), len(info.get('replans') or []))} "
          f"weights={env_weights(session.env)}")
    strategies = client.get(f"/session/{sid}/director/strategies").json()
    t2 = time.time()
    planned = sum(1 for s in strategies.get("strategies", []) if s.get("plan"))
    print(f"{preset}: start (first plan + advance to step {strategies.get('step')}) {t1 - t0:.0f} s, "
          f"options {t2 - t1:.0f} s, "
          f"{planned}/3 planned, precomputed before: {bool(strategies.get('precomputed'))}")


if __name__ == "__main__":
    for preset in sys.argv[1:] or TOUR_SCENARIOS:
        precompute(preset)
