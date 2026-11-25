"""SwitchAtStepPolicy — one policy until a step, another from that step on.

A KI course computed for a step ahead of now (docs/plans/proposal-lead-time.md)
is taken over at that step: until then the trains run as the session drives
them anyway. Simulating that course from *now* therefore means the session's
driver first and the course afterwards, which is what this policy does, so the
course stays comparable with the plan and the operator's course from the same
step.
"""
from __future__ import annotations

from typing import Any, Dict, List, Set, Tuple

from app.policies.base import Policy


class SwitchAtStepPolicy(Policy):
    """Drive with ``before`` while the env is before step ``at``, then with ``after``."""

    def __init__(self, before: Any, after: Any, at: int):
        self.before = before
        self.after = after
        self.at = int(at)
        self._env = None
        self._current = before

    def _active(self) -> Any:
        step = int(getattr(self._env, "_elapsed_steps", 0) or 0)
        return self.after if step >= self.at else self.before

    def reset(self, env) -> None:
        self._env = env
        for policy in (self.before, self.after):
            if hasattr(policy, "reset"):
                policy.reset(env)
        self._current = self._active()

    def start_episode(self, train: bool = False) -> None:
        for policy in (self.before, self.after):
            if hasattr(policy, "start_episode"):
                policy.start_episode()

    def end_episode(self, train: bool = False) -> None:
        for policy in (self.before, self.after):
            if hasattr(policy, "end_episode"):
                policy.end_episode()

    def start_step(self, train: bool = False) -> None:
        # Fixed for the whole step: env.step moves the clock before end_step.
        self._current = self._active()
        if hasattr(self._current, "start_step"):
            self._current.start_step()

    def end_step(self, train: bool = False) -> None:
        if hasattr(self._current, "end_step"):
            self._current.end_step()

    def set_committed_overrides(self, holds: Set[int], routes: Dict[int, List[Tuple[int, int, int]]]) -> bool:
        known = False
        for policy in (self.before, self.after):
            setter = getattr(policy, "set_committed_overrides", None)
            if setter is not None:
                used = bool(setter(holds, routes))
                if policy is self._active():
                    known = used
        return known

    def act_many(self, handles, observations, **kwargs):
        policy = self._current
        if hasattr(policy, "act_many"):
            return policy.act_many(handles, observations)
        return {h: policy.act(h, observations.get(h)) for h in handles}

    def act(self, handle, observation=None, **kwargs):
        return self._current.act(handle, observation)

    def act_for_handle(self, handle, observation=None, eps=0.0):
        return self._current.act_for_handle(handle, observation)

    def build_observation_builder(self):
        return self.before.build_observation_builder()
