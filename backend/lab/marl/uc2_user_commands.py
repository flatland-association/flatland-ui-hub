"""User commands on UC2 trains, runtime-identical rollouts and verified corrections.

Study participants can hold a train (sticky STOP until released) or force a
one-shot LEFT/FORWARD/RIGHT/DO_NOTHING at its next decision point. This module
replays such commands through the real ``override_manager`` and
``OverridePolicy`` while ``UC2RoamPolicy`` drives, in the live order:

    model proposal -> optional correction -> ROAM ``finalize_actions`` -> user overrides

It also searches *verified* one-step corrections for episodes the driver
fails: the label is an alternative ROAM-allowed action for one policy-driven
train after which the whole episode, user commands included, completes.

See docs/plans/uc2-rl-user-command-recovery.md.
"""
from __future__ import annotations

import itertools
import random
import uuid
import zlib
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import numpy as np
from flatland.envs.step_utils.states import TrainState

from app.core.native_env_cache import clear_native_environment_caches
from app.core.override_manager import override_manager
from app.policies.learned.learned_ppo_policy import N_ACTIONS
from app.policies.learned.uc2_roam_policy import UC2RoamPolicy
from app.policies.override_policy import OverridePolicy
from app.policies.registry import create_runtime_policy
from lab.marl.pf_ch_episode import PFChCase, PFChEpisode

NOTHING, LEFT, FORWARD, RIGHT, STOP = 0, 1, 2, 3, 4
ACTION_NAMES = {NOTHING: "DO_NOTHING", LEFT: "LEFT", FORWARD: "FORWARD", RIGHT: "RIGHT", STOP: "STOP"}
UC2_MAPS = ("tutorial", "uc2-1", "uc2-2", "uc2-3", "uc2-4")


@dataclass(frozen=True)
class Command:
    """One user command: ``stop`` holds ``value`` applied steps; ``turn`` forces action ``value`` once."""

    handle: int
    kind: str
    value: int
    step: int

    def __post_init__(self) -> None:
        if self.kind not in ("stop", "turn"):
            raise ValueError("command kind must be 'stop' or 'turn'")
        if self.kind == "turn" and self.value not in (NOTHING, LEFT, FORWARD, RIGHT):
            raise ValueError("turn commands force DO_NOTHING, LEFT, FORWARD or RIGHT")
        if self.kind == "stop" and self.value <= 0:
            raise ValueError("a STOP is held for a positive number of steps")

    @property
    def action(self) -> int:
        return STOP if self.kind == "stop" else self.value

    def label(self) -> str:
        what = f"STOP {self.value} steps" if self.kind == "stop" else ACTION_NAMES[self.value]
        return f"T{self.handle} {what} @{self.step}"


def commands_to_json(commands: Iterable[Command]) -> list[dict]:
    return [asdict(c) for c in commands]


def commands_from_json(payload: Iterable[dict]) -> tuple[Command, ...]:
    return tuple(Command(**dict(c)) for c in payload)


def command_sets(n_trains: int, nominal_steps: int, *, stops: Iterable[int], fractions: Iterable[float],
                 chaos: int, chaos_seed: int, pair_stop: int) -> list[tuple[Command, ...]]:
    """Single commands per train and start time, pairs on two trains, and chaotic 3-command sequences."""
    singles = [("stop", d) for d in stops] + [("turn", a) for a in (LEFT, FORWARD, RIGHT, NOTHING)]
    pair_kinds = [("stop", pair_stop), ("turn", LEFT), ("turn", RIGHT)]
    starts = sorted({int(f * nominal_steps) for f in fractions})
    out: list[tuple[Command, ...]] = []
    for t in starts:
        out += [(Command(h, k, v, t),) for h in range(n_trains) for k, v in singles]
        out += [(Command(a, k, v, t), Command(b, k, v, t))
                for a, b in itertools.combinations(range(n_trains), 2) for k, v in pair_kinds]
    rng = random.Random(chaos_seed)
    for _ in range(chaos):
        seq = []
        for _ in range(3):
            kind, value = rng.choice(singles)
            seq.append(Command(rng.randrange(n_trains), kind, value,
                               rng.randrange(0, max(1, int(0.8 * nominal_steps)))))
        out.append(tuple(sorted(seq, key=lambda c: c.step)))
    return out


def training_command_sets(preset: str, n_trains: int, nominal_steps: int) -> list[tuple[Command, ...]]:
    """Disjoint in durations, start times and chaos seed from the held-out suite."""
    return command_sets(n_trains, nominal_steps, stops=(3, 10, 25, 60), fractions=(0.05, 0.15, 0.3, 0.5, 0.7, 0.9),
                        chaos=40, chaos_seed=zlib.crc32(f"train:{preset}".encode()), pair_stop=10)


class CommandSchedule:
    """Issue and release commands on ``override_manager`` exactly like a participant would.

    A STOP is issued at its step, counts held steps from the first step on which it
    is applied at a decision point, and is cleared after ``value`` applied steps. A
    turn is consumed by ``OverridePolicy`` at the next decision point.
    """

    def __init__(self, commands: Iterable[Command], session_id: str):
        self.commands = tuple(commands)
        self.session_id = session_id
        self.applied_at: dict[int, int] = {}
        self.pending: set[int] = set()
        self.effective = False

    def before_step(self, now: int) -> None:
        for c in self.commands:
            if now == c.step:
                override_manager.set(self.session_id, c.handle, c.action)
                self.applied_at.pop(c.handle, None)
                self.pending.add(c.handle)
        for c in self.commands:
            if (c.kind == "stop" and now >= c.step and c.handle in self.applied_at and c.handle in self.pending
                    and now - self.applied_at[c.handle] >= c.value
                    and override_manager.get(self.session_id, c.handle) == STOP):
                override_manager.clear(self.session_id, c.handle)
                self.pending.discard(c.handle)

    def after_step(self, now: int, sources: dict, proposed: dict, env) -> None:
        for c in self.commands:
            if now < c.step or sources.get(c.handle) != "override":
                continue
            self.applied_at.setdefault(c.handle, now)
            if proposed.get(c.handle) is not None and _int(proposed[c.handle]) != c.action:
                self.effective = True
            if c.kind == "turn":
                self.pending.discard(c.handle)
        for h in list(self.pending):  # a train that finished never meets its command
            if env.agents[h].state == TrainState.DONE:
                self.pending.discard(h)

    def release_step_passed(self, now: int) -> bool:
        return not self.pending and all(now >= c.step for c in self.commands)


def _int(action) -> int:
    return int(getattr(action, "value", action))


def checkpoint_driver(checkpoint: Path):
    """Factory for a UC2RoamPolicy on one explicit checkpoint (no specialist lookup)."""
    def make(env):
        policy = UC2RoamPolicy(checkpoint=Path(checkpoint), specialists=False)
        builder = policy.build_observation_builder()
        builder.reset(env)
        env.obs_builder = builder
        return policy
    return make


def runtime_driver(env):
    """The registered ``uc2_rl`` runtime (current shipped specialists)."""
    return create_runtime_policy("uc2_rl", env)


def run_episode(case: PFChCase, make_policy, commands: Iterable[Command] = (), *,
                corrections: dict[tuple[int, int], int] | None = None, dla_from: int | None = None,
                record: bool = False) -> tuple[dict, list[dict]]:
    """Roll one episode out in the live order and return (result, records).

    ``corrections`` maps (step, handle) to an action that replaces the model's
    proposal before ROAM, only if the ROAM-masked action set allows it.
    ``dla_from`` hands every train to deadlock_avoidance from that step on, with
    the user's commands still in force. ``record`` returns every multi-choice,
    policy-sourced decision: features, ROAM-masked mask, proposal, final action.
    """
    corrections = corrections or {}
    episode = PFChEpisode(case, observation_schema="uc2-context-v1")
    sid = f"uc2-cmd-{uuid.uuid4().hex[:10]}"
    schedule = CommandSchedule(commands, sid)
    records: list[dict] = []
    applied: list[tuple[int, int, int]] = []
    driver = OverridePolicy(make_policy(episode.env), sid)
    driver.reset(episode.env)
    roam = driver.default_policy
    dla = None
    try:
        while not episode.done:
            now = episode.now
            handles = list(episode.handles)
            schedule.before_step(now)
            if dla_from is not None and now >= dla_from:
                if dla is None:
                    dla = OverridePolicy(create_runtime_policy("deadlock_avoidance", episode.env), sid)
                    dla.reset(episode.env)
                dla.start_step()
                actions = dla.act_many(handles, {})
                dla.end_step()
                sources, proposed = dla.last_sources, dla.last_proposed
            else:
                driver.start_step()
                prepared = roam.prepare_inference(handles)
                selected, obs, width = prepared
                proposals = dict(roam.infer_prepared(prepared))
                index = {h: i for i, h in enumerate(selected)}
                for (step, h), action in corrections.items():
                    if step == now and h in index and obs[index[h], width + action] >= .5:
                        proposals[h] = action
                        applied.append((step, h, action))
                final = roam.finalize_actions(proposals)
                actions = driver.apply_overrides(handles, final)
                driver.end_step()
                sources, proposed = driver.last_sources, driver.last_proposed
                if record:
                    for h, i in index.items():
                        mask = obs[i, width:width + N_ACTIONS]
                        if sources.get(h) == "policy" and int(np.count_nonzero(mask >= .5)) > 1:
                            records.append({"step": now, "handle": h, "obs": obs[i, :width].copy(),
                                            "mask": mask.copy(), "proposal": _int(proposals[h]),
                                            "final": _int(final[h])})
            episode.step({h: _int(a) for h, a in actions.items()})
            schedule.after_step(now, sources, proposed, episode.env)
        metrics = episode.metrics()
    finally:
        override_manager.clear_all(sid)
        episode.close()
        clear_native_environment_caches()
    result = {"solved": bool(metrics["arrived"] == metrics["total"]), "arrived": metrics["arrived"],
              "trains": metrics["total"], "complete_mission": bool(metrics["complete_mission"]),
              "lateness": int(metrics["lateness"]), "steps": int(metrics["steps"]),
              "effective": schedule.effective, "corrections_applied": applied}
    return result, records


def find_corrections(case: PFChCase, make_policy, commands: tuple[Command, ...], *,
                     max_corrections: int = 6) -> dict | None:
    """Search verified one-step corrections that let the driver complete the episode.

    Returns {"corrections", "result", "records"} or None when the driver already
    completes, DLA cannot finish from the start, or no correction chain is found.
    """
    base, _ = run_episode(case, make_policy, commands)
    if base["solved"] or not base["effective"]:
        return None
    corrections: dict[tuple[int, int], int] = {}
    for _ in range(max_corrections):
        result, records = run_episode(case, make_policy, commands, corrections=corrections, record=True)
        if result["solved"]:
            return {"corrections": corrections, "result": result, "records": records, "baseline": base}

        def dla_finishes(t: int) -> bool:
            return run_episode(case, make_policy, commands, corrections=corrections, dla_from=t)[0]["solved"]

        floor = max([s for s, _ in corrections] + [-1]) + 1
        if not dla_finishes(floor):
            return None
        lo, hi = floor, result["steps"]  # dla_finishes(lo) holds; find the last such step
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if dla_finishes(mid):
                lo = mid
            else:
                hi = mid
        best = None
        for t in (lo, lo - 1, lo - 2):
            if t < floor:
                break
            options = [(r["handle"], a) for r in records if r["step"] == t
                       for a in range(N_ACTIONS) if r["mask"][a] >= .5 and a != r["proposal"]]
            for h, a in options:
                trial = {**corrections, (t, h): a}
                res, _ = run_episode(case, make_policy, commands, corrections=trial)
                if not any(step == t and hh == h for step, hh, _ in res["corrections_applied"]):
                    continue
                if res["solved"]:
                    key = (0, res["lateness"])
                elif run_episode(case, make_policy, commands, corrections=trial, dla_from=t + 1)[0]["solved"]:
                    key = (1, -res["arrived"])
                else:
                    continue
                if best is None or key < best[0]:
                    best = (key, trial)
            if best is not None:
                break
        if best is None:
            return None
        corrections = best[1]
    result, records = run_episode(case, make_policy, commands, corrections=corrections, record=True)
    if result["solved"]:
        return {"corrections": corrections, "result": result, "records": records, "baseline": base}
    return None
