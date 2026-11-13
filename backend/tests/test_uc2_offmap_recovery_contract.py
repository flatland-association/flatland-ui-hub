"""UC2 cleared off-map faults preserve the native 0/2/4 action contract."""
import copy

import numpy as np
import pytest
from fastapi.testclient import TestClient
from flatland.envs.step_utils.states import TrainState

from app.core.env_factory import create_env
from app.core.native_env_cache import clear_native_environment_caches
from app.policies.learned.ecml_observation import FastTreeObsBuilder
from app.policies.learned.pf_ch_observation import PFChObservationBuilder
from app.policies.learned.uc2_observation import OBSERVATION_DIM, UC2ObservationBuilder
from lab.marl.collect_pp_demonstrations import canonical_teacher_action, collect_case, create_teacher
from lab.marl.pf_ch_episode import PFChCase, PFChEpisode


def _physical(env):
    return (int(env._elapsed_steps), tuple((a.state.name, a.current_configuration,
            a.speed_counter.speed, a.speed_counter.distance,
            a.malfunction_handler.malfunction_down_counter, a.arrival_time) for a in env.agents))


@pytest.fixture
def recovered_tutorial():
    """Reach the actual native fault/recovery boundary using unchanged raw PP."""
    episode = PFChEpisode(PFChCase("tutorial", departure_offsets=(7, 0)),
                          observation_schema="uc2-context-v1")
    player, _, _ = create_teacher(episode.env, preset="tutorial", max_orders=4,
                                 executor="trainruns", replan_on_incidents=True, max_replans=8)
    while episode.now < 11:
        episode.step(player.act_many(episode.handles))
    assert episode.env.agents[0].state == TrainState.MALFUNCTION_OFF_MAP
    assert episode.env.agents[0].current_configuration is None
    assert episode.env.agents[0].malfunction_handler.malfunction_down_counter == 0
    yield episode
    episode.close()


@pytest.mark.integration
@pytest.mark.parametrize("action, expected_state, enters", [
    (0, TrainState.READY_TO_DEPART, False),
    (2, TrainState.MOVING, True),
    (4, TrainState.STOPPED, True),
])
def test_cleared_offmap_native_forks_distinguish_noop_forward_and_stop(recovered_tutorial, action, expected_state, enters):
    env = recovered_tutorial.env
    before = _physical(env)
    row = recovered_tutorial.builder.get(0)
    np.testing.assert_array_equal(row[-5:], [1, 0, 1, 0, 1])
    assert canonical_teacher_action(action, on_map=False, mask=row[-5:]) == (action, "identity")
    fork = copy.deepcopy(env)
    fork.step({0: action, 1: 0})
    assert fork.agents[0].state == expected_state
    assert fork.agents[0].current_configuration == (fork.agents[0].initial_configuration if enters else None)
    if action == 4:
        assert fork.agents[0].speed_counter.speed == 0
    assert _physical(env) == before


@pytest.mark.integration
@pytest.mark.parametrize("action", [0, 2, 4])
def test_active_offmap_counter_remains_blocked_for_all_three_native_actions(recovered_tutorial, action):
    env = recovered_tutorial.env
    env.agents[0].malfunction_handler._set_malfunction_down_counter(1)
    row = recovered_tutorial.builder.get(0)
    np.testing.assert_array_equal(row[-5:], [1, 0, 0, 0, 0])
    fork = copy.deepcopy(env)
    fork.step({0: action, 1: 0})
    assert fork.agents[0].current_configuration is None
    assert fork.agents[0].state == TrainState.MALFUNCTION_OFF_MAP
    assert fork.agents[0].malfunction_handler.malfunction_down_counter == 0


@pytest.mark.integration
def test_only_recovered_offmap_mask_changes_and_all_313_features_remain_historical(recovered_tutorial):
    env = recovered_tutorial.env
    masked = recovered_tutorial.builder
    unmasked = UC2ObservationBuilder(with_action_mask=False)
    unmasked.reset(env)
    for counter in (0, 1):
        env.agents[0].malfunction_handler._set_malfunction_down_counter(counter)
        with_mask = masked.get(0)
        np.testing.assert_array_equal(with_mask[:OBSERVATION_DIM], unmasked.get(0))
        historical = PFChObservationBuilder._assemble(masked, 0, masked._peer_features())
        np.testing.assert_array_equal(with_mask[:272], historical[:272])
        # Keep the original network's off-map feature flags, even though the
        # native recovery mask no longer confuses this state with DONE.
        assert with_mask[6] == 1
        np.testing.assert_array_equal(historical[-5:], [1, 0, 0, 0, 0])
        np.testing.assert_array_equal(with_mask[-5:], [1, 0, 1, 0, 1] if counter == 0 else [1, 0, 0, 0, 0])
    for state in (TrainState.WAITING, TrainState.READY_TO_DEPART, TrainState.MOVING,
                  TrainState.STOPPED, TrainState.MALFUNCTION, TrainState.DONE):
        agent = env.agents[0]
        agent.state_machine.set_state(state)
        agent.current_configuration = agent.initial_configuration if state.is_on_map_state() else None
        actual = masked.get(0)
        historical = PFChObservationBuilder._assemble(masked, 0, masked._peer_features())
        np.testing.assert_array_equal(actual[-5:], historical[-5:])
        np.testing.assert_array_equal(actual[:OBSERVATION_DIM], unmasked.get(0))


@pytest.mark.integration
def test_recovery_still_requires_native_departure_eligibility(recovered_tutorial):
    episode = recovered_tutorial
    episode.env.agents[0].earliest_departure = episode.now + 2
    np.testing.assert_array_equal(episode.builder.get(0)[-5:], [1, 0, 0, 0, 0])
    fork = copy.deepcopy(episode.env)
    fork.step({0: 2, 1: 0})
    assert fork.agents[0].current_configuration is None


@pytest.mark.integration
def test_non_uc2_observation_schemas_keep_their_existing_masks():
    env = create_env(scenario_preset_id="pf-ch-wn-wal-conflict")
    try:
        env.agents[0].state_machine.set_state(TrainState.MALFUNCTION_OFF_MAP)
        env.agents[0].malfunction_handler._set_malfunction_down_counter(0)
        for builder in (FastTreeObsBuilder(), PFChObservationBuilder()):
            builder.reset(env)
            np.testing.assert_array_equal(builder.get(0)[-5:], [1, 0, 0, 0, 0])
    finally:
        clear_native_environment_caches()


def test_offgrid_stop_normalization_only_applies_when_stop_is_not_allowed():
    assert canonical_teacher_action(4, on_map=False, mask=np.asarray([1, 0, 1, 0, 1])) == (4, "identity")
    assert canonical_teacher_action(4, on_map=False, mask=np.asarray([1, 0, 1, 0, 0])) == (0, "off_grid_stop_as_noop")
    assert canonical_teacher_action(2, on_map=False, mask=np.asarray([1, 0, 1, 0, 1])) == (2, "identity")


@pytest.mark.integration
@pytest.mark.parametrize("offsets", [(7, 0), (8, 6), (9, 5)])
def test_collected_pp_matches_unchanged_raw_pp_physics_arrivals_and_lateness(offsets, monkeypatch):
    case = PFChCase("tutorial", departure_offsets=offsets, case_id=f"native-contract-{offsets[0]}-{offsets[1]}")
    raw = PFChEpisode(case, observation_schema="uc2-context-v1")
    expected_physics = []
    try:
        player, _, _ = create_teacher(raw.env, preset="tutorial", max_orders=4,
                                     executor="trainruns", replan_on_incidents=True, max_replans=8)
        while not raw.done:
            raw.step(player.act_many(raw.handles))
            expected_physics.append(_physical(raw.env))
        expected = raw.metrics()
    finally:
        raw.close()
    actual_physics = []
    native_step = PFChEpisode.step

    def capture_step(episode, actions):
        result = native_step(episode, actions)
        actual_physics.append(_physical(episode.env))
        return result

    monkeypatch.setattr(PFChEpisode, "step", capture_step)
    records, report = collect_case(case, max_orders=4, executor="trainruns",
                                   observation_schema="uc2-context-v1",
                                   replan_on_incidents=True, max_replans=8)
    assert report["accepted"] and records
    assert actual_physics == expected_physics
    for field in ("steps", "horizon", "arrived", "complete_mission", "lateness", "trains"):
        assert report["metrics"][field] == expected[field], field
    if offsets == (7, 0):
        assert expected["lateness"] == 12
        recovery = next(row for row in records if row["step"] == 11 and row["handle"] == 0)
        assert recovery["raw_teacher_action"] == recovery["teacher_action"] == recovery["applied_action"] == 2
        assert recovery["action_conversion"] == "identity"


@pytest.mark.integration
@pytest.mark.parametrize("action", [0, 2, 4])
def test_public_manual_action_matches_native_recovery_without_changing_physics(action):
    from app.core.session_manager import session_manager
    from app.main import app

    with TestClient(app) as client:
        response = client.post("/session", json={"scenario_preset_id": "tutorial"})
        assert response.status_code == 200, response.text
        sid = response.json()["id"]
        env = session_manager.get(sid).env
        try:
            env._elapsed_steps = 11
            env.agents[0].state_machine.set_state(TrainState.MALFUNCTION_OFF_MAP)
            env.agents[0].malfunction_handler._set_malfunction_down_counter(0)
            reference = copy.deepcopy(env)
            reference.step({0: action})
            result = client.post(f"/session/{sid}/action", json={"handle": 0, "action": action})
            assert result.status_code == 200, result.text
            assert _physical(env) == _physical(reference)
        finally:
            client.delete(f"/session/{sid}")
