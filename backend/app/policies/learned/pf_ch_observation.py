"""Optional PF-CH context: service features plus explicit train identities/state.

The first 36 features retain service-v1 semantics, followed by 12 own-train
features and 16 fixed handle slots of 14 features. Masks remain last. All state
comes from the current environment; future session incidents are unavailable.
"""
from __future__ import annotations

from collections.abc import Iterable

import numpy as np
from flatland.core.env_observation_builder import ObservationBuilder
from flatland.envs.rail_env import RailEnv
from flatland.envs.step_utils.states import TrainState

from app.core.stops import intermediate_stops, served_stops
from app.policies.learned.ecml_observation import FastTreeObsBuilder
from app.utils.agent_compat import (
    agent_direction,
    agent_initial_direction,
    agent_initial_position,
    agent_planned_target,
    agent_position,
)

OBSERVATION_SCHEMA = "pf-ch-context-v1"
MAX_TRAINS = 16
OWN_FEATURE_NAMES = ("handle", "moving", "row", "column", "heading_sin", "heading_cos",
                     "departure_slack", "next_call_row", "next_call_column", "stopped", "at_call", "malfunction")
PEER_FEATURE_NAMES = ("present", "on_map", "row", "column", "heading_sin", "heading_cos", "moving", "stopped",
                      "done", "malfunction", "departure_slack", "service_progress", "target_row", "target_column")
OWN_FEATURES = len(OWN_FEATURE_NAMES)
PEER_FEATURES = len(PEER_FEATURE_NAMES)
BASE_FEATURES = FastTreeObsBuilder.OBSERVATION_DIM
CONTEXT_OFFSET = BASE_FEATURES + OWN_FEATURES
OBSERVATION_DIM = CONTEXT_OFFSET + MAX_TRAINS * PEER_FEATURES
MALFUNCTION_SCALE = 32.0

_PF_CH_SCENES = frozenset({
    "scene_pf_ch_corridor", "scene_pf_ch_corridor_stops", "scene_pf_ch_wn_wal_conflict",
    "scene_pf_ch_wn_wal_long_approach", "scene_pf_ch_wn_wal_connections",
})
_HEADINGS = ((0.0, 1.0), (1.0, 0.0), (0.0, -1.0), (-1.0, 0.0))


class PFChObservationBuilder(ObservationBuilder):
    """Expose bounded PF-CH state without retaining train-progress history."""

    OBSERVATION_SCHEMA = OBSERVATION_SCHEMA
    OBSERVATION_DIM = OBSERVATION_DIM
    ACTION_MASK_SIZE = FastTreeObsBuilder.ACTION_MASK_SIZE

    def __init__(self, max_depth: int = 3, with_action_mask: bool = True) -> None:
        self.schema = OBSERVATION_SCHEMA
        self.with_action_mask = with_action_mask
        self.base = FastTreeObsBuilder(max_depth=max_depth, with_action_mask=with_action_mask)
        self.env: RailEnv | None = None
        self._rail_state: bytes | None = None

    def _bound_env(self) -> RailEnv:
        if self.env is None:
            raise ValueError("PF-CH context requires an environment")
        return self.env

    def _rail_snapshot(self) -> bytes:
        rail = self._bound_env().rail
        if rail is None:
            raise ValueError("PF-CH context requires initialised rail")
        return rail.grid.tobytes()

    def _horizon(self) -> int:
        horizon = self._bound_env()._max_episode_steps
        if horizon is None:
            raise ValueError("PF-CH context requires an episode horizon")
        return max(1, horizon)

    def reset(self, env: RailEnv | None = None) -> None:
        """Bind to PF-CH geometry or native forks with at most sixteen handles."""
        if env is not None:
            self.env = env
        environment = self._bound_env()
        scene = getattr(environment, "_infrastructure_scene", None)
        # Native persistence forks retain geometry/missions but omit scene metadata.
        if ((scene is not None and scene.get("id") not in _PF_CH_SCENES)
                or (environment.height, environment.width) != (9, 191)):
            raise ValueError("pf-ch-context-v1 requires PF-CH geometry and compatible scene metadata")
        handles = [int(agent.handle) for agent in environment.agents]
        if not handles or len(handles) > MAX_TRAINS or len(set(handles)) != len(handles):
            raise ValueError("PF-CH context requires one to sixteen unique train handles")
        if any(handle < 0 or handle >= MAX_TRAINS for handle in handles):
            raise ValueError("PF-CH context train handles must be in 0..15")
        self.base.reset(environment)
        self._rail_state = self._rail_snapshot()

    def _refresh_topology(self) -> None:
        environment = self._bound_env()
        rail_state = self._rail_snapshot()
        if rail_state != self._rail_state:
            self.base.reset(environment)
            self._rail_state = rail_state

    def _get_distance_map(self, handle):
        """Use the base builder's current mission leg for shared reward shaping."""
        self._refresh_topology()
        return self.base._get_distance_map(handle)

    def _coordinates(self, position: tuple[int, int]) -> tuple[float, float]:
        environment = self._bound_env()
        return (float(position[0]) / max(1, environment.height - 1),
                float(position[1]) / max(1, environment.width - 1))

    @staticmethod
    def _virtual_configuration(agent) -> tuple[tuple[int, int], int]:
        position = agent_position(agent)
        if position is not None:
            direction = agent_direction(agent)
            if direction is None:
                raise ValueError("on-map PF-CH train has no direction")
            return position, int(direction)
        target = getattr(agent, "target_configuration", None)
        if agent.state == TrainState.DONE and target is not None:
            return target
        return agent_initial_position(agent), int(agent_initial_direction(agent))

    def _slack(self, departure) -> float:
        environment = self._bound_env()
        return float(np.clip((int(departure or 0) - environment._elapsed_steps)
                             / self._horizon(), -1.0, 1.0))

    def _service(self, handle: int):
        environment = self._bound_env()
        stops = intermediate_stops(environment.agents[handle])
        served = served_stops(environment, handle)
        fraction = sum(stop.index in served for stop in stops) / len(stops) if stops else 1.0
        return stops, fraction

    def _own_features(self, handle: int) -> np.ndarray:
        environment = self._bound_env()
        agent = environment.agents[handle]
        position, heading = self._virtual_configuration(agent)
        row, col = self._coordinates(position)
        stops = intermediate_stops(agent)
        completed = self.base._completed_waypoint_index(handle)
        pending = next((stop for stop in stops if stop.index > completed), None)
        target = pending.alternatives[0][:2] if pending is not None else agent_planned_target(agent)
        target_row, target_col = self._coordinates(target)
        actual_position = agent_position(agent)
        at_call = (pending is not None and actual_position is not None
                   and pending.matches(*actual_position, heading))
        malfunction = float(np.clip(agent.malfunction_handler.malfunction_down_counter
                                    / self._horizon(), 0.0, 1.0))
        return np.asarray((handle / (MAX_TRAINS - 1), float(agent.state == TrainState.MOVING), row, col,
                           *_HEADINGS[int(heading)], self._slack(agent.earliest_departure),
                           target_row, target_col, float(agent.state == TrainState.STOPPED), float(at_call),
                           malfunction), dtype=np.float32)

    def _peer_features(self) -> np.ndarray:
        environment = self._bound_env()
        peers = np.zeros((MAX_TRAINS, PEER_FEATURES), dtype=np.float32)
        for agent in environment.agents:
            handle = int(agent.handle)
            position, heading = self._virtual_configuration(agent)
            row, col = self._coordinates(position)
            target_row, target_col = self._coordinates(agent_planned_target(agent))
            _, progress = self._service(handle)
            peers[handle] = (1.0, float(agent_position(agent) is not None), row, col,
                             *_HEADINGS[int(heading)], float(agent.state == TrainState.MOVING),
                             float(agent.state == TrainState.STOPPED), float(agent.state == TrainState.DONE),
                             float(np.clip(agent.malfunction_handler.malfunction_down_counter / MALFUNCTION_SCALE, 0.0, 1.0)),
                             self._slack(agent.earliest_departure), progress, target_row, target_col)
        return peers.reshape(-1)

    def _assemble(self, handle, peers):
        base = self.base.get(handle)
        features = np.concatenate((base[:BASE_FEATURES], self._own_features(int(handle)), peers))
        if self.with_action_mask:
            return np.concatenate((features, base[BASE_FEATURES:BASE_FEATURES + self.ACTION_MASK_SIZE]))
        return features

    def get(self, handle: int = 0) -> np.ndarray:
        """Return 272 features, followed by the unchanged five-action mask."""
        self._refresh_topology()
        return self._assemble(handle, self._peer_features())

    def get_many(self, handles: Iterable[int] | None = None) -> dict[int, np.ndarray]:
        """Share only a batch-local peer snapshot, preserving same-step edits."""
        self._refresh_topology()
        peers = self._peer_features()
        selected = self._bound_env().get_agent_handles() if handles is None else handles
        return {handle: self._assemble(handle, peers) for handle in selected}
