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
    python -m lab.marl.evaluate --policy deadlock_avoidance \\
        --checkpoint app/policies/learned/checkpoints/ecml2026_ppo.pt \\
        --checkpoint lab/checkpoints/a.pt --checkpoint lab/checkpoints/b.pt

Every `--checkpoint` gets its own rows, named after the file (`ckpt:<stem>`),
next to the `--policy` rows; lab checkpoints also work as `--policy lab:<name>`.
`learned_ppo` without any `--checkpoint` runs the ECML checkpoint. A totals
block per policy closes the table.

`--dynamics on|both` runs each policy also with vehicle dynamics (the
Explore_hardware probe, docs/plans/train-dynamics-probe.md); those rows end in
`+dyn`. Needs the local dynamics port.
"""
from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from pathlib import Path

from flatland.envs.step_utils.states import TrainState

from app.policies.learned.learned_ppo_policy import DEFAULT_CHECKPOINT, LearnedPpoPolicy
from app.policies.registry import get_policy_spec
from app.core import train_dynamics
from lab.marl.common import make_env

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


CHECKPOINT_PREFIX = "ckpt:"


def make_policy(policy_id: str, env, checkpoints: dict[str, Path]):
    if policy_id in checkpoints:
        return LearnedPpoPolicy(env, checkpoint=checkpoints[policy_id])
    spec = get_policy_spec(policy_id)
    if spec is None:
        raise SystemExit(f"unknown policy {policy_id!r}")
    policy = spec.runtime_factory(env)
    policy.reset(env)
    return policy


def run(scenario: str, policy_id: str, checkpoints: dict[str, Path], dynamics: bool = False) -> Result:
    env = make_env(scenario)
    if dynamics and not train_dynamics.attach(env):
        raise SystemExit("--dynamics needs the local dynamics port (backend/vendor_local)")
    policy = make_policy(policy_id, env, checkpoints)
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
        policy=policy_id + ("+dyn" if dynamics else ""),
        arrived=sum(a is not None for a in arrivals.values()),
        trains=len(handles),
        delay=delay,
        steps=step,
        ms_per_step=1000 * elapsed / max(step, 1),
    )


def policy_rows(policies: list[str], checkpoint_files: list[Path]) -> tuple[list[str], dict[str, Path]]:
    """Row names in order, and which of them run a checkpoint file."""
    checkpoints: dict[str, Path] = {}
    rows: list[str] = []
    for pid in policies:
        if pid == "learned_ppo" and checkpoint_files:
            continue  # the explicit checkpoints replace it
        if pid == "learned_ppo":
            checkpoints[pid] = DEFAULT_CHECKPOINT
        rows.append(pid)
    for path in checkpoint_files:
        name = CHECKPOINT_PREFIX + Path(path).stem
        if name in checkpoints:
            raise SystemExit(f"two checkpoints named {Path(path).stem!r}; rename one")
        checkpoints[name] = Path(path)
        rows.append(name)
    return rows, checkpoints


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", action="append", help="preset id or gen:WxH:trains:seed (repeatable)")
    parser.add_argument("--policy", action="append", help="registry id, lab:<name> or learned_ppo (repeatable)")
    parser.add_argument("--checkpoint", type=Path, action="append", default=[],
                        help="a checkpoint file to compare (repeatable)")
    parser.add_argument("--dynamics", choices=["off", "on", "both"], default="off",
                        help="run with vehicle dynamics too (local port needed)")
    args = parser.parse_args()

    policies = args.policy or (DEFAULT_POLICIES if not args.checkpoint else DEFAULT_POLICIES[:2])
    rows, checkpoints = policy_rows(policies, args.checkpoint)
    variants = {"off": [False], "on": [True], "both": [False, True]}[args.dynamics]
    width = max([20] + [len(r) + 4 for r in rows])
    totals: dict[str, list[int]] = {}

    print(f"{'scenario':<26} {'policy':<{width}} {'arrived':>9} {'delay':>7} {'steps':>6} {'ms/step':>8}")
    for scenario in args.scenario or DEFAULT_SCENARIOS:
        for policy_id in rows:
            for dyn in variants:
                label = policy_id + ("+dyn" if dyn else "")
                try:
                    r = run(scenario, policy_id, checkpoints, dynamics=dyn)
                except Exception as exc:  # one broken pair must not hide the rest
                    print(f"{scenario:<26} {label:<{width}} error: {type(exc).__name__}: {exc}")
                    continue
                t = totals.setdefault(label, [0, 0, 0])
                t[0] += r.arrived
                t[1] += r.trains
                t[2] += r.delay
                print(f"{r.scenario:<26} {r.policy:<{width}} {f'{r.arrived}/{r.trains}':>9} "
                      f"{r.delay:>7} {r.steps:>6} {r.ms_per_step:>8.1f}")

    print()
    print(f"{'total':<26} {'policy':<{width}} {'arrived':>9} {'delay':>7}")
    for policy_id, (arrived, trains, delay) in totals.items():
        print(f"{'':<26} {policy_id:<{width}} {f'{arrived}/{trains}':>9} {delay:>7}")


if __name__ == "__main__":
    main()
