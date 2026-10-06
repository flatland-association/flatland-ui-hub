"""Event Simulation sandbox (app.api.sandbox): a checkpoint at the decision
moment, options played from it to the end of the episode.

The tour incident is the one `scripts/generate_sandbox_outcomes.py` precomputes
for the interview tour, so the playable sandbox has to arrive at the same
numbers as the precomputed cards.
"""
import logging
import warnings

import pytest
from fastapi.testclient import TestClient

from app.api.sessions import _build_policy
from app.core.disturbances import apply_due_disturbances
from app.core.recommenders.registry import active_recommender
from app.core.scenario_presets import select_disturbances
from app.core.session_manager import session_manager
from app.main import app

PRESET = "pf-ch-wn-wal-long-approach"
TOUR_DISTURBANCE = "interview-e1-breakdown-single-track"


def _run_to_first_impact(session):
    """Drive the session like the live run until the impact analysis lists a train."""
    env = session.env
    policy = _build_policy(session.id, env, session.policy)
    recommender = active_recommender()
    for _ in range(int(env._max_episode_steps)):
        policy.start_step()
        actions = policy.act_many(env.get_agent_handles(), session.last_observations or {})
        obs, _, _, _ = env.step(actions)
        policy.end_step()
        session.last_observations = obs
        apply_due_disturbances(session.id, session, env)
        if recommender.recommend(env):
            return int(env._elapsed_steps)
    raise AssertionError("the impact analysis never listed an affected train")


@pytest.fixture
def tour_session():
    warnings.filterwarnings("ignore")
    logging.disable(logging.CRITICAL)
    session = session_manager.create(
        scenario_preset_id=PRESET, disturbances=select_disturbances(PRESET, [TOUR_DISTURBANCE])
    )
    yield session
    session_manager.delete(session.id)
    logging.disable(logging.NOTSET)


def _arrivals(outcome):
    return {t["handle"]: t["arrivalStep"] for t in outcome["trains"]}


def test_checkpoint_keeps_the_decision_moment(tour_session):
    client = TestClient(app)
    step = _run_to_first_impact(tour_session)
    cp = client.post(f"/session/{tour_session.id}/sandbox/checkpoint").json()
    assert cp["step"] == step == 28
    assert [i["handle"] for i in cp["items"]] == [1]
    assert cp["items"][0]["blocked_by"] == 0
    # Same step again: the same checkpoint, not a second one.
    again = client.post(f"/session/{tour_session.id}/sandbox/checkpoint").json()
    assert again["id"] == cp["id"]
    assert len(tour_session.sandbox_checkpoints) == 1


def test_options_match_the_precomputed_cards(tour_session):
    """proceed +26, hold-then-release +30, hold without release strands two trains."""
    client = TestClient(app)
    _run_to_first_impact(tour_session)
    cp = client.post(f"/session/{tour_session.id}/sandbox/checkpoint").json()
    clears = cp["items"][0]["clears_in_steps"]
    url = f"/session/{tour_session.id}/sandbox/run"

    proceed = client.post(url, json={"checkpoint": cp["id"], "handle": 1, "option": "proceed"}).json()
    assert _arrivals(proceed["outcome"]) == {0: 69, 1: 70, 2: 64}
    assert proceed["outcome"]["totalDelayVsPlan"] == 26

    hold = client.post(url, json={
        "checkpoint": cp["id"], "handle": 1, "option": "hold_until", "release_after": clears,
    }).json()
    assert hold["release_step"] == cp["step"] + clears
    assert _arrivals(hold["outcome"]) == {0: 69, 1: 72, 2: 66}

    stuck = client.post(url, json={"checkpoint": cp["id"], "handle": 1, "option": "hold"}).json()
    assert stuck["outcome"]["arrived"] == 1

    # Replaying does not wear the checkpoint out.
    again = client.post(url, json={"checkpoint": cp["id"], "handle": 1, "option": "proceed"}).json()
    assert again["outcome"] == proceed["outcome"]


def test_played_run_is_completed_by_simulation_when_the_shift_ends_early(tour_session):
    client = TestClient(app)
    _run_to_first_impact(tour_session)
    client.post(f"/session/{tour_session.id}/sandbox/checkpoint")
    body = client.get(f"/session/{tour_session.id}/sandbox").json()
    assert body["played_completed_by_simulation"] is True
    # Nobody decided, nothing holds the train: the played run is "proceed".
    assert _arrivals(body["played"]) == {0: 69, 1: 70, 2: 64}
    assert len(body["checkpoints"]) == 1


def test_hold_until_needs_a_release_step(tour_session):
    client = TestClient(app)
    _run_to_first_impact(tour_session)
    cp = client.post(f"/session/{tour_session.id}/sandbox/checkpoint").json()
    r = client.post(f"/session/{tour_session.id}/sandbox/run",
                    json={"checkpoint": cp["id"], "handle": 1, "option": "hold_until"})
    assert r.status_code == 400
    r = client.post(f"/session/{tour_session.id}/sandbox/run",
                    json={"checkpoint": 9, "handle": 1, "option": "proceed"})
    assert r.status_code == 404


def test_played_run_reads_the_arrivals_of_a_finished_episode(tour_session):
    """The played run reads Flatland's `arrival_time`; it must count like the
    branch runner, so it reads like the variants next to it."""
    client = TestClient(app)
    _run_to_first_impact(tour_session)
    env = tour_session.env
    policy = _build_policy(tour_session.id, env, tour_session.policy)
    while not all(a.arrival_time is not None for a in env.agents):
        policy.start_step()
        obs, _, _, _ = env.step(policy.act_many(env.get_agent_handles(), tour_session.last_observations or {}))
        policy.end_step()
        tour_session.last_observations = obs
    body = client.get(f"/session/{tour_session.id}/sandbox").json()
    assert body["played_completed_by_simulation"] is False
    assert _arrivals(body["played"]) == {0: 69, 1: 70, 2: 64}
