"""Runtime policy wrapper for user action overrides.

Semantics:
- Setting an override does NOT execute it immediately.
- The wrapped/base policy controls the train until the agent reaches a
  decision point.
- At a decision point (SWITCH or MERGING), the override action is applied once.
- Immediately after application, the override is cleared.

UI mental model:
  "Apply my next action at the next decision point."

Reroute (`REROUTE_ACTION`) is the exception: not one action but a whole route
around the blocked cells, driven every step until the train arrives
(`app.core.route_overrides`).

Override-aware policies: before each step the wrapped policy gets the committed
holds and routes (`Policy.set_committed_overrides`). One that takes them into
account (DLA) keeps the say over go or stop for a rerouted train: its STOP wins,
otherwise the route's move. For any other policy the route's move wins, as before.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable

from flatland.envs.rail_env import RailEnvActions
from flatland.envs.step_utils.states import TrainState

from app.core import intervention_log
from app.core.cell_classifier import classify_cell_at
from app.core.override_manager import override_manager
from app.core.route_overrides import REROUTE_ACTION, drop_route, route_move
from app.utils.agent_compat import agent_direction, agent_position


def _is_stop(action: Any) -> bool:
    try:
        return int(getattr(action, "value", action)) == RailEnvActions.STOP_MOVING.value
    except (TypeError, ValueError):
        return False


class OverridePolicy:
    """Wrap a runtime policy and delay user overrides until a decision point."""

    def __init__(self, default_policy: Any, session_id: str):
        self.default_policy = default_policy
        self.session_id = session_id
        self.env = None
        # The last act_many's provenance, for the trajectory recorder: the base
        # policy's proposal per agent and what decided the applied action
        # ("policy", "override" or "reroute").
        self.last_proposed: Dict[int, Any] = {}
        self.last_sources: Dict[int, str] = {}
        # Whether the wrapped policy took the committed overrides this step
        # (`_pass_committed_overrides`); then its STOP wins over a route's move.
        self._policy_knows_overrides = False

    def reset(self, env) -> None:
        self.env = env
        if hasattr(self.default_policy, "reset"):
            self.default_policy.reset(env)

    def start_episode(self) -> None:
        if hasattr(self.default_policy, "start_episode"):
            self.default_policy.start_episode()

    def end_episode(self) -> None:
        if hasattr(self.default_policy, "end_episode"):
            self.default_policy.end_episode()

    def start_step(self) -> None:
        self._pass_committed_overrides()
        if hasattr(self.default_policy, "start_step"):
            self.default_policy.start_step()

    def _pass_committed_overrides(self) -> bool:
        """Tell the wrapped policy the committed holds and routes; True if it uses them."""
        setter = getattr(self.default_policy, "set_committed_overrides", None)
        if setter is None or self.env is None:
            self._policy_knows_overrides = False
            return False
        committed = override_manager.get_all(self.session_id)
        env_routes = getattr(self.env, "_route_overrides", None) or {}
        holds = {int(h) for h, a in committed.items() if int(a) == RailEnvActions.STOP_MOVING.value}
        routes = {
            int(h): list(env_routes[int(h)])
            for h, a in committed.items()
            if int(a) == REROUTE_ACTION and int(h) in env_routes
        }
        self._policy_knows_overrides = bool(setter(holds, routes))
        return self._policy_knows_overrides

    def end_step(self) -> None:
        if hasattr(self.default_policy, "end_step"):
            self.default_policy.end_step()

    def act_many(self, handles: Iterable[int], observations: Dict[int, Any]) -> Dict[int, Any]:
        handles = [int(h) for h in handles]
        self._pass_committed_overrides()

        if hasattr(self.default_policy, "act_many"):
            actions = dict(self.default_policy.act_many(handles, observations) or {})
        else:
            actions = {
                h: self.default_policy.act(h, observations.get(h))
                for h in handles
            }

        return self.apply_overrides(handles, actions)

    def apply_overrides(self, handles: Iterable[int], proposals: Dict[int, Any]) -> Dict[int, Any]:
        """Apply human actions only when the base proposals will actually step."""
        handles = [int(h) for h in handles]
        actions = dict(proposals)
        self.last_proposed = dict(actions)
        self.last_sources = {h: "policy" for h in actions}
        if self.env is None:
            return actions

        routes = getattr(self.env, "_route_overrides", None) or {}
        for h in handles:
            override_action = override_manager.get(self.session_id, h)
            if override_action is None:
                if h in routes:
                    drop_route(self.env, h)  # its reroute was cleared or replaced
                continue

            if int(override_action) == REROUTE_ACTION:
                move = route_move(self.env, h, override_manager.get_all(self.session_id))
                if move is None:
                    override_manager.clear(self.session_id, h)
                    drop_route(self.env, h)
                elif self._policy_knows_overrides and _is_stop(actions.get(h)):
                    pass  # the policy walked the route and says wait
                else:
                    actions[h] = move
                    self.last_sources[h] = "reroute"
                continue

            agent = self.env.agents[h]

            # Done agents do not need pending overrides anymore.
            if getattr(agent, "state", None) == TrainState.DONE:
                override_manager.clear(self.session_id, h)
                continue

            pos = agent_position(agent)
            direction = agent_direction(agent)

            # Off-map / not ready yet:
            # keep override pending, do not apply.
            if pos is None or direction is None:
                continue

            cur_pos = (int(pos[0]), int(pos[1]))

            # Core bug fix:
            # Override is only consumed at an actual decision point.
            cell_type = classify_cell_at(self.env, cur_pos, int(direction))
            if cell_type not in ("SWITCH", "MERGING"):
                continue

            # At DP: apply override.
            action = RailEnvActions(int(override_action))
            # MARL lab: the moment the human's action replaces the policy's.
            # No-op unless the policy is a learned one (intervention_log.py).
            intervention_log.record_applied(
                self.session_id, self.env, h, self.default_policy, actions.get(h, 0), action,
            )
            actions[h] = action
            self.last_sources[h] = "override"

            # STOP is sticky at the decision point:
            # keep issuing STOP until the user clears/replaces the override.
            #
            # LEFT/FORWARD/RIGHT are one-shot decision actions:
            # apply once at the DP, then clear.
            if action != RailEnvActions.STOP_MOVING:
                override_manager.clear(self.session_id, h)

        return actions

    def act(self, handle: int, observation: Any = None) -> Any:
        handle = int(handle)
        return self.act_many([handle], {handle: observation}).get(handle)

    def act_for_handle(self, handle: int) -> Any:
        """Backwards-compatible helper used by tests/callers."""
        handle = int(handle)
        return self.act_many([handle], {handle: self.env}).get(handle)
