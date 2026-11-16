"""Stage-3 proposal agent: the trained UC2 model (`uc2_rl`, one per infrastructure).

Plan: docs/plans/uc2-rl-proposal-agent.md. The seam's contract is a course as a
`TrainrunDict` followed by `PlanPolicy`, so the agent rolls the registered
`uc2_rl` runtime policy (the infrastructure's model with its joint ROAM check)
out on a copy of the current state and hands the trajectory back as trainruns:
one waypoint per cell entry, timed at the step the train is first seen in it,
the same shape as `app.planners.replan._to_trainruns`.

The handle-aware adviser also explores a bounded number of future branches
and short holds, then continues with the same frozen actor. Every intervention
passes through the whole-batch ROAM check before stepping. The model has no
priority order; the API independently replays and scores each complete course.
"""
from __future__ import annotations

import copy
import importlib.util
from dataclasses import dataclass
from typing import List, Optional, Sequence

from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_trainrun_data_structures import TrainrunDict, TrainrunWaypoint, Waypoint

from app.core.proposal_agents.base import Proposal, ProposalAgent
from app.core.native_env_cache import clear_native_environment_caches
from app.policies.learned.roam_check import predict_configuration
from app.utils.agent_compat import agent_direction, agent_position

POLICY_ID = "uc2_rl"
MAX_CANDIDATES = 8
MAX_BRANCH_POINTS = 2
WAIT_STEPS = (1, 3, 5)


@dataclass(frozen=True)
class _Intervention:
    kind: str
    handle: int
    step: int
    action: int
    wait_steps: int = 0

    @property
    def candidate_id(self) -> str:
        return f"uc2-rl:{self.kind}:{self.handle}:{self.step}:{self.action}:{self.wait_steps}"

    def metadata(self) -> dict:
        return dict(kind=self.kind, handle=self.handle, step=self.step,
                    action=self.action, wait_steps=self.wait_steps)


def _course_key(trainruns: TrainrunDict) -> tuple:
    """Deduplicate the executable courses, including waits and every train."""
    return tuple((int(h), tuple((int(w.scheduled_at), tuple(w.waypoint.position),
                                int(w.waypoint.direction)) for w in run))
                 for h, run in sorted(trainruns.items()))


def _fork_env(env: RailEnv) -> RailEnv:
    return copy.deepcopy(env)


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

    def propose_for(self, env: RailEnv, handle: int) -> List[Proposal]:
        handle = int(handle)
        if handle not in {int(a.handle) for a in env.agents}:
            return []
        greedy, opportunities = _rollout(env, discover_handle=handle)
        if not greedy:
            return []
        start = int(getattr(env, "_elapsed_steps", 0) or 0)
        proposals = [Proposal(priority=(), trainruns=greedy,
                              candidate_id=f"uc2-rl:rl:{handle}:{start}",
                              intervention=dict(kind="rl", handle=handle, step=start,
                                                action=None, wait_steps=0))]
        seen = {_course_key(greedy)}
        # Opportunities come from the future greedy trajectory, not just the
        # root action. Retain no fork environments between candidate rollouts.
        for intervention in opportunities[:MAX_CANDIDATES - 1]:
            trainruns, _ = _rollout(env, intervention=intervention)
            key = _course_key(trainruns)
            if not trainruns or key in seen:
                continue
            seen.add(key)
            proposals.append(Proposal(priority=(), trainruns=trainruns,
                                      candidate_id=intervention.candidate_id,
                                      intervention=intervention.metadata()))
        return proposals

    def resolve_for(self, env: RailEnv, priority: Sequence[int], handle: int,
                    candidate_id: str | None = None) -> Optional[TrainrunDict]:
        if candidate_id is None:
            return self.resolve(env, priority)
        return next((p.trainruns for p in self.propose_for(env, handle)
                     if p.candidate_id == candidate_id), None)


def rollout_trainruns(env: RailEnv, horizon: Optional[int] = None) -> TrainrunDict:
    """The `uc2_rl` course from the current state of `env`, as trainruns.

    Runs on a deep copy: the session env is never stepped. Trains already done
    get no trainrun (nothing left to follow).
    """
    return _rollout(env, horizon=horizon)[0]


def _opportunities(env, prepared, certified, handle, branch_cells, wait_found):
    """Find physically distinct, currently allowed future decisions only."""
    handles, observations, width = prepared
    agent = next(a for a in env.agents if int(a.handle) == handle)
    if getattr(agent.state, "name", "") == "DONE":
        return [], wait_found
    mask = observations[handles.index(handle), width:width + 5]
    current = agent.current_configuration
    baseline = predict_configuration(env, agent, int(certified[handle]))
    now = int(env._elapsed_steps)
    found = []
    moves = {}
    for action in (1, 2, 3):
        if mask[action] >= .5:
            desired = predict_configuration(env, agent, action)
            if desired is not None and desired != current:
                moves.setdefault(desired, action)
    # Different labels that enter the same cell are not route alternatives.
    if current is not None and len(moves) >= 2 and current not in branch_cells:
        if len(branch_cells) < MAX_BRANCH_POINTS:
            branch_cells.add(current)
            found.extend(_Intervention("branch", handle, now, action)
                         for desired, action in moves.items() if desired != baseline)
    if not wait_found and baseline is not None and baseline != current:
        action = 0 if current is None else 4
        if mask[action] >= .5 and predict_configuration(env, agent, action) == current:
            found.extend(_Intervention("wait", handle, now, action, ticks) for ticks in WAIT_STEPS)
            wait_found = True
    return found, wait_found


def _rollout(env: RailEnv, horizon: Optional[int] = None,
             intervention: _Intervention | None = None,
             discover_handle: int | None = None) -> tuple[TrainrunDict, list[_Intervention]]:
    from app.policies.registry import create_runtime_policy

    fork = policy = None
    try:
        fork = _fork_env(env)
        # A forecast cannot see future random live effects. Preset incident
        # files remain unchanged; already active malfunctions travel in agents.
        if getattr(env, "_live_seed", None) is not None:
            from flatland.envs import malfunction_effects_generators as mfg
            from flatland.envs.malfunction_generators import NoMalfunctionGen
            quiet = NoMalfunctionGen()
            fork.malfunction_generator = quiet
            fork.malfunction_process_data = quiet.get_process_data()
            fork.effects_generator = mfg.MalfunctionEffectsGenerator(quiet)
        policy = create_runtime_policy(POLICY_ID, fork)
        policy.reset(fork)
        start = int(getattr(fork, "_elapsed_steps", 0) or 0)
        limit = int(getattr(fork, "_max_episode_steps", 0) or 0) or start + 500
        if horizon is not None:
            limit = min(limit, start + max(0, int(horizon)))
        runs: dict[int, list] = {int(a.handle): [] for a in fork.agents}
        finished = {int(a.handle) for a in fork.agents if getattr(a.state, "name", "") == "DONE"}
        opportunities, branch_cells, wait_found = [], set(), False
        applied = 0

        def note(now: int) -> None:
            for agent in fork.agents:
                position = agent_position(agent)
                if position is None:
                    continue
                cell = (int(position[0]), int(position[1]))
                run = runs[int(agent.handle)]
                if not run or run[-1].waypoint.position != cell:
                    run.append(TrainrunWaypoint(scheduled_at=now,
                               waypoint=Waypoint(cell, int(agent_direction(agent)))))

        note(start)
        while not (getattr(fork, "dones", None) or {}).get("__all__") and int(fork._elapsed_steps) < limit:
            now = int(fork._elapsed_steps)
            policy.start_step()
            prepared = policy.prepare_inference(fork.get_agent_handles())
            raw = policy.infer_prepared(prepared)
            forcing = intervention is not None and intervention.step <= now < (
                intervention.step + (intervention.wait_steps or 1))
            if forcing:
                handles, observations, width = prepared
                mask = observations[handles.index(intervention.handle), width:width + 5]
                if mask[intervention.action] < .5:
                    return {}, []
                if now == intervention.step and int(raw[intervention.handle]) == intervention.action:
                    return {}, []
                raw[intervention.handle] = intervention.action
            actions = policy.finalize_actions(raw)
            if forcing:
                if int(actions[intervention.handle]) != intervention.action:
                    return {}, []  # Joint certificate withdrew this alternative.
                if intervention.kind == "branch" and policy.roam_check.last_predictions[
                    intervention.handle
                ] == fork.agents[intervention.handle].current_configuration:
                    return {}, []  # Native MotionCheck blocks the requested move.
                applied += 1
            if discover_handle is not None:
                discovered, wait_found = _opportunities(fork, prepared, actions,
                                                       discover_handle, branch_cells, wait_found)
                opportunities.extend(discovered)
            policy.end_step()
            previous = (fork.agents[intervention.handle].current_configuration
                        if forcing and intervention.kind == "branch" else None)
            fork.step(actions)
            if (forcing and intervention.kind == "branch"
                    and fork.agents[intervention.handle].current_configuration == previous
                    and getattr(fork.agents[intervention.handle].state, "name", "") != "DONE"):
                return {}, []  # A newly starting native fault can cancel entry.
            note(int(fork._elapsed_steps))
        if intervention is not None and applied != (intervention.wait_steps or 1):
            return {}, []
        return ({handle: run for handle, run in runs.items() if run and handle not in finished},
                opportunities)
    finally:
        # Native self-keyed LRUs otherwise retain every disposed candidate map.
        # No fork, observation builder or policy is cached by this adviser.
        policy = fork = None
        clear_native_environment_caches()
