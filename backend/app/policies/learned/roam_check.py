# Vendored from Roman Liessner's MIT Flatland ROAM implementation in
# flatland-association/ecml2026-starterkit, repository HEAD
# ccbcf3de22fb7daa8276948e37819a904aac550e; file commit
# 76aef4d1af4eb06593e98399ea0984fd1b01035c.
# Original submission/roam_check.py SHA256:
# f352b730b3cb1ab7998c8ac60a557a097959cc5239007b0230e8cbffd20dff70.
# Algorithm unchanged; see LICENSE.roam-starterkit. The caller supplies the
# authoritative UC2 builder's remaining waypoint groups. Native Flatland 4.3
# prediction parity is covered by tests/test_uc2_roam_check.py.

"""Reserve Only if All Missions stay achievable, using Flatland's rail resources.

The certificate is a serial completion order, optionally with bounded partial
moves. Safety is relative: existing stuck trains must not acquire companions.
This is a sufficient test; rejection does not prove a physical deadlock.
"""

from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass, replace
from fractions import Fraction
from functools import lru_cache, partial
from time import perf_counter
from typing import Any, Mapping

import numpy as np
from flatland.envs.agent_chains import MotionCheck
from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.step_utils.state_machine import TrainStateMachine
from flatland.envs.step_utils.states import TrainState

Configuration = tuple[tuple[int, int], int]


@dataclass(frozen=True)
class RailTables:
    configurations: tuple[Configuration, ...]
    indices: dict[Configuration, int]
    successors: tuple[tuple[int, ...], ...]
    resources: tuple[Any, ...]


_TABLES: dict[tuple, RailTables] = {}


def rail_tables(env: Any) -> RailTables:
    """Cache native transitions by grid contents, including crossing semantics."""
    grid = env.rail.grid
    key = (
        grid.shape,
        grid.dtype.str,
        grid.tobytes(),
        tuple(sorted(env.resource_map.level_free_positions)),
    )
    if key not in _TABLES:
        configurations = tuple(
            ((int(row), int(col)), direction)
            for row, col in zip(*np.nonzero(grid))
            for direction in range(4)
            if any(env.rail.get_transitions(((int(row), int(col)), direction)))
        )
        indices = {cfg: i for i, cfg in enumerate(configurations)}
        _TABLES[key] = RailTables(
            configurations,
            indices,
            tuple(
                tuple(indices[c] for c in env.rail.get_successor_configurations(cfg))
                for cfg in configurations
            ),
            tuple(env.resource_map.get_resource(cfg) for cfg in configurations),
        )
    return _TABLES[key]


@dataclass(frozen=True)
class TrainFacts:
    node: int
    groups: tuple[frozenset[int], ...]
    terminals: frozenset[int]


def _advance(
    groups: tuple[frozenset[int], ...], node: int
) -> tuple[frozenset[int], ...]:
    while groups and node in groups[0]:
        groups = groups[1:]
    return groups


def can_complete(tables: RailTables, train: TrainFacts, blocked: set) -> bool:
    """BFS over configuration and ordered mission progress, with early removal."""
    groups = _advance(train.groups, train.node)
    queue = deque([(train.node, groups)])
    seen = {(train.node, groups)}
    while queue:
        node, remaining = queue.popleft()
        if node in train.terminals:
            if not remaining:
                return True
            continue  # Flatland removes at the target, even if a stop was skipped.
        for following in tables.successors[node]:
            if tables.resources[following] in blocked:
                continue
            state = (following, _advance(remaining, following))
            if state not in seen:
                seen.add(state)
                queue.append(state)
    return False


def _plain_completion_proof(tables, train, blocked):
    """Return an exact terminal path or a blocked boundary separating all targets."""
    terminals = train.terminals
    if train.node in terminals:
        return True, frozenset()
    parents = {train.node: None}
    boundary = set()
    queue = deque([train.node])
    successors, resources = tables.successors, tables.resources
    while queue:
        node = queue.popleft()
        for following in successors[node]:
            resource = resources[following]
            if resource in blocked:
                boundary.add(resource)
                continue
            if following in parents:
                continue
            parents[following] = node
            if following in terminals:
                path = set()
                current = following
                while current != train.node:
                    path.add(resources[current])
                    current = parents[current]
                return True, frozenset(path)
            queue.append(following)
    return False, frozenset(boundary)


def _memoized_completion(tables, proofs, stats, train, blocked):
    # Ordered intermediate groups retain the original product-state BFS.
    if len(train.groups) > 1 or (train.groups and train.groups[0] != train.terminals):
        stats["reference_calls"] += 1
        return can_complete(tables, train, blocked)
    paths, cuts = proofs(train)
    for path in paths:
        if path.isdisjoint(blocked):
            stats["path_hits"] += 1
            return True
    for cut in cuts:
        if cut <= blocked:
            stats["cut_hits"] += 1
            return False
    stats["bfs_searches"] += 1
    possible, resources = _plain_completion_proof(tables, train, blocked)
    (paths if possible else cuts).appendleft(resources)
    return possible


def _partial_move(tables, trains, waiting, holders, max_candidates, reachable):
    for handle in sorted(waiting):
        train = trains[handle]
        blocked = {
            r
            for r, count in holders.items()
            if count > int(r == tables.resources[train.node])
        }
        initial = (train.node, _advance(train.groups, train.node))
        queue, seen = deque([initial]), {initial}
        tried = 0
        while queue and tried < max_candidates:
            node, groups = queue.popleft()
            if node in train.terminals:
                continue
            for following in tables.successors[node]:
                if tables.resources[following] in blocked:
                    continue
                state = (following, _advance(groups, following))
                if state in seen:
                    continue
                seen.add(state)
                queue.append(state)
                tried += 1
                moved = replace(train, node=following, groups=state[1])
                if reachable(moved, set()):
                    after = holders.copy()
                    after[tables.resources[train.node]] -= 1
                    after[tables.resources[following]] += 1
                    for other in sorted(waiting - {handle}):
                        facts = trains[other]
                        other_blocked = {
                            r
                            for r, count in after.items()
                            if count > int(r == tables.resources[facts.node])
                        }
                        if reachable(facts, other_blocked):
                            return handle, moved
                if tried >= max_candidates:
                    break
    return None


def stuck_trains(
    tables: RailTables,
    trains: Mapping[int, TrainFacts],
    *,
    partial_moves: bool = False,
    max_candidates: int = 60,
    reachability=None,
) -> set[int]:
    reachable = reachability or partial(can_complete, tables)
    trains = dict(trains)
    waiting = set(trains)
    holders = Counter(tables.resources[t.node] for t in trains.values())
    while waiting:
        progress = False
        for handle in sorted(waiting):
            train = trains[handle]
            resource = tables.resources[train.node]
            blocked = {r for r, count in holders.items() if count > int(r == resource)}
            if reachable(train, blocked):
                waiting.remove(handle)
                holders[resource] -= 1
                progress = True
        if progress:
            continue
        move = (
            _partial_move(tables, trains, waiting, holders, max_candidates, reachable)
            if partial_moves
            else None
        )
        if move is None:
            break
        handle, moved = move
        holders[tables.resources[trains[handle].node]] -= 1
        holders[tables.resources[moved.node]] += 1
        trains[handle] = moved
    return waiting


def predict_configuration(env: Any, agent: Any, action: int) -> Configuration | None:
    """Desired configuration before MotionCheck, matching RailEnv.step (4.2.5).

    The currently known malfunction state is included. New step-start effects
    can cancel a prediction after the policy has acted; future RNG draws are
    deliberately not inspected here.
    """
    action = RailEnvActions.from_value(action)
    current = agent.current_configuration
    if agent.state == TrainState.DONE:
        return current
    cfg = current if current is not None else agent.initial_configuration
    transition = env.rail.apply_action_independent(action, cfg)
    valid = transition is not None
    moving = RailEnvActions.is_moving_action(action)
    stop = action == RailEnvActions.STOP_MOVING
    malfunction = agent.malfunction_handler.in_malfunction
    speed = agent.speed_counter.speed
    if not valid:
        speed = Fraction(0)
    elif agent.state in (TrainState.STOPPED, TrainState.MALFUNCTION) and moving:
        speed += env.acceleration_delta
    elif action == RailEnvActions.MOVE_FORWARD and transition[1]:
        speed += env.acceleration_delta
    elif stop:
        speed += env.braking_delta
    speed = max(Fraction(0), min(agent.speed_counter.max_speed, speed))
    if current is None:
        ready = agent.state == TrainState.READY_TO_DEPART and not malfunction and moving
        recovered = (
            agent.state == TrainState.MALFUNCTION_OFF_MAP
            and not malfunction
            and agent.earliest_departure <= env._elapsed_steps + 1
            and (moving or stop)
        )
        return agent.initial_configuration if valid and (ready or recovered) else None
    if (
        valid
        and agent.speed_counter.is_cell_exit(speed)
        and TrainStateMachine.can_get_moving_independent(
            agent.state, malfunction, moving, speed, stop or not valid
        )
    ):
        return transition[0]
    return current


def fallback_action(agent: Any) -> int:
    return 4 if agent.state.is_on_map_state() else 0


def open_waypoint_groups(obs_builder: Any) -> dict[int, tuple]:
    """Use the builder's progress; never maintain a second mission tracker."""
    result = {}
    for agent in obs_builder.env.agents:
        obs_builder._check_and_advance_waypoint(agent.handle)
        index = obs_builder.waypoint_index[agent.handle] + 1
        result[agent.handle] = tuple(tuple(group) for group in agent.waypoints[index:])
    return result


class RoamCheck:
    def __init__(
        self,
        env: Any,
        *,
        partial_moves=False,
        max_candidates=60,
        use_reachability_cache=True,
    ):
        if env.braking_delta > -max(
            float(a.speed_counter.max_speed) for a in env.agents
        ):
            raise ValueError("ROAM requires immediate STOP braking")
        if not env.remove_agents_at_target:
            raise ValueError("ROAM requires remove_agents_at_target=True")
        self.env = env
        self.tables = rail_tables(env)
        self.partial_moves = partial_moves
        self.max_candidates = max_candidates
        self.use_reachability_cache = use_reachability_cache
        self._key = None
        self.mask_times: list[float] = []
        self.withdrawal_times: list[float] = []
        self.masked_actions = 0
        self.withdrawals = 0
        self.withdrawn_handles: set[int] = set()
        self.last_predictions: dict[int, Configuration | None] = {}

    def stuck(self, trains):
        return stuck_trains(
            self.tables,
            trains,
            partial_moves=self.partial_moves,
            max_candidates=self.max_candidates,
            reachability=self._can_complete,
        )

    def _can_complete(self, train, blocked):
        self.reachability_queries = getattr(self, "reachability_queries", 0) + 1
        if not getattr(self, "use_reachability_cache", True):
            return can_complete(self.tables, train, blocked)
        if not hasattr(self, "_completion_cache"):
            # Bind the immutable topology, not the environment. Full mission and
            # blocked-resource keys make reuse across steps exact. The bounded
            # cache is owned by this check and is discarded with an env reset.
            self._proof_stats = Counter()
            self._proofs = lru_cache(maxsize=4096)(
                lambda train: (deque(maxlen=2), deque(maxlen=4))
            )
            self._completion_cache = lru_cache(maxsize=8192)(
                partial(
                    _memoized_completion, self.tables, self._proofs, self._proof_stats
                )
            )
        return self._completion_cache(train, frozenset(blocked))

    def reachability_cache_info(self):
        cache = getattr(self, "_completion_cache", None)
        info = cache.cache_info() if cache is not None else None
        queries = getattr(self, "reachability_queries", 0)
        hits = info.hits if info is not None else 0
        return {
            "enabled": getattr(self, "use_reachability_cache", True),
            "queries": queries,
            "hits": hits,
            "misses": queries - hits,
            "size": info.currsize if info is not None else 0,
            "max_size": 8192,
            **{
                name: getattr(self, "_proof_stats", {}).get(name, 0)
                for name in ("path_hits", "cut_hits", "bfs_searches", "reference_calls")
            },
        }

    def _groups(self, groups):
        key = tuple(tuple(group) for group in groups)
        cache = getattr(self, "_groups_cache", None)
        if cache is None:
            self._groups_cache = cache = {}
        enabled = getattr(self, "use_reachability_cache", True)
        if enabled and key in cache:
            return cache[key]
        result = tuple(
            frozenset(
                i
                for cfg, i in self.tables.indices.items()
                if any(
                    cfg[0] == wp.position
                    and (wp.direction is None or cfg[1] == wp.direction)
                    for wp in group
                )
            )
            for group in groups
        )
        if enabled:
            if len(cache) >= 512:
                cache.clear()
            cache[key] = result
        return result

    def snapshot(self, groups):
        # A reset or a changed caller-provided mission invalidates the per-step cache.
        key = (
            self.env._elapsed_steps,
            tuple(
                (
                    a.handle,
                    a.state,
                    a.current_configuration,
                    tuple(tuple(g) for g in groups[a.handle]),
                )
                for a in self.env.agents
            ),
        )
        if key == self._key:
            return self.trains, self.stuck_before
        self.facts = {}
        self.trains = {}
        for agent in self.env.agents:
            cfg = agent.current_configuration or agent.initial_configuration
            facts = TrainFacts(
                self.tables.indices[cfg],
                self._groups(groups[agent.handle]),
                frozenset(
                    self.tables.indices[c]
                    for c in agent.targets
                    if c in self.tables.indices
                ),
            )
            self.facts[agent.handle] = facts
            if agent.state.is_on_map_state():
                self.trains[agent.handle] = facts
        self.stuck_before = self.stuck(self.trains)
        self._key = key
        return self.trains, self.stuck_before

    def after_move(self, trains, handle, cfg):
        after = dict(trains)
        node = self.tables.indices[cfg]
        facts = self.facts[handle]
        groups = _advance(facts.groups, facts.node)
        groups = _advance(groups, node)
        if node in facts.terminals:
            # Reaching the final target early must not hide an unfinished mission.
            if groups:
                return None
            after.pop(handle, None)
        else:
            after[handle] = replace(facts, node=node, groups=groups)
        return after

    def safe_after(self, trains, handle, cfg, baseline):
        resource = self.env.resource_map.get_resource(cfg)
        if any(
            h != handle and self.tables.resources[t.node] == resource
            for h, t in trains.items()
        ):
            return None
        after = self.after_move(trains, handle, cfg)
        if after is None:
            return None
        stuck = self.stuck(after)
        return (after, stuck) if stuck <= baseline else None

    def action_mask(self, groups):
        start = perf_counter()
        trains, baseline = self.snapshot(groups)
        masks = {}
        for agent in self.env.agents:
            mask = np.ones(5, dtype=np.float32)
            cfg = agent.current_configuration
            # Equivalent actions (common on curves) need only one safety query.
            checked = {}
            for action in range(5):
                desired = predict_configuration(self.env, agent, action)
                transition = self.env.rail.apply_action_independent(
                    RailEnvActions.from_value(action),
                    cfg or agent.initial_configuration,
                )
                if transition is None and action not in (0, 4):
                    mask[action] = 0
                if desired is not None and desired != cfg:
                    if desired not in checked:
                        checked[desired] = (
                            self.safe_after(trains, agent.handle, desired, baseline)
                            is not None
                        )
                    if not checked[desired]:
                        mask[action] = 0
                        self.masked_actions += 1
            mask[fallback_action(agent)] = 1
            masks[agent.handle] = mask
        self.mask_times.append(perf_counter() - start)
        return masks

    def _resolve_motion(self, actions):
        check = MotionCheck()
        desired = {}
        for agent in self.env.agents:
            cfg = predict_configuration(self.env, agent, actions.get(agent.handle, 0))
            desired[agent.handle] = cfg
            check.add_agent(
                agent.handle,
                self.env.resource_map.get_resource(agent.current_configuration),
                self.env.resource_map.get_resource(cfg),
            )
        check.find_conflicts()
        for agent in self.env.agents:
            if not check.check_motion(
                agent.handle,
                self.env.resource_map.get_resource(agent.current_configuration),
            ):
                desired[agent.handle] = agent.current_configuration
        return desired

    def withdraw(self, actions, groups):
        start = perf_counter()
        original_trains, original_stuck = self.snapshot(groups)
        result = {
            h: int(RailEnvActions.from_value(a).value) for h, a in actions.items()
        }
        ordered = sorted(self.env.agents, key=lambda a: a.handle)
        while True:
            trains, baseline = dict(original_trains), original_stuck
            certified = {a.handle: a.current_configuration for a in ordered}
            # MotionCheck resolves ties exactly as the simulator. Removing a
            # winner may unblock an earlier request through a following chain.
            for agent in ordered:
                desired = self._resolve_motion(result)
                cfg = desired[agent.handle]
                if cfg is None or cfg == agent.current_configuration:
                    continue
                after = self.safe_after(trains, agent.handle, cfg, baseline)
                if after is None:
                    result[agent.handle] = fallback_action(agent)
                else:
                    trains, baseline = after
                    certified[agent.handle] = cfg
            actual = self._resolve_motion(result)
            inconsistent = [
                a for a in ordered if actual[a.handle] != certified[a.handle]
            ]
            if not inconsistent:
                break
            # An unaccepted release must never be assumed. Freezing any changed
            # motion and rebuilding the certificate also handles cancellations.
            # Every retry removes at least one movement, so there are <= N+1 passes.
            for agent in inconsistent:
                result[agent.handle] = fallback_action(agent)
        # Requests still physically blocked are left to MotionCheck; these are
        # not counted as ROAM withdrawals.
        self.withdrawn_handles = {
            h
            for h, a in result.items()
            if a != int(RailEnvActions.from_value(actions.get(h, 0)).value)
        }
        self.withdrawals += len(self.withdrawn_handles)
        self.last_predictions = actual
        for agent in self.env.agents:
            cfg = self.last_predictions[agent.handle]
            if cfg in agent.targets and cfg != agent.current_configuration:
                self.last_predictions[agent.handle] = None
        self.withdrawal_times.append(perf_counter() - start)
        return result


def get_check(env: Any, *, partial_moves: bool | None = None) -> RoamCheck:
    if partial_moves is None:
        partial_moves = getattr(env.obs_builder, "roam_partial_moves", False)
    check = getattr(env, "_roam_check", None)
    cache = getattr(env.obs_builder, "roam_reachability_cache", True)
    if (
        check is None
        or check.partial_moves != partial_moves
        or check.use_reachability_cache != cache
    ):
        check = env._roam_check = RoamCheck(
            env, partial_moves=partial_moves, use_reachability_cache=cache
        )
    return check


def calculate_safe_action_mask(env, open_waypoint_groups) -> dict[int, np.ndarray]:
    return get_check(env).action_mask(open_waypoint_groups)


def calculate_withdrawn_actions(env, actions, open_waypoint_groups) -> dict[int, int]:
    return get_check(env).withdraw(actions, open_waypoint_groups)
