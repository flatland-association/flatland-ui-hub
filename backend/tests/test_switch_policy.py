"""SwitchAtStepPolicy: only the active policy hears the overrides, and the plan
state is reset at the switch as a real takeover does."""
from types import SimpleNamespace

from app.policies.switch_policy import SwitchAtStepPolicy


class _Recorder:
    def __init__(self, env):
        self.env = env
        self.calls = []

    def reset(self, env):
        pass

    def set_committed_overrides(self, holds, routes):
        self.calls.append((int(self.env._elapsed_steps), set(holds), dict(routes)))
        # A plan-following policy takes rerouted trains off plan in the shared set.
        self.env._plan_off_plan.update(routes)
        return True


def _env(step=0):
    return SimpleNamespace(_elapsed_steps=step, _plan_off_plan=set(), _route_overrides={})


def test_only_the_active_policy_hears_the_overrides():
    env = _env(3)
    before, after = _Recorder(env), _Recorder(env)
    switch = SwitchAtStepPolicy(before, after, at=5)
    switch.reset(env)
    switch.set_committed_overrides({1}, {})
    env._elapsed_steps = 5
    switch.set_committed_overrides({1}, {})
    assert [c[0] for c in before.calls] == [3]
    assert [c[0] for c in after.calls] == [5]


def test_the_inactive_policy_leaves_the_plan_state_alone():
    env = _env(3)
    before, after = _Recorder(env), _Recorder(env)
    switch = SwitchAtStepPolicy(before, after, at=5)
    switch.reset(env)
    route = {2: [(0, 1, 1)]}
    switch.set_committed_overrides(set(), route)
    assert env._plan_off_plan == {2}  # the driver before the switch took train 2 off plan
    env._elapsed_steps = 5
    env._route_overrides = {}
    switch.start_step()
    assert env._plan_off_plan == set()  # reset at the switch, as the install does
    assert env._plan_course_routes == {}
    switch.set_committed_overrides(set(), {})
    assert env._plan_off_plan == set()


def test_the_switch_resets_the_plan_state_once():
    env = _env(5)
    before, after = _Recorder(env), _Recorder(env)
    switch = SwitchAtStepPolicy(before, after, at=5)
    switch.reset(env)
    env._plan_off_plan.add(3)  # taken off plan by the course itself, after the switch
    switch.start_step()
    assert env._plan_off_plan == {3}
