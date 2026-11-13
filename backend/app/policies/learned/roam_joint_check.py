"""Existing MIT conditional proposals and native whole-batch ROAM checking.

Vendored from ecml2026-starterkit/submission/roam_joint_check.py at repository
HEAD ccbcf3de22fb7daa8276948e37819a904aac550e, file commit
9a65f192b35e5be084239f6f4dd1296e04359a5e. Original SHA256:
2718b8ff3b46b51c8f923cc780cd6c1258fe4a75a70ce6fd258d56c5b6858db2.
See LICENSE.roam-starterkit. The JointRoamCheck class algorithm is unchanged;
only imports/provenance are adapted and the upstream observation wrapper is
omitted. The caller supplies its existing authoritative waypoint groups.
Forecasts use currently known malfunctions, never future effects.
"""
from collections import Counter
from time import perf_counter

from flatland.envs.rail_env_action import RailEnvActions
from flatland.envs.step_utils.states import TrainState

from app.policies.learned.roam_check import RoamCheck, fallback_action, predict_configuration


class JointRoamCheck(RoamCheck):
    def action_mask(self, groups):
        start = perf_counter()
        masks = super().action_mask(groups)
        trains, _ = self.snapshot(groups)
        holders = {self.tables.resources[t.node]: h for h, t in trains.items()}
        can_leave = {
            a.handle: any(
                (cfg := predict_configuration(self.env, a, action)) is not None
                and cfg != a.current_configuration
                for action in (2, 1, 3, 0)
            )
            for a in self.env.agents
            if a.state.is_on_map_state()
        }
        for agent in self.env.agents:
            mask = masks[agent.handle]
            for action in range(5):
                if mask[action] > 0.5:
                    continue
                desired = predict_configuration(self.env, agent, action)
                if (
                    desired is not None
                    and desired != agent.current_configuration
                    and self.after_move(trains, agent.handle, desired) is not None
                ):
                    holder = holders.get(self.env.resource_map.get_resource(desired))
                    if (
                        holder is not None
                        and holder != agent.handle
                        and can_leave[holder]
                    ):
                        # This is a conditional proposal, not an approval. The
                        # full native outcome is verified by withdraw below.
                        mask[action] = 1
                        self.masked_actions -= 1
                        self.conditional_proposals = (
                            getattr(self, "conditional_proposals", 0) + 1
                        )
        self.mask_times[-1] = perf_counter() - start
        return masks

    def joint_after(self, original, desired):
        after = dict(original)
        for a in self.env.agents:
            cfg = desired[a.handle]
            if (
                a.state == TrainState.DONE
                or cfg is None
                or cfg == a.current_configuration
            ):
                continue
            after = self.after_move(after, a.handle, cfg)
            if after is None:
                return None
        holders = Counter(self.tables.resources[t.node] for t in after.values())
        return after if all(n <= 1 for n in holders.values()) else None

    def withdraw(self, actions, groups):
        start = perf_counter()
        original, baseline = self.snapshot(groups)
        result = {
            a.handle: int(RailEnvActions.from_value(actions.get(a.handle, 0)).value)
            for a in self.env.agents
        }
        for _ in range(len(self.env.agents) + 1):
            actual = self._resolve_motion(result)
            after = self.joint_after(original, actual)
            stuck = self.stuck(after) if after is not None else set()
            if after is not None and stuck <= baseline:
                break
            movers = [
                a
                for a in self.env.agents
                if actual[a.handle] is not None
                and actual[a.handle] != a.current_configuration
            ]
            if not movers:
                raise RuntimeError("No-motion batch unexpectedly loses its certificate")
            involved = [a for a in movers if a.handle in stuck - baseline]
            victim = max(involved or movers, key=lambda a: a.handle)
            result[victim.handle] = fallback_action(victim)
        else:
            raise RuntimeError("Joint withdrawal exceeded the movement bound")
        self.withdrawn_handles = {
            h
            for h, a in result.items()
            if a != int(RailEnvActions.from_value(actions.get(h, 0)).value)
        }
        self.withdrawals += len(self.withdrawn_handles)
        self.last_predictions = dict(actual)
        for agent in self.env.agents:
            cfg = actual[agent.handle]
            if cfg in agent.targets and cfg != agent.current_configuration:
                self.last_predictions[agent.handle] = None
        self.withdrawal_times.append(perf_counter() - start)
        return result
