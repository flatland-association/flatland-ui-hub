"""Compare policies on the project's scenarios — how far does each one get?

docs/plans/marl-lab-plan.md, step 1 (and later step 3). Runs every policy on
every scenario to the end of the episode, with no human in the loop, and
prints one row per (scenario, policy):

    arrived   trains that reached their target / all trains
    delay     sum over trains of max(0, arrival - latest_arrival); a train that
              never arrives is charged the delay it had when the episode ended
    steps     steps until all arrived or the episode limit
    ms/step   policy + env time per step

Run from backend/:

    python -m lab.marl.evaluate                       # default scenarios and policies
    python -m lab.marl.evaluate --scenario olten --policy learned_ppo
    python -m lab.marl.evaluate --checkpoint lab/checkpoints/mine.pt
"""
from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from pathlib import Path

from flatland.envs.step_utils.states import TrainState

from app.core.env_factory import create_env
from app.policies.learned.learned_ppo_policy import DEFAULT_CHECKPOINT, LearnedPpoPolicy
from app.policies.registry import get_policy_spec

# Generated networks are named "gen:<width>x<height>:<trains>:<seed>".
DEFAULT_SCENARIOS = [
    "ecml2026-scene1-level0",
    "gen:30x30:3:42",
    "gen:36x24:7:42",
    "pf-ch-corridor",
    "pf-ch-wn-wal-conflict",
    "olten",
]
DEFAULT_POLICIES = ["deadlock_avoidance", "shortest_path", "learned_ppo"]


@dataclass
class Result:
    scenario: str
    policy: str
    arrived: int
    trains: int
    delay: int
    steps: int
    ms_per_step: float


def make_env(scenario: str):
    if scenario.startswith("gen:"):
        _, size, trains, seed = scenario.split(":")
        width, height = (int(v) for v in size.split("x"))
        return create_env(width=width, height=height, number_of_agents=int(trains), seed=int(seed))
    return create_env(scenario_preset_id=scenario)


def make_policy(policy_id: str, env, checkpoint: Path):
    if policy_id == "learned_ppo":
        return LearnedPpoPolicy(env, checkpoint=checkpoint)
    spec = get_policy_spec(policy_id)
    if spec is None:
        raise SystemExit(f"unknown policy {policy_id!r}")
    policy = spec.runtime_factory(env)
    policy.reset(env)
    return policy


def run(scenario: str, policy_id: str, checkpoint: Path) -> Result:
    env = make_env(scenario)
    policy = make_policy(policy_id, env, checkpoint)
    handles = env.get_agent_handles()
    limit = int(getattr(env, "_max_episode_steps", 0) or 500)
    arrivals: dict[int, int | None] = {h: None for h in handles}
    observations = {}

    t0 = time.perf_counter()
    step = 0
    for step in range(1, limit + 1):
        policy.start_step()
        actions = policy.act_many(handles, observations)
        observations, _, dones, _ = env.step(actions)
        policy.end_step()
        for h in handles:
            if arrivals[h] is None and env.agents[h].state == TrainState.DONE:
                arrivals[h] = step
        if dones.get("__all__") or all(a is not None for a in arrivals.values()):
            break
    elapsed = time.perf_counter() - t0

    delay = 0
    for h in handles:
        latest = getattr(env.agents[h], "latest_arrival", None)
        deadline = int(latest) if latest is not None else limit
        reference = arrivals[h] if arrivals[h] is not None else step
        delay += max(0, int(reference) - deadline)

    return Result(
        scenario=scenario,
        policy=policy_id,
        arrived=sum(a is not None for a in arrivals.values()),
        trains=len(handles),
        delay=delay,
        steps=step,
        ms_per_step=1000 * elapsed / max(step, 1),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", action="append", help="preset id or gen:WxH:trains:seed (repeatable)")
    parser.add_argument("--policy", action="append", help="registry id or learned_ppo (repeatable)")
    parser.add_argument("--checkpoint", type=Path, default=DEFAULT_CHECKPOINT)
    args = parser.parse_args()

    print(f"{'scenario':<26} {'policy':<20} {'arrived':>9} {'delay':>7} {'steps':>6} {'ms/step':>8}")
    for scenario in args.scenario or DEFAULT_SCENARIOS:
        for policy_id in args.policy or DEFAULT_POLICIES:
            try:
                r = run(scenario, policy_id, args.checkpoint)
            except Exception as exc:  # one broken pair must not hide the rest
                print(f"{scenario:<26} {policy_id:<20} error: {type(exc).__name__}: {exc}")
                continue
            print(f"{r.scenario:<26} {r.policy:<20} {f'{r.arrived}/{r.trains}':>9} "
                  f"{r.delay:>7} {r.steps:>6} {r.ms_per_step:>8.1f}")


if __name__ == "__main__":
    main()
