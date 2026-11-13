"""Frozen UC2 actor with the evaluated joint/partial60 ROAM controller.

Environment capture, masks and final withdrawal run on the stable session
thread. The inherited infer_prepared method reads only its private feature
batch and shared frozen model in the bounded inference worker. Human overrides
remain a later layer and are outside the autonomous ROAM certificate.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from flatland.envs.rail_env import RailEnv

from app.policies.learned.learned_ppo_policy import (
    N_ACTIONS,
    UC2_CONTEXT_OBSERVATION_SCHEMA,
    LearnedPpoPolicy,
    load_actor_critic,
)
from app.policies.learned import uc2_roam_bundle
from app.policies.learned.roam_check import open_waypoint_groups
from app.policies.learned.roam_joint_check import JointRoamCheck
from app.policies.learned.uc2_bundle import CHECKPOINT


class UC2RoamPolicy(LearnedPpoPolicy):
    """Keep the trained actor and feature schema; constrain its joint proposals."""

    def __init__(self, env: RailEnv | None = None, checkpoint: Path = CHECKPOINT,
                 *, specialists: bool = False):
        self._specialists = specialists
        self.roam_check: JointRoamCheck | None = None
        self._pending_step: int | None = None
        self._pending_handles: tuple[int, ...] = ()
        self._pending_groups: dict | None = None
        super().__init__(env=env, checkpoint=checkpoint)
        if self.model.observation_schema != UC2_CONTEXT_OBSERVATION_SCHEMA:
            raise ValueError("UC2 ROAM requires the uc2-context-v1 checkpoint")

    def reset(self, env: RailEnv) -> None:
        self.roam_check = None
        self._clear_pending()
        super().reset(env)
        if self._specialists:
            uc2_roam_bundle.verify_bundle()
            selected = uc2_roam_bundle.checkpoint_for_scenario(self.obs_builder.scenario_id)
            self.model = load_actor_critic(selected)
            self.checkpoint = selected
        self.roam_check = JointRoamCheck(env, partial_moves=True, max_candidates=60)

    def _clear_pending(self) -> None:
        self._pending_step = None
        self._pending_handles = ()
        self._pending_groups = None

    def prepare_inference(self, handles):
        self._clear_pending()
        prepared = super().prepare_inference(handles)
        selected_handles, observations, width = prepared
        if not selected_handles:
            self._clear_pending()
            return prepared
        check = self.roam_check
        if check is None or self.obs_builder is None:
            raise RuntimeError("UC2RoamPolicy.reset(env) must run before inference")
        all_handles = list(check.env.get_agent_handles())
        if len(selected_handles) != len(all_handles) or set(selected_handles) != set(all_handles):
            raise ValueError("UC2 ROAM requires one complete joint agent batch")
        groups = open_waypoint_groups(self.obs_builder.base)
        safety = check.action_mask(groups)
        selected = observations.copy()
        for index, handle in enumerate(selected_handles):
            mask = np.minimum(observations[index, width:width + N_ACTIONS], safety[handle])
            if not np.any(mask >= .5):
                raise RuntimeError("UC2 ROAM intersection has no legal fallback")
            selected[index, width:width + N_ACTIONS] = mask
        self._pending_step = int(check.env._elapsed_steps)
        self._pending_handles = tuple(selected_handles)
        self._pending_groups = groups
        return selected_handles, selected, width

    def finalize_actions(self, proposals):
        """Certify the whole batch after pure inference, before human overrides."""
        if not proposals and not self._pending_handles:
            return {}
        check = self.roam_check
        if (check is None or self.obs_builder is None
                or self.obs_builder.env is not check.env or self._pending_groups is None
                or self._pending_step != int(check.env._elapsed_steps)
                or set(proposals) != set(self._pending_handles)):
            self._clear_pending()
            raise RuntimeError("UC2 ROAM inference batch is absent or stale")
        try:
            return check.withdraw(proposals, self._pending_groups)
        finally:
            self._clear_pending()

    def act_many(self, handles, observations=None, **kwargs):
        return self.finalize_actions(self.infer_prepared(self.prepare_inference(handles)))

    def act_for_handle(self, handle, observation=None, eps=0.0):
        # ROAM is global per session; never certify one train while silently
        # assuming another train's uncomputed action in the same physical step.
        if self.roam_check is None:
            raise RuntimeError("UC2RoamPolicy.reset(env) must run before inference")
        return self.act_many(self.roam_check.env.get_agent_handles())[handle]
