"""PlanPolicy — drive trains along a premade plan (`app.core.plans`).

Replay is **by position, never by clock.** The obvious implementation ("at
step t, do whatever the plan lists for step t") holds only while nothing goes
wrong: the first disturbance puts a train five steps behind, the plan pointer
runs on without it, and every action after that belongs to a cell the train is
not in. Instead each step reads the train's actual `(position, direction)` out
of the env, finds it in its own trainrun, and emits the action that moves it to
the next waypoint. A delayed train therefore keeps its planned *route* and
carries its delay forward, which is the whole reason to run a plan against a
disturbance file rather than replaying a recording.

`SchedulePlayer` in `goal_based_policies/schedule.py` resolves the same problem
the same way, over decision-graph nodes instead of cells.

Positions alone are not enough either, because a plan encodes *two* things and
only one of them is written down. "Wait at WN until step 40" is really "wait
until W1 has come through the single-track section"; once a disturbance pushes
everything past step 40, the written form is satisfied and the meant form is
not — the waiting trains drive into the section and meet W1 head-on. So replay
enforces the plan's **order at every cell** as well as its times: a train may
enter a cell only once every train the plan puts there before it has been
through. Times still gate the undisturbed case exactly; the order is what
survives a delay. This is the standard re-scheduling result — keeping the
planned order at each resource keeps a feasible plan feasible when times slip.

One consequence shapes the whole implementation: **the policy may not remember
anything between steps.** `api/sessions.py` builds a fresh policy on every
`/step` request, so per-instance progress is wiped several times per episode.
Anything the order rule needs is therefore derived from the env each step —
"has that train been through this cell yet?" is answered by locating it in its
own trainrun, not by a set the policy accumulated. The one thing that cannot be
derived, which train has left its plan, is stashed on the env next to the plan
itself.

Two trains are not on the plan:

- one the plan does not mention at all;
- one that has left its plan — in practice because the operator overrode it.

Both fall to `fallback` (the app default, deadlock avoidance) and, once off,
stay off for the rest of the episode. Silently snapping an overridden train
back onto the plan would hide the consequence of the operator's decision,
which in this app is the thing under study.

The operator's committed holds and routes (`set_committed_overrides`) are
passed on to the fallback. A train rerouted after the course was taken is off
plan from then on, so the fallback drives it along its route; a route the
course was simulated with keeps it on plan.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

from flatland.core.env_observation_builder import ObservationBuilder
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.rail_trainrun_data_structures import TrainrunDict

from app.policies.base import Policy
from app.policies.deadlock_avoidance_policy import DeadLockAvoidancePolicy
from app.policies.goal_based_policies.infrastructure_graph import action_for_move
from app.utils.agent_compat import agent_direction, agent_position, agent_target_positions


class PlanPolicy(Policy):
    """Follow a `TrainrunDict`; hand anything not on it to `fallback`."""

    def __init__(
        self,
        env: Optional[RailEnv] = None,
        trainruns: Optional[TrainrunDict] = None,
        fallback: Optional[Policy] = None,
    ):
        self._env = env
        self.trainruns: TrainrunDict = {
            int(handle): list(run) for handle, run in (trainruns or {}).items()
        }
        self.fallback: Policy = fallback or DeadLockAvoidancePolicy()
        # The trains with a committed hold, as `set_committed_overrides` last
        # passed them; a held train at the end of its run keeps the course.
        self._holds: Set[int] = set()
        # cell -> handles in the order the plan sends them through it.
        self._order: Dict[Tuple[int, int], List[int]] = self._build_order()
        # Per train, where each waypoint sits in its run. Both are lookups into
        # the plan, not progress: they let `_locate` and the order rule answer
        # "how far along is this train" from the env alone.
        self._at: Dict[int, Dict[Tuple[Tuple[int, int], int], int]] = {}
        self._cell_at: Dict[int, Dict[Tuple[int, int], int]] = {}
        for handle, run in self.trainruns.items():
            self._at[handle] = {}
            self._cell_at[handle] = {}
            for index, waypoint in enumerate(run):
                key = (waypoint.waypoint.position, int(waypoint.waypoint.direction))
                # First occurrence wins: a plan that revisits a cell would make
                # progress ambiguous, and understating it only costs extra
                # waiting, never a collision.
                self._at[handle].setdefault(key, index)
                self._cell_at[handle].setdefault(waypoint.waypoint.position, index)

    def _build_order(self) -> Dict[Tuple[int, int], List[int]]:
        claims: Dict[Tuple[int, int], List[Tuple[int, int]]] = {}
        for handle, run in self.trainruns.items():
            for waypoint in run:
                claims.setdefault(waypoint.waypoint.position, []).append(
                    (int(waypoint.scheduled_at), handle)
                )
        order: Dict[Tuple[int, int], List[int]] = {}
        for cell, entries in claims.items():
            seen: List[int] = []
            for _, handle in sorted(entries):
                if handle not in seen:
                    seen.append(handle)
            order[cell] = seen
        return order

    # ── observation bundle ───────────────────────────────────────────
    def build_observation_builder(self) -> ObservationBuilder:
        return self.fallback.build_observation_builder()

    # ── lifecycle ────────────────────────────────────────────────────
    def reset(self, env: RailEnv) -> None:
        self._env = env
        # Which trains have left the plan is the one fact that cannot be read
        # back off the env, so it lives on the env — the same stash the plan
        # itself uses. A fresh episode (nothing elapsed) starts it empty.
        if int(getattr(env, "_elapsed_steps", 0) or 0) == 0:
            env._plan_off_plan = set()
        elif not hasattr(env, "_plan_off_plan"):
            env._plan_off_plan = set()
        self.fallback.reset(env)

    @property
    def _off_plan(self) -> Set[int]:
        return getattr(self._env, "_plan_off_plan", set())

    def set_committed_overrides(self, holds, routes) -> bool:
        """Take rerouted trains off the plan, pass the overrides on to the fallback.

        A train with a committed route the course was not simulated with is
        off plan from now on (Q-8 a): the course's entry steps and its order at
        each cell answer the old situation, and keeping them would hold the
        train where the route meant to let it go. The fallback drives it from
        then on: a fallback that takes the routes into account (DLA) walks it
        along its route; for any other, `OverridePolicy` forces the route's
        move. A route the course was simulated with (#208's kept reroute,
        recorded by `note_course_routes`) stays on plan. The fallback's answer
        is this policy's: when True, `OverridePolicy` keeps the driver's stop
        for a rerouted train. Plan:
        docs/plans/set-route-on-map.md (Q-12, S-6).
        """
        self._holds = {int(h) for h in (holds or ())}
        if self._env is not None:
            off = self._off_plan_set()
            course_routes = getattr(self._env, "_plan_course_routes", None) or {}
            for handle, route in (routes or {}).items():
                handle = int(handle)
                if handle in self.trainruns and handle not in off and _nodes(route) != course_routes.get(handle):
                    off.add(handle)
        return bool(self.fallback.set_committed_overrides(holds, routes))

    def _off_plan_set(self) -> Set[int]:
        """The env's off-plan set, created when `reset` has not run yet."""
        if not hasattr(self._env, "_plan_off_plan"):
            self._env._plan_off_plan = set()
        return self._env._plan_off_plan

    def start_step(self, train: bool = False) -> None:
        self.fallback.start_step(train)

    def end_step(self, train: bool = False) -> None:
        self.fallback.end_step(train)

    def get_name(self) -> str:
        return "PlanPolicy"

    # ── introspection (used by the API and by tests) ─────────────────
    @property
    def off_plan_handles(self) -> List[int]:
        return sorted(self._off_plan)

    def is_planned(self, handle: int) -> bool:
        return int(handle) in self.trainruns and int(handle) not in self._off_plan

    # ── action selection ─────────────────────────────────────────────
    def _drop_exhausted_course(self) -> None:
        """Every train to the fallback once the course has run out for a free train.

        A run that never reaches the train's target was cut short: a course
        computed while the train was held lists only the cell it stood on, and
        a forecast horizon can cut a run the same way. (A complete run ends on
        the cell before the target: the rollout records no position for the
        step the train enters it and is done. Its train finishing is not this
        case.) A run is cut short for sure when its train was held as the course
        was taken (`note_course_holds`): the course had it stand, however close
        to its target; adjacency alone can't tell, a train held next to its
        target ends there too. The course assumed the train would stay where its run ends, and
        the other trains' runs were made around that. Once the hold is gone that assumption is void for all of
        them. Handing only this train to the fallback sends it into trains that
        still follow the course (they never wait for a train off its plan);
        handing every train to the fallback lets deadlock avoidance sort them
        out. Measured on uc2-4 (train 1 held at 20, an AI course for train 0
        taken at 24, train 1 released): only train 0 arrives when train 1 alone
        is handed over, all three when every train is. A train still held keeps
        the course, as it assumed.
        """
        env = self._env
        if env is None:
            return
        off = self._off_plan_set()
        held_at_takeover = getattr(env, "_plan_course_holds", None) or set()
        for handle, run in self.trainruns.items():
            if handle in off or handle in self._holds or not run:
                continue
            agent = env.agents[handle]
            if getattr(agent.state, "name", str(agent.state)) == "DONE" or agent_position(agent) is None:
                continue
            end = run[-1].waypoint.position
            if handle not in held_at_takeover and any(
                    abs(end[0] - t[0]) + abs(end[1] - t[1]) <= 1 for t in agent_target_positions(agent)):
                continue  # a complete run: its train is about to finish
            index = self._locate(handle)
            if index is not None and index >= len(run) - 1:
                off.update(self.trainruns)
                return

    def act_many(self, handles, observations, **kwargs) -> Dict[int, Any]:
        self._drop_exhausted_course()
        handles = [int(h) for h in handles]
        actions: Dict[int, Any] = {}
        needs_fallback: List[int] = []

        for handle in handles:
            action = self._plan_action(handle)
            if action is None:
                needs_fallback.append(handle)
            else:
                actions[handle] = action

        if needs_fallback:
            actions.update(self.fallback.act_many(needs_fallback, observations) or {})
        return actions

    def act_for_handle(self, handle, observation=None, eps: float = 0.0):
        self._drop_exhausted_course()
        action = self._plan_action(int(handle))
        if action is None:
            return self.fallback.act_for_handle(handle, observation, eps)
        return action

    # ── internals ────────────────────────────────────────────────────
    def _plan_action(self, handle: int) -> Optional[RailEnvActions]:
        """The planned action, or None when the train is not on a plan."""
        env = self._env
        if env is None or handle in self._off_plan:
            return None
        run = self.trainruns.get(handle)
        if not run:
            return None

        agent = env.agents[handle]
        if getattr(agent.state, "name", str(agent.state)) == "DONE":
            return RailEnvActions.DO_NOTHING

        elapsed = int(getattr(env, "_elapsed_steps", 0) or 0)

        # Still off the map: the plan's first waypoint is the origin, and its
        # `scheduled_at` is the departure step. Any movement action puts the
        # train on that cell facing its initial direction, so the choice of
        # movement action does not matter here — only its timing does.
        if agent_position(agent) is None:
            if elapsed + 1 < run[0].scheduled_at:
                return RailEnvActions.STOP_MOVING
            return RailEnvActions.MOVE_FORWARD

        index = self._locate(handle)
        if index is None:
            # Off plan — almost always an operator override. Recorded on the
            # env so the train keeps a single controller for the rest of the
            # episode, across the policy rebuilds the API does each step.
            self._off_plan.add(handle)
            return None

        if index >= len(run) - 1:
            # Standing on the last planned cell, still held: as the course
            # assumed (`_drop_exhausted_course` handles the released case).
            return RailEnvActions.DO_NOTHING

        nxt = run[index + 1]
        # `scheduled_at` is when the train *enters* that cell, and an action
        # taken now takes effect on the next step, so `elapsed + 1` is the
        # earliest arrival this action could produce.
        if elapsed + 1 < nxt.scheduled_at:
            return RailEnvActions.STOP_MOVING
        if self._blocked_by_plan_order(handle, nxt.waypoint.position):
            return RailEnvActions.STOP_MOVING
        return RailEnvActions(
            action_for_move(int(agent_direction(agent)), int(nxt.waypoint.direction))
        )

    def _blocked_by_plan_order(self, handle: int, cell: Tuple[int, int]) -> bool:
        """True while a train the plan sends through `cell` first has not been.

        A train that is DONE or has left its plan is never a blocker: it is
        either finished with the network or under someone else's control, and
        waiting for it would stall the plan forever.
        """
        for other in self._order.get(cell, ()):
            if other == handle:
                return False
            if other in self._off_plan or self._has_passed(other, cell):
                continue
            return True
        return False

    def _has_passed(self, other: int, cell: Tuple[int, int]) -> bool:
        """Whether `other` is already beyond `cell` on its own trainrun.

        Read off the env rather than accumulated, because the API rebuilds the
        policy every step: a remembered set would come back empty mid-episode
        and every train would then wait for trains that had long gone by.
        """
        agent = self._env.agents[other]
        if getattr(agent.state, "name", str(agent.state)) == "DONE":
            return True
        if agent_position(agent) is None:
            return False                      # not departed — still to come
        index = self._locate(other)
        if index is None:
            return True                       # off its plan; not coming back
        target = self._cell_at.get(other, {}).get(cell)
        if target is None:
            return True                       # `cell` is not on its run at all
        return index >= target

    def _locate(self, handle: int) -> Optional[int]:
        """Index of the train's current waypoint in its trainrun, else None."""
        agent = self._env.agents[handle]
        position = agent_position(agent)
        if position is None:
            return None
        key = ((int(position[0]), int(position[1])), int(agent_direction(agent)))
        return self._at.get(handle, {}).get(key)


def trainruns_from_env(env: RailEnv) -> Optional[TrainrunDict]:
    """The plan `env_factory` stashed on the env, if the scenario ships one.

    Same stash pattern the module already uses for `_infrastructure_scene`,
    so the policy registry keeps its `(env) -> Policy` factory signature.
    """
    return getattr(env, "_trainrun_plan", None)


def plan_branch_factory(env: RailEnv):
    """Zero-arg policy factory (the `TrajectoryBranchRunner` contract) that
    follows `env`'s plan on forked envs; None when `env` ships no plan.

    Branch envs are persister clones and do not carry the stashed plan, so the
    trainruns are read from the live env here and handed to every policy. Without
    this a plan-driven session was forecast with deadlock avoidance, which routes
    trains differently from the plan the session actually runs.
    """
    trainruns = trainruns_from_env(env)
    if not trainruns:
        return None

    def factory() -> PlanPolicy:
        return PlanPolicy(None, trainruns)

    return factory


def baseline_trainruns_from_env(env: RailEnv) -> Optional[TrainrunDict]:
    """The timetable the session started from, even after a replan replaced it.

    Accepting an AI replan swaps `_trainrun_plan` for the plan the trains now
    follow. "Delay against the plan" must keep meaning the *timetable*, or every
    accepted replan would silently reset the yardstick to itself.
    """
    return getattr(env, "_baseline_trainrun_plan", None) or trainruns_from_env(env)


def install_trainrun_plan(env: RailEnv, trainruns: TrainrunDict) -> None:
    """Make `trainruns` the plan the session runs on, keeping the timetable as
    the yardstick (stashed on first replacement).

    An accepted course is never stashed: on a scenario that shipped no plan, a
    second acceptance would otherwise make the first accepted course the
    yardstick, and the proposals would be graded against an AI course.
    """
    if (not getattr(env, "_accepted_trainrun_plan", False)
            and getattr(env, "_baseline_trainrun_plan", None) is None):
        env._baseline_trainrun_plan = trainruns_from_env(env)
    env._trainrun_plan = trainruns


def accept_trainrun_plan(env: RailEnv, trainruns: TrainrunDict) -> None:
    """The operator took an AI plan: install it and remember that it was accepted.

    An accepted plan is the course from now on, whatever dispatching policy the
    client keeps sending (a study condition pins one for every step and play);
    that policy then only drives trains off the plan. See `plan_accepted` and
    docs/plans/uc2-rl-proposal-agent.md.

    The accepted course is a new course for every train: a train that left the
    one it replaces is on plan again (a Director strategy and «Handlungsoptionen»
    both accept here; docs/plans/set-route-on-map.md, S-8).
    """
    install_trainrun_plan(env, trainruns)
    env._accepted_trainrun_plan = True
    env._plan_off_plan = set()


def _nodes(route) -> List[Tuple[int, int, int]]:
    return [tuple(int(v) for v in node) for node in route]


def note_course_routes(env: RailEnv, routes) -> None:
    """Record the committed routes a just accepted course was simulated with.

    `PlanPolicy` keeps their trains on plan; any other committed route takes
    its train off plan (`PlanPolicy.set_committed_overrides`).
    """
    env._plan_course_routes = {int(h): _nodes(r) for h, r in (routes or {}).items()}


def note_course_holds(env: RailEnv, holds) -> None:
    """Record the trains held when a course was taken: the course has them stand.

    Their runs are cut short, also when they end next to the target, so once
    released at the end of such a run the course is dropped
    (`PlanPolicy._drop_exhausted_course`).
    """
    env._plan_course_holds = {int(h) for h in (holds or ())}


def plan_accepted(env: RailEnv) -> bool:
    return bool(getattr(env, "_accepted_trainrun_plan", False)) and bool(trainruns_from_env(env))


def revert_accepted_plan(env: RailEnv) -> None:
    """Back to the plan the session started with (reset, or a deliberate policy switch)."""
    if not getattr(env, "_accepted_trainrun_plan", False):
        return
    env._trainrun_plan = getattr(env, "_baseline_trainrun_plan", None)
    env._baseline_trainrun_plan = None
    env._accepted_trainrun_plan = False
    env._plan_course_routes = {}


def planned_arrival_steps(env: RailEnv) -> Dict[int, int]:
    """Step at which each planned train is DONE when it runs to the timetable.

    A trainrun's last waypoint is the target cell, entered at `scheduled_at`;
    Flatland marks the train DONE one step later.
    """
    trainruns = baseline_trainruns_from_env(env) or {}
    return {int(handle): int(run[-1].scheduled_at) + 1 for handle, run in trainruns.items() if run}


__all__ = [
    "PlanPolicy",
    "accept_trainrun_plan",
    "plan_accepted",
    "revert_accepted_plan",
    "baseline_trainruns_from_env",
    "install_trainrun_plan",
    "note_course_routes",
    "plan_branch_factory",
    "planned_arrival_steps",
    "trainruns_from_env",
]
