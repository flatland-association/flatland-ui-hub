"""Rewards and scores of the online learner — docs/plans/online-ppo-learning.md.

Two different things, deliberately kept apart:

- **PPO reward** (`ShapedReward`): what the learner's own rollout steps earn.
  The same shaping as the offline trainer (`lab/marl/train_ppo.py`), so both
  optimise the same thing: +1 on arrival minus 0.01 per step late (at most
  0.5), +0.01 per cell of progress, −0.002 per step on the way, −0.5 for not
  arriving by the end of the episode.
- **Multi-objective score** (`fork_score`, `episode_score`): how good the
  outcome of a fork or an evaluation episode is. It decides which candidate
  action is best and whether a new version is accepted. It is never a PPO
  reward, and an action nobody executed or forked never gets one.

Fork score over the horizon (weights in `FORK_WEIGHTS`):

    punctuality   Flatland's own reward summed over the horizon (DefaultRewards)
    arrivals      trains that reached their target
    delay         growth of the summed lateness against latest_arrival
    waiting       train-steps standing (stopped, or ready and allowed to leave)
    manual        −1 when the candidate is a human override

Hard constraint: a fork that ends with more trains deadlocked
(`count_deadlocked_agents`) than at its start is infeasible. It is kept in the
counterfactual buffer but can never be chosen as best — a learner must not buy
punctuality with a deadlock.
"""
from __future__ import annotations

import math
from typing import Optional

from flatland.envs.step_utils.states import TrainState

from app.core.scenario_runner import count_deadlocked_agents

# PPO shaping — same constants as lab/marl/train_ppo.py
ARRIVAL_BONUS = 1.0
LATE_PENALTY_PER_STEP = 0.01
LATE_PENALTY_CAP = 0.5
PROGRESS_PER_CELL = 0.01
TIME_COST = 0.002
NOT_ARRIVED_PENALTY = 0.5

FORK_WEIGHTS = {
    "punctuality": 0.01,
    "arrivals": 1.0,
    "delay": -0.02,
    "waiting": -0.005,
    "manual": -0.05,
}


def _distance(env, dist_map, handle: int) -> Optional[float]:
    agent = env.agents[handle]
    if agent.state == TrainState.DONE:
        return 0.0
    position = agent.position if agent.position is not None else agent.initial_position
    direction = agent.direction if agent.position is not None else agent.initial_direction
    if position is None or direction is None:
        return None
    value = float(dist_map[handle, position[0], position[1], int(direction)])
    return value if math.isfinite(value) else None


class ShapedReward:
    """Per-train PPO reward for one episode."""

    def __init__(self, env):
        self.env = env
        self.dist_map = env.distance_map.get()
        self.arrived = {a.handle: a.state == TrainState.DONE for a in env.agents}
        self.distance = {a.handle: _distance(env, self.dist_map, a.handle) for a in env.agents}

    def step(self, step: int) -> dict[int, float]:
        rewards = {}
        for agent in self.env.agents:
            h = agent.handle
            if self.arrived[h]:
                continue
            reward = 0.0
            if agent.state == TrainState.DONE:
                self.arrived[h] = True
                latest = getattr(agent, "latest_arrival", None)
                late = max(0, step - int(latest)) if latest is not None else 0
                reward += ARRIVAL_BONUS - min(LATE_PENALTY_CAP, LATE_PENALTY_PER_STEP * late)
            new = _distance(self.env, self.dist_map, h)
            if self.distance[h] is not None and new is not None:
                reward += PROGRESS_PER_CELL * max(-1.0, min(1.0, self.distance[h] - new))
            self.distance[h] = new
            if agent.state not in (TrainState.WAITING, TrainState.DONE):
                reward -= TIME_COST
            rewards[h] = reward
        return rewards

    def episode_end(self) -> dict[int, float]:
        return {h: -NOT_ARRIVED_PENALTY for h, done in self.arrived.items() if not done}


# ── outcome measures ────────────────────────────────────────────────────

def total_lateness(env) -> int:
    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    total = 0
    for agent in env.agents:
        latest = getattr(agent, "latest_arrival", None)
        if latest is None:
            continue
        if agent.state == TrainState.DONE:
            reached = getattr(agent, "arrival_time", None)
            reached = int(reached) if reached is not None else now
        else:
            reached = now
        total += max(0, reached - int(latest))
    return total


def arrived_count(env) -> int:
    return sum(a.state == TrainState.DONE for a in env.agents)


def waiting_count(env) -> int:
    now = int(getattr(env, "_elapsed_steps", 0) or 0)
    return sum(
        a.state == TrainState.STOPPED
        or (a.state == TrainState.READY_TO_DEPART and a.earliest_departure <= now)
        for a in env.agents
    )


def snapshot(env) -> dict:
    return {
        "arrived": arrived_count(env),
        "lateness": total_lateness(env),
        "deadlocked": count_deadlocked_agents(env),
    }


def fork_score(before: dict, after: dict, waiting: int, flatland_reward: float, manual: bool = False) -> tuple[dict, float, bool]:
    components = {
        "punctuality": round(flatland_reward, 3),
        "arrivals": after["arrived"] - before["arrived"],
        "delay": after["lateness"] - before["lateness"],
        "waiting": waiting,
        "manual": 1 if manual else 0,
        "new_deadlocks": max(0, after["deadlocked"] - before["deadlocked"]),
    }
    score = sum(FORK_WEIGHTS[k] * components[k] for k in FORK_WEIGHTS)
    feasible = components["new_deadlocks"] == 0
    return components, round(score, 4), feasible


def episode_score(arrived: int, trains: int, lateness: int, deadlocked: int) -> float:
    """Evaluation score of one finished episode: arrival rate, minus lateness
    per train (scaled), minus the share of deadlocked trains."""
    trains = max(trains, 1)
    return round(arrived / trains - 0.001 * lateness / trains - 0.2 * deadlocked / trains, 4)
