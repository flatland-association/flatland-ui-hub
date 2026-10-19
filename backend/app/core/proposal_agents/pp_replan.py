"""Stage-2 proposal agent: Prioritized Planning over priority orders.

Not learning. Wraps the vendored `flatland-blackbox` PP solver
(`app.planners.replan`): with PP the priority order is the decision — who goes
first into a contested section — so each distinct order is one proposal.
"""
from __future__ import annotations

from typing import List, Optional, Sequence

from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_trainrun_data_structures import TrainrunDict

from app.core.proposal_agents.base import Proposal, ProposalAgent
from app.planners.replan import replan_from_state, replan_orders


class PPReplanAgent(ProposalAgent):
    id = "pp_replan"
    label = "PP replan"
    description = "Prioritized Planning from the current state, one proposal per distinct priority order."

    def propose(self, env: RailEnv) -> List[Proposal]:
        return [Proposal(priority=order, trainruns=trainruns) for order, trainruns in replan_orders(env)]

    def resolve(self, env: RailEnv, priority: Sequence[int]) -> Optional[TrainrunDict]:
        return replan_from_state(env, priority=tuple(int(h) for h in priority))
