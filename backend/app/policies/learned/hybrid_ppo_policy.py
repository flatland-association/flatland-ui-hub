"""The learned PPO with Deadlock Avoidance as a safety net (MARL lab).

docs/plans/marl-lab-plan.md, "PPO + DLA hybrid". The ECML PPO solves its own
topology but deadlocks on single-track corridors, where DLA does not. This
wrapper lets the PPO keep its decisions and hands the one it gets wrong to DLA:

- **DLA veto.** When the PPO wants MOVE_FORWARD for a train on the map, the
  train takes DLA's action instead: forward along DLA's shortest path when the
  track ahead is free of oncoming trains, STOP_MOVING when it is not. A moving
  train's DO_NOTHING counts as MOVE_FORWARD too (Flatland keeps it moving; the
  ECML PPO picks it often, and it would slip past the veto otherwise). STOP,
  LEFT, RIGHT and a stopped train's DO_NOTHING stay the PPO's.
- **Decision-point gating** (optional). The PPO decides only on a switch or one
  cell before one (FastTreeObs obs[7] / obs[8]); everywhere else the train gets
  MOVE_FORWARD, which the veto then turns into DLA's action.

Idea, not code, from Adrian Egli's flatland_solver_policy
(example/flatland_rail_env/example_flatland_tree_observation_exp001.py,
DecisionPointPPOPolicy). That repository has no licence, so this is our own
implementation.

Subclasses LearnedPpoPolicy, so `last_action_probs` (the lab's AI choice) and
`intervention_features` (the intervention log) still describe the PPO's own
distribution; the features add what the hybrid made of it.

**Measured 2026-10-20, not registered:** it beats the plain PPO (46 → up to 70
of 90 trains) but DLA alone (85/90) beats every variant, and every variant
loses the PPO's own ECML scene. Kept for the lab: `python -m lab.marl.evaluate
--policy hybrid:<flags>`. Numbers in the plan.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, Optional

from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.step_utils.states import TrainState

from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy
from app.policies.learned.learned_ppo_policy import DEFAULT_CHECKPOINT, LearnedPpoPolicy
from app.utils.agent_compat import agent_position


def _as_int(action) -> int:
    # RailEnvActions is a plain Enum in flatland-rl 4.2.x, not an IntEnum.
    return int(getattr(action, "value", action))


FORWARD = _as_int(RailEnvActions.MOVE_FORWARD)
DO_NOTHING = _as_int(RailEnvActions.DO_NOTHING)
TURNS = (_as_int(RailEnvActions.MOVE_LEFT), _as_int(RailEnvActions.MOVE_RIGHT))


class HybridPpoDlaPolicy(LearnedPpoPolicy):
    def __init__(self, env: Optional[RailEnv] = None, checkpoint: Path = DEFAULT_CHECKPOINT,
                 gate_decisions: bool = False, veto_departures: bool = False,
                 veto_do_nothing: bool = True, veto_turns: bool = False):
        self.gate_decisions = gate_decisions
        self.veto_do_nothing = veto_do_nothing
        # Lab diagnostic: LEFT and RIGHT go to DLA too, so the PPO can only
        # hold a train. Separates the PPO's stops from its routing.
        self.veto_turns = veto_turns
        # Off by default: the veto covers on-map trains only. A departure onto
        # a single-track section is the other way into a corridor deadlock, so
        # the lab measures it too.
        self.veto_departures = veto_departures
        self.dla = DeadLockAvoidancePolicy()
        self._env: Optional[RailEnv] = None
        self.last_ppo_actions: Dict[int, int] = {}
        self.last_sources: Dict[int, str] = {}
        super().__init__(env, checkpoint=checkpoint)

    def reset(self, env: RailEnv) -> None:
        super().reset(env)
        self._env = env
        self.dla.reset(env)
        self.last_ppo_actions = {}
        self.last_sources = {}

    def start_step(self, train: bool = False) -> None:
        self.dla.start_step()

    def act_many(self, handles, observations=None, **kwargs):
        handles = list(handles)
        ppo = super().act_many(handles, observations, **kwargs)
        if not handles:
            return ppo
        dla = self.dla.act_many(handles, None)
        actions: Dict[int, int] = {}
        for h in handles:
            action, source = ppo[h], "ppo"
            obs = self.last_observations[h]
            if self.gate_decisions and not (obs[7] or obs[8]):
                action, source = FORWARD, "gate"
            agent = self._env.agents[h]
            on_map = agent_position(agent) is not None
            goes_on = action == FORWARD or (
                self.veto_do_nothing and action == DO_NOTHING and agent.state == TrainState.MOVING
            ) or (self.veto_turns and action in TURNS)
            if goes_on and (on_map or self.veto_departures):
                action, source = _as_int(dla[h]), "dla"
            actions[h] = action
            self.last_sources[h] = source
        self.last_ppo_actions = dict(ppo)
        return actions

    def intervention_features(self, handle: int) -> Optional[dict]:
        features = super().intervention_features(handle)
        if features is None:
            return None
        features["ppo_action"] = self.last_ppo_actions.get(handle)
        features["hybrid_source"] = self.last_sources.get(handle)
        return features

    def get_name(self) -> str:
        parts = (["veto"] + (["gate"] if self.gate_decisions else [])
                 + (["dep"] if self.veto_departures else [])
                 + ([] if self.veto_do_nothing else ["forward-only"])
                 + (["turns"] if self.veto_turns else []))
        return f"HybridPpoDlaPolicy({self.checkpoint.stem}, {'+'.join(parts)})"
