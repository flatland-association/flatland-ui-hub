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
    family = "search-based"
    deterministic = True
    role = "operational"
    observation = "RailEnv transition graph (row, col, heading)"
    at_conflict = (
        "The priority order is the decision: trains are planned one after another, each "
        "around the cells already reserved by those before it. Every distinct order of "
        "the trains still running is one proposal; trains standing with a malfunction "
        "keep their cell reserved while they stand."
    )
    provenance = (
        "AI4REALNET/flatland-blackbox PP solver, vendored unchanged in app/planners/blackbox/; "
        "the live-episode glue (start from the current state, intermediate stops, "
        "physical occupancy) is app/planners/replan.py."
    )
    licence = "MIT (flatland-blackbox)"
    grounding = (
        "The consortium's canonical CBS/PP solver; T3.4 token-based directives — "
        "negotiate one order, not per-train commands."
    )
    used_in = (
        "Contention strategies pp and priority (app/core/contention_strategies.py)",
        "Timed reroute of one train against the others' forecast (plan_train_against)",
    )

    def propose(self, env: RailEnv) -> List[Proposal]:
        return [Proposal(priority=order, trainruns=trainruns) for order, trainruns in replan_orders(env)]

    def resolve(self, env: RailEnv, priority: Sequence[int]) -> Optional[TrainrunDict]:
        return replan_from_state(env, priority=tuple(int(h) for h in priority))
