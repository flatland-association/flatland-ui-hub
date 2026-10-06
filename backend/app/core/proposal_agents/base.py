"""Proposal-agent seam — the "KI" column of Plan / KI / Mensch.

A proposal agent answers "how would you run the trains from here?" with one or
more courses. It only **proposes**: the API simulates every course with the
same branch runner and scores it with the same figures as the plan and the
operator's choice, so no agent grades its own work and a new agent cannot
change how the comparison reads.

Engines behind this seam (plan: docs/plans/proposal-agents-roadmap.md):
  - Stage 2: Prioritized Planning replans over priority orders — built
    (`pp_replan`).
  - Stage 3: learning agents (MARL policies) — planned. They plug in here
    without touching the API or the `proposal-compare` widget.

This is the sibling of the tactical `InterventionRecommender` seam
(`app/core/recommenders`): that one assesses who is affected, this one proposes
what to do about it.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_trainrun_data_structures import TrainrunDict


@dataclass(frozen=True)
class Proposal:
    """One proposed course for the trains not yet arrived.

    ``trainruns`` is followed by `PlanPolicy`, both when the course is simulated
    and when the operator accepts it. ``priority`` is the order of trains the
    course gives way to — shown to the operator and sent back on accept, where
    `ProposalAgent.resolve` re-derives the same course from the then-current env.
    """

    priority: Tuple[int, ...]
    trainruns: TrainrunDict


class ProposalAgent(ABC):
    """Proposes courses for the current env state."""

    #: stable id; also the ``source`` of the ``ai`` variants in `/proposals`
    id: str = "base"
    #: short human label
    label: str = "Base"
    #: one-line description
    description: str = ""

    @abstractmethod
    def propose(self, env: RailEnv) -> List[Proposal]:
        """Distinct proposals for the current state, in no particular order.

        Empty when the agent has nothing to offer (no trains left, or no
        feasible course). Ranking is the caller's job.
        """
        raise NotImplementedError

    @abstractmethod
    def resolve(self, env: RailEnv, priority: Sequence[int]) -> Optional[TrainrunDict]:
        """The course for ``priority`` from the current state, for accepting it.

        ``None`` when no feasible course exists from here any more.
        """
        raise NotImplementedError
