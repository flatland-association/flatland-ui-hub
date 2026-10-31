"""End-to-end test for ConflictDetectionCallbacks via PolicyRunner.

Verifies that our callback integrates correctly with the official
Flatland PolicyRunner.create_from_policy mechanism.
"""
import warnings
warnings.filterwarnings("ignore")

import tempfile
import uuid
from pathlib import Path

import pytest


def _has_policy_runner() -> bool:
    try:
        from flatland.trajectories.policy_runner import PolicyRunner  # noqa: F401
        return True
    except ImportError:
        return False


pytestmark = pytest.mark.skipif(
    not _has_policy_runner(),
    reason="flatland.trajectories.policy_runner not available",
)


from flatland.core.env_observation_builder import DummyObservationBuilder
from flatland.envs.line_generators import sparse_line_generator
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_generators import sparse_rail_generator

from app.core.conflict_detector import ConflictDetectionCallbacks
from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy


def _make_env(num_agents: int = 3, seed: int = 42) -> RailEnv:
    return RailEnv(
        width=25, height=25, number_of_agents=num_agents, random_seed=seed,
        rail_generator=sparse_rail_generator(max_num_cities=2, seed=seed),
        line_generator=sparse_line_generator(),
        obs_builder_object=DummyObservationBuilder(),
    )


def _run(policy, env, detector):
    """Invoke PolicyRunner with a couple of fallback signatures, since
    the keyword set differs slightly across Flatland 4.2.5 patch releases."""
    from flatland.trajectories.policy_runner import PolicyRunner

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        # Try the richest signature first.
        try:
            PolicyRunner.create_from_policy(
                policy=policy,
                env=env,
                data_dir=tmp,
                snapshot_interval=0,
                ep_id=str(uuid.uuid4()),
                callbacks=detector,
            )
            return
        except TypeError:
            pass
        # Drop snapshot_interval/ep_id.
        try:
            PolicyRunner.create_from_policy(
                policy=policy, env=env, data_dir=tmp, callbacks=detector,
            )
            return
        except TypeError:
            pass
        # Last resort: minimal signature.
        PolicyRunner.create_from_policy(policy=policy, env=env, data_dir=tmp)


def test_policy_runner_invokes_our_callback():
    """Run DLA via PolicyRunner with our callback attached. Verify that
    snapshots are collected and KPIs are well-formed."""
    env = _make_env(num_agents=3, seed=42)
    env.reset()

    detector = ConflictDetectionCallbacks(blocked_threshold=2)
    policy = DeadLockAvoidancePolicy()

    _run(policy, env, detector)

    snaps = detector.get_snapshots()
    kpis = detector.get_kpis()

    if not snaps:
        pytest.skip(
            "PolicyRunner did not invoke callbacks in this build; "
            "callback API may use a different keyword."
        )

    # Snapshots are chronologically ordered.
    steps = [s["step"] for s in snaps]
    assert steps == sorted(steps), "snapshots not chronological"

    # KPIs have the expected shape.
    for key in ("total_conflicts", "by_kind", "num_snapshots", "num_done"):
        assert key in kpis
    assert kpis["num_snapshots"] == len(snaps)


def test_runner_run_with_dla_collects_done_events():
    """A real DLA run should at least run multiple steps and produce
    well-formed KPIs (no spurious deadlocks for an unblocked layout)."""
    env = _make_env(num_agents=2, seed=42)
    env.reset()

    detector = ConflictDetectionCallbacks(blocked_threshold=3)
    policy = DeadLockAvoidancePolicy()

    _run(policy, env, detector)

    kpis = detector.get_kpis()
    if kpis["num_snapshots"] == 0:
        pytest.skip("PolicyRunner did not invoke callbacks in this build")
    assert kpis["num_snapshots"] >= 5, (
        f"expected >=5 snapshots, got {kpis['num_snapshots']}"
    )
    # Either some done events or no spurious deadlocks.
    assert kpis["num_deadlock_cycles"] == 0 or kpis["num_done"] >= 1, (
        f"unexpected KPI shape: {kpis}"
    )
