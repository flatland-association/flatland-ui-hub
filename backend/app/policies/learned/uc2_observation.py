"""Current-state observations for the five native Plan B UC2/tutorial fixtures.

The first 272 features retain the PF-CH context layout, with coordinates
normalised by the actual environment dimensions. The 41 appended features are
five scenario indicators, normalised height/width, own speed/cell progress and
sixteen fixed handle slots of speed/cell progress. The five native action-mask
values remain last. Scheduled future malfunctions and teacher plans are never
read. Fixture identity uses current rail and the stock's immutable mission
geometry, so timetable shifts and current malfunctions remain observable data.
"""
from __future__ import annotations

import hashlib
import json

import numpy as np
from flatland.envs.rail_env import RailEnv

from app.policies.learned.pf_ch_observation import (
    MAX_TRAINS,
    PFChObservationBuilder,
)
from app.policies.learned.pf_ch_observation import (
    OBSERVATION_DIM as CONTEXT_DIM,
)
from app.utils.agent_compat import agent_initial_direction, agent_initial_position

OBSERVATION_SCHEMA = "uc2-context-v1"
SCENARIO_IDS = ("uc2-1", "uc2-2", "uc2-3", "uc2-4", "tutorial")
SCENARIO_OFFSET = CONTEXT_DIM
GEOMETRY_OFFSET = SCENARIO_OFFSET + len(SCENARIO_IDS)
OWN_MOTION_OFFSET = GEOMETRY_OFFSET + 2
PEER_MOTION_OFFSET = OWN_MOTION_OFFSET + 2
MOTION_FEATURES = 2
OBSERVATION_DIM = PEER_MOTION_OFFSET + MAX_TRAINS * MOTION_FEATURES
GEOMETRY_SCALE = (8.0, 78.0)

_UC2_RAIL = "200caaee49c59419f20a07f96b569c2ea305d6c804d3ab0305f9e5bcd36e2226"
_UC2_STOCK = "533956cf1c3d91ae2a5970089ede9bb9892454a1b650d3b90055aec1f08c57a6"
_FIXTURES = {
    (8, 78, 168): ("uc2-1", _UC2_RAIL, _UC2_STOCK),
    (8, 78, 102): ("uc2-2", _UC2_RAIL,
                   "35bd0971651f6624281aadcc5e2ba2a044095c818a8f2a24dbfc1abe9a2944bb"),
    (8, 78, 240): ("uc2-3", _UC2_RAIL, _UC2_STOCK),
    (8, 78, 180): ("uc2-4", _UC2_RAIL, _UC2_STOCK),
    (6, 25, 40): ("tutorial", "4bdbfd7e33c7f45ac7446b39a35f67f1a4491b3628f6bc4f532a5306cf36b7d2",
                   "89abaaa386e9664cf493ff0ac43ef1486ffebdbad38691ae4595af464633f29f"),
}


def _stock_fingerprint(env: RailEnv) -> str:
    stock = [{"handle": int(agent.handle),
              "initial": [list(agent_initial_position(agent)), int(agent_initial_direction(agent))],
              "waypoints": [[[list(waypoint.position), int(waypoint.direction)] for waypoint in group]
                            for group in agent.waypoints]}
             for agent in env.agents]
    return hashlib.sha256(json.dumps(stock, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class UC2ObservationBuilder(PFChObservationBuilder):
    """Reuse the service/context layout on explicitly identified UC2 fixtures."""

    OBSERVATION_SCHEMA = OBSERVATION_SCHEMA
    OBSERVATION_DIM = OBSERVATION_DIM

    def __init__(self, max_depth: int = 3, with_action_mask: bool = True) -> None:
        super().__init__(max_depth=max_depth, with_action_mask=with_action_mask)
        self.schema = OBSERVATION_SCHEMA
        self.scenario_id: str | None = None

    def reset(self, env: RailEnv | None = None) -> None:
        """Bind only known native rail/stock/horizon identities; keep PF-CH strict."""
        self.scenario_id = None
        if env is not None:
            self.env = env
        environment = self._bound_env()
        key = (int(environment.height), int(environment.width), int(environment._max_episode_steps or 0))
        fixture = _FIXTURES.get(key)
        if fixture is None:
            raise ValueError("uc2-context-v1 requires a supported native UC2/tutorial fixture")
        handles = [int(agent.handle) for agent in environment.agents]
        expected_trains = 2 if fixture[0] == "tutorial" else 3
        if handles != list(range(expected_trains)):
            raise ValueError("uc2-context-v1 requires the native fixture's ordered train handles")
        grid = np.asarray(environment.rail.grid)
        if (grid.shape != key[:2] or not np.issubdtype(grid.dtype, np.integer)
                or np.any(grid < 0) or np.any(grid > 65535)):
            raise ValueError("uc2-context-v1 requires a valid native rail grid")
        rail_hash = hashlib.sha256(np.asarray(grid, dtype="<u2").tobytes()).hexdigest()
        if rail_hash != fixture[1] or _stock_fingerprint(environment) != fixture[2]:
            raise ValueError("uc2-context-v1 requires the native fixture's rail and stock geometry")
        self.scenario_id = fixture[0]
        self.base.reset(environment)
        self._rail_state = self._rail_snapshot()

    @staticmethod
    def _motion(agent) -> tuple[float, float]:
        # Flatland 4.3's public distance property is the fraction traversed in
        # the current cell; speed may be a Fraction such as UC2-3's 3/5.
        speed = float(agent.speed_counter.speed)
        fraction = float(agent.speed_counter.distance)
        if not np.isfinite((speed, fraction)).all() or not 0 <= speed <= 1 or not 0 <= fraction <= 1:
            raise ValueError("uc2-context-v1 requires finite native speed/cell progress in 0..1")
        return speed, fraction

    def _assemble(self, handle, peers):
        if self.scenario_id is None:
            raise ValueError("uc2-context-v1 must be reset before observation")
        context = super()._assemble(handle, peers)
        environment = self._bound_env()
        scenario = np.zeros(len(SCENARIO_IDS), dtype=np.float32)
        scenario[SCENARIO_IDS.index(self.scenario_id)] = 1.0
        geometry = np.asarray((environment.height, environment.width), dtype=np.float32) / GEOMETRY_SCALE
        motion = np.zeros((MAX_TRAINS, MOTION_FEATURES), dtype=np.float32)
        for agent in environment.agents:
            motion[int(agent.handle)] = self._motion(agent)
        features = np.concatenate((context[:CONTEXT_DIM], scenario, geometry,
                                   motion[int(handle)], motion.reshape(-1))).astype(np.float32, copy=False)
        if self.with_action_mask:
            return np.concatenate((features, context[CONTEXT_DIM:CONTEXT_DIM + self.ACTION_MASK_SIZE]))
        return features
