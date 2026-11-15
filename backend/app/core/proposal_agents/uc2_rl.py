"""Stage-3 proposal agent: the trained UC2 model (`uc2_rl`, one per infrastructure).

Plan: docs/plans/uc2-rl-proposal-agent.md. The seam's contract is a course as a
`TrainrunDict` followed by `PlanPolicy`, so the agent rolls the registered
`uc2_rl` runtime policy (the infrastructure's model with its joint ROAM check)
out on a copy of the current state and hands the trajectory back as trainruns:
one waypoint per cell entry, timed at the step the train is first seen in it,
the same shape as `app.planners.replan._to_trainruns`.

The model has no priority order, so its single course carries an empty one.
The API simulates and scores the course like every other; the agent never
grades itself.
"""
from __future__ import annotations

import copy
import importlib.util
from typing import List, Optional, Sequence

from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_trainrun_data_structures import TrainrunDict, TrainrunWaypoint, Waypoint

from app.core.proposal_agents.base import Proposal, ProposalAgent
from app.utils.agent_compat import agent_direction, agent_position

POLICY_ID = "uc2_rl"


class UC2RLProposalAgent(ProposalAgent):
    id = POLICY_ID
    label = "UC2 RL"
    description = "The trained UC2 model (one per infrastructure) runs every train on from the current state."

    def available(self, env: RailEnv) -> bool:
        from app.policies.learned import uc2_roam_bundle

        if importlib.util.find_spec("torch") is None or not uc2_roam_bundle.available():
            return False
        return uc2_roam_bundle.compatibility_error(env) is None

    def propose(self, env: RailEnv) -> List[Proposal]:
        trainruns = rollout_trainruns(env)
        return [Proposal(priority=(), trainruns=trainruns)] if trainruns else []

    def resolve(self, env: RailEnv, priority: Sequence[int]) -> Optional[TrainrunDict]:
        # Deterministic: the same state gives the same course; there is no order to honour.
        return rollout_trainruns(env) or None


def rollout_trainruns(env: RailEnv, horizon: Optional[int] = None) -> TrainrunDict:
    """The `uc2_rl` course from the current state of `env`, as trainruns.

    Runs on a deep copy: the session env is never stepped. Trains already done
    get no trainrun (nothing left to follow).
    """
    from app.policies.registry import create_runtime_policy

    fork = copy.deepcopy(env)
    policy = create_runtime_policy(POLICY_ID, fork)
    policy.reset(fork)
    start = int(getattr(fork, "_elapsed_steps", 0) or 0)
    limit = int(getattr(fork, "_max_episode_steps", 0) or 0) or start + 500
    if horizon is not None:
        limit = min(limit, start + int(horizon))
    runs: dict[int, list] = {int(a.handle): [] for a in fork.agents}
    finished = {int(a.handle) for a in fork.agents if getattr(a.state, "name", "") == "DONE"}

    def note(now: int) -> None:
        for agent in fork.agents:
            position = agent_position(agent)
            if position is None:
                continue
            cell = (int(position[0]), int(position[1]))
            run = runs[int(agent.handle)]
            if not run or run[-1].waypoint.position != cell:
                run.append(TrainrunWaypoint(scheduled_at=now, waypoint=Waypoint(cell, int(agent_direction(agent)))))

    note(start)
    while not (getattr(fork, "dones", None) or {}).get("__all__") and int(fork._elapsed_steps) < limit:
        policy.start_step()
        actions = policy.act_many(fork.get_agent_handles(), {})
        policy.end_step()
        fork.step(actions)
        note(int(fork._elapsed_steps))
    return {handle: run for handle, run in runs.items() if run and handle not in finished}
