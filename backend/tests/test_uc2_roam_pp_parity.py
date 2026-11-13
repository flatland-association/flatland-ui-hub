"""Registered UC2 controller regressions on known PP counterexamples.

These five cases are development/regression examples. Their literal PP totals
come from the unchanged native trainrun reference; they are not new holdouts
or claims of optimality. Keep native faults, speeds and episode limits intact.
"""
import hashlib

import pytest

from app.policies import registry
from app.policies.learned import uc2_bundle
from app.policies.learned.roam_check import open_waypoint_groups, stuck_trains
from lab.marl.pf_ch_episode import PFChCase, PFChEpisode


BASELINE_SHA256 = "01b584ca9933604ee3bfbfb384961f3a1371ec453699e6bf9229a03219034668"


@pytest.mark.integration
@pytest.mark.parametrize(
    "preset, offsets, pp_lateness, horizon, trains, fault_step, fault_handle",
    [
        ("uc2-1", (5, 0, 4), 17, 168, 3, 25, 2),
        ("uc2-2", (3, 2, 6), 25, 102, 3, 16, 0),
        ("uc2-3", (0, 2, 6), 42, 240, 3, 25, 2),
        ("uc2-4", (6, 0, 3), 47, 180, 3, 20, 0),
        ("tutorial", (7, 0), 12, 40, 2, 8, 0),
    ],
)
def test_registered_neural_driver_matches_or_beats_native_pp_on_known_counterexample(
    monkeypatch, preset, offsets, pp_lateness, horizon, trains, fault_step, fault_handle,
):
    planner_calls = []

    def planner_forbidden(*_args, **_kwargs):
        planner_calls.append(True)
        raise AssertionError("UC2 neural/ROAM runtime must not fall back to PP or DLA")

    monkeypatch.setattr(registry.PlanPolicy, "reset", planner_forbidden)
    monkeypatch.setattr(registry.DeadLockAvoidancePolicy, "reset", planner_forbidden)
    baseline_before = hashlib.sha256(uc2_bundle.CHECKPOINT.read_bytes()).hexdigest()
    assert baseline_before == uc2_bundle.CHECKPOINT_SHA256 == BASELINE_SHA256
    case = PFChCase(preset, departure_offsets=offsets,
                   case_id=f"known-pp-regression-{preset}-{'-'.join(map(str, offsets))}")
    assert case.horizon is None and not case.disturbances and not case.disturbance_ids
    episode = PFChEpisode(case, observation_schema=uc2_bundle.OBSERVATION_SCHEMA)
    try:
        assert episode.horizon == horizon
        policy = registry.create_runtime_policy("uc2_rl", episode.env)
        assert not policy.model.training
        assert all(not parameter.requires_grad for parameter in policy.model.parameters())
        while not episode.done:
            episode.step(policy.act_many(episode.handles))
            assert episode.horizon == horizon
            # This bypasses the guard's cached completion results: audit the
            # actual simulator state, including cancellation by a native fault.
            groups = open_waypoint_groups(policy.obs_builder.base)
            facts, cached = policy.roam_check.snapshot(groups)
            reference = stuck_trains(policy.roam_check.tables, facts,
                                     partial_moves=True, max_candidates=60)
            assert cached == reference == set()
            resources = [episode.env.resource_map.get_resource(agent.current_configuration)
                         for agent in episode.env.agents if agent.current_configuration is not None]
            assert len(resources) == len(set(resources))
        metrics = episode.metrics()
        assert metrics["complete_mission"] and metrics["arrived"] == metrics["total"] == trains
        assert metrics["steps"] <= metrics["horizon"] == horizon
        assert metrics["lateness"] <= pp_lateness
        assert any(event["step"] == fault_step and event["handle"] == fault_handle
                   and event["counter_after"] > event["counter_before"]
                   for event in metrics["observed_malfunction_counter_increases"])
        assert metrics["scheduled_incidents"] == metrics["applied_incidents"] == 0
        assert not planner_calls
    finally:
        episode.close()
        assert hashlib.sha256(uc2_bundle.CHECKPOINT.read_bytes()).hexdigest() == baseline_before
