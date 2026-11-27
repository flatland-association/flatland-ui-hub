"""SwitchAtStepPolicy — one policy until a step, another from that step on.

A KI course computed for a step ahead of now (docs/plans/plan-b-log-findings.md §4.3)
is taken over at that step: until then the trains run as the session drives
them anyway. Simulating that course from *now* therefore means the session's
driver first and the course afterwards, which is what this policy does, so the
course stays comparable with the plan and the operator's course from the same
step.

Only the active policy hears the committed overrides: both policies may share
the env's plan state (`_plan_off_plan`), and the inactive one must not change
it. At the switch the plan state is reset as `_install_ai_course` does when the
course is really taken over, so the preview drives the course, not a fallback.
"""
from __future__ import annotations

from typing import Any, Dict, List, Set, Tuple

from app.policies.base import Policy
from app.policies.plan_policy import note_course_holds, note_course_routes


class SwitchAtStepPolicy(Policy):
    """Drive with ``before`` while the env is before step ``at``, then with ``after``."""

    def __init__(self, before: Any, after: Any, at: int):
        self.before = before
        self.after = after
        self.at = int(at)
        self._env = None
        self._current = before
        self._switched = False

    def _active(self) -> Any:
        step = int(getattr(self._env, "_elapsed_steps", 0) or 0)
        return self.after if step >= self.at else self.before

    def reset(self, env) -> None:
        self._env = env
        for policy in (self.before, self.after):
            if hasattr(policy, "reset"):
                policy.reset(env)
        self._switched = False
        self._current = self._active()
        self._switch_if_due()

    def _switch_if_due(self, holds=None) -> None:
        """On the first call at or after step ``at``: the plan state the course
        starts from, as `_install_ai_course` leaves it (every train on plan, the
        routes and holds still committed are the ones the course runs with)."""
        if self._switched or self._env is None or self._active() is not self.after:
            return
        self._switched = True
        self._env._plan_off_plan = set()
        note_course_routes(self._env, getattr(self._env, "_route_overrides", None))
        note_course_holds(self._env, holds)

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
        self._switch_if_due()
        self._current = self._active()
        if hasattr(self._current, "start_step"):
            self._current.start_step()

    def end_step(self, train: bool = False) -> None:
        if hasattr(self._current, "end_step"):
            self._current.end_step()

    def set_committed_overrides(self, holds: Set[int], routes: Dict[int, List[Tuple[int, int, int]]]) -> bool:
        self._switch_if_due(holds)
        setter = getattr(self._active(), "set_committed_overrides", None)
        return bool(setter(holds, routes)) if setter is not None else False

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
