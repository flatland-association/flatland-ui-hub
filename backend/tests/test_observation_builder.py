"""Every env has its own observation builder (E2E known bug 1, issue #115).

Flatland's `RailEnv.__init__` defaults `obs_builder_object` to one shared
`GlobalObsForRailEnv()`, and each new env points it at itself. Stepping an
older session after a newer, smaller one was created then failed with an
`IndexError`.
"""
import warnings

warnings.filterwarnings("ignore")

from app.api.sessions import _build_policy
from app.core.scenario_runner import TrajectoryBranchRunner
from app.core.session_manager import session_manager


def _step(session, n: int = 3) -> None:
    policy = _build_policy(session.id, session.env, session.policy)
    for _ in range(n):
        policy.start_step()
        actions = policy.act_many(session.env.get_agent_handles(), session.last_observations or {})
        session.last_observations, _, _, _ = session.env.step(actions)
        policy.end_step()


def test_an_older_session_with_more_trains_steps_after_a_newer_one():
    older = session_manager.create(width=50, height=40, number_of_agents=6)
    _step(older)
    newer = session_manager.create(width=30, height=30, number_of_agents=2)
    _step(newer)

    assert older.env.obs_builder is not newer.env.obs_builder
    _step(older)  # raised IndexError while the builder was shared
    assert older.env.obs_builder.env is older.env


def test_scene_presets_and_forks_get_their_own_builder():
    walensee = session_manager.create(scenario_preset_id="pf-ch-wn-wal-long-approach")
    other = session_manager.create(scenario_preset_id="pf-ch-wn-wal-conflict")
    assert walensee.env.obs_builder is not other.env.obs_builder

    runner = TrajectoryBranchRunner(walensee.env, lambda: None)
    fork_a, fork_b = runner._fork_env(), runner._fork_env()
    assert fork_a.obs_builder is not fork_b.obs_builder
    assert fork_a.obs_builder.env is fork_a
    # Forking leaves the live env's builder pointing at the live env.
    assert walensee.env.obs_builder.env is walensee.env
