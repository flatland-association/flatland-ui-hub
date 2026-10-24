# Vendored from flatland-association/ecml2026-starterkit
# (reinforcement_learning/my_observation_builder.py, commit 54edacd), MIT,
# see LICENSE.ecml2026-starterkit. Unchanged apart from this header and one
# grid-edge guard in _explore (marked LOCAL CHANGE), so the pretrained
# checkpoint sees exactly the features it was trained on.
# docs/plans/marl-lab-plan.md, step 1.

from collections import deque

import numpy as np
from flatland.core.env_observation_builder import ObservationBuilder
from flatland.core.grid.grid4_utils import get_new_position
from flatland.envs.fast_methods import fast_argmax, fast_count_nonzero
from flatland.envs.step_utils.states import TrainState

from app.utils.agent_compat import (
    agent_direction,
    agent_initial_direction,
    agent_initial_position,
    agent_planned_target,
    agent_position,
)

"""
Based on the FastTreeObs implementation by Adrian Egli (adrian.egli@gmail.com)
Extended by the Flatland Association team for environments with intermediate waypoints and additional observation features.
"""


class FastTreeObsBuilder(ObservationBuilder):

    # Fixed observation length. Indices 0..35 are documented in `get()`.
    OBSERVATION_DIM = 36

    # RailEnvActions: 0 DO_NOTHING, 1 LEFT, 2 FORWARD, 3 RIGHT, 4 STOP.
    # Mask is appended to every observation when with_action_mask=True.
    ACTION_MASK_SIZE = 5

    def __init__(self, max_depth=3, with_action_mask=True):
        self.max_depth = max_depth
        # Append an action mask after the feature block. Useful at inference
        # (no env access in the policy); training computes its own mask from
        # the env, so set with_action_mask=False there.
        self.with_action_mask = with_action_mask
        # handle -> index into agent.waypoints of last stop visited
        self.waypoint_index = {}
        # handle -> np.ndarray (height, width, 4) BFS distance to next waypoint
        self._waypoint_distance_maps = {}
        self._switches_built = False

    # ------------------------------------------------------------------
    # Topology pre-computation: switches and their neighbours.
    # ------------------------------------------------------------------

    def build_data(self):
        if self.env is not None:
            self.env.dev_obs_dict = {}
        self.switches = {}
        self.switches_neighbours = {}
        self._switches_built = False
        if self.env is not None and self.env.rail is not None:
            self.find_all_cell_where_agent_can_choose()
            self._switches_built = True

    def find_all_cell_where_agent_can_choose(self):
        """Scan the grid once and record:
          - switches: cells with >1 outgoing transition for some incoming direction.
          - switches_neighbours: cells one step before a switch.
        Both are dicts: position -> list of incoming directions where the
        property holds.
        """
        switches = {}
        for h in range(self.env.height):
            for w in range(self.env.width):
                pos = (h, w)
                for dir in range(4):
                    possible_transitions = self.env.rail.get_transitions((pos, dir))
                    if fast_count_nonzero(possible_transitions) > 1:
                        switches.setdefault(pos, []).append(dir)

        switches_neighbours = {}
        for h in range(self.env.height):
            for w in range(self.env.width):
                pos = (h, w)
                for dir in range(4):
                    possible_transitions = self.env.rail.get_transitions((pos, dir))
                    for d in range(4):
                        if possible_transitions[d] == 1:
                            new_cell = get_new_position(pos, d)
                            if new_cell in switches and pos not in switches:
                                switches_neighbours.setdefault(pos, []).append(dir)

        self.switches = switches
        self.switches_neighbours = switches_neighbours

    def check_agent_decision(self, position, direction):
        """Classify (position, direction) wrt switch topology.

        Returns:
          agents_on_switch          - on a switch and the incoming direction
                                      actually has a choice
          agents_near_to_switch     - one step before a switch (and the next
                                      cell is not itself a no-choice cell for
                                      this direction)
          agents_near_to_switch_all - one step before a switch, regardless
        """
        switches = self.switches
        switches_neighbours = self.switches_neighbours
        agents_on_switch = False
        agents_near_to_switch = False
        agents_near_to_switch_all = False

        if position in switches:
            agents_on_switch = direction in switches[position]

        if position in switches_neighbours:
            new_cell = get_new_position(position, direction)
            if new_cell in switches:
                # Only flag "near switch" if that direction does NOT itself
                # have a choice on the next cell (otherwise we'd double-count).
                if direction not in switches[new_cell]:
                    agents_near_to_switch = direction in switches_neighbours[position]
            else:
                agents_near_to_switch = direction in switches_neighbours[position]

            agents_near_to_switch_all = direction in switches_neighbours[position]

        return agents_on_switch, agents_near_to_switch, agents_near_to_switch_all

    # ------------------------------------------------------------------
    # Reset / per-handle state.
    # ------------------------------------------------------------------

    def reset(self, env=None):
        if env is not None:
            super().reset(env)
        self.build_data()
        self.waypoint_index = {}
        self._waypoint_distance_maps = {}
        if self.env is not None and self.env.rail is not None:
            for handle in range(self.env.get_num_agents()):
                self.waypoint_index[handle] = 0
                self._recompute_distance_map(handle)

    def _ensure_handle_initialized(self, handle):
        """Lazy init for a handle. Covers the case where reset() ran before
        env.rail was populated."""
        if not self._switches_built and self.env.rail is not None:
            self.find_all_cell_where_agent_can_choose()
            self._switches_built = True
        if handle not in self.waypoint_index:
            self.waypoint_index[handle] = 0
            self._recompute_distance_map(handle)

    # ------------------------------------------------------------------
    # Waypoint tracking and distance maps.
    # ------------------------------------------------------------------

    def _get_next_waypoint_target(self, handle):
        """Position of the next waypoint stop. waypoint_index tracks the last
        stop visited (0 = not departed). Falls back to final target once all
        intermediate stops are done."""
        agent = self.env.agents[handle]
        wps = agent.waypoints
        next_idx = self.waypoint_index[handle] + 1
        if next_idx < len(wps):
            # Take the first alternative of the waypoint group.
            return wps[next_idx][0].position
        return agent_planned_target(agent)

    def _compute_bfs_distance_map(self, target_position):
        """BFS backward from target_position over the directed rail graph.
        Returns dist[row, col, direction], inf where unreachable."""
        rail = self.env.rail
        height, width = self.env.height, self.env.width
        dist = np.full((height, width, 4), np.inf)

        # Seed: target reachable in any direction with cost 0, but only for
        # directions that correspond to a real rail configuration.
        queue = deque()
        for d in range(4):
            if rail.get_transitions((target_position, d)) != (0, 0, 0, 0):
                dist[target_position[0], target_position[1], d] = 0
                queue.append((target_position, d, 0))

        while queue:
            pos, direction, current_dist = queue.popleft()
            # Predecessor cell = one step opposite to current direction.
            prev_pos = get_new_position(pos, (direction + 2) % 4)
            if not (0 <= prev_pos[0] < height and 0 <= prev_pos[1] < width):
                continue
            for agent_dir in range(4):
                if rail.get_transition((prev_pos, agent_dir), direction):
                    new_dist = current_dist + 1
                    if new_dist < dist[prev_pos[0], prev_pos[1], agent_dir]:
                        dist[prev_pos[0], prev_pos[1], agent_dir] = new_dist
                        queue.append((prev_pos, agent_dir, new_dist))

        return dist

    def _recompute_distance_map(self, handle):
        target_pos = self._get_next_waypoint_target(handle)
        self._waypoint_distance_maps[handle] = self._compute_bfs_distance_map(target_pos)

    def _get_distance_map(self, handle):
        """Distance map for the agent's current next waypoint. If the agent
        only has start+target (no intermediate stops), reuse the env's
        built-in distance map."""
        agent = self.env.agents[handle]
        if len(agent.waypoints) <= 2:
            return self.env.distance_map.get()[handle]
        return self._waypoint_distance_maps[handle]

    def _check_and_advance_waypoint(self, handle):
        """If the agent's current cell matches the next waypoint, advance
        the index and recompute the distance map for the new target."""
        self._ensure_handle_initialized(handle)
        agent = self.env.agents[handle]
        wps = agent.waypoints
        if len(wps) <= 2:
            return  # no intermediate stops

        next_idx = self.waypoint_index[handle] + 1
        if next_idx >= len(wps):
            return  # already at or past final target

        pos = agent_position(agent)
        if pos is None:
            return

        for wp in wps[next_idx]:
            if wp.position == pos:
                self.waypoint_index[handle] = next_idx
                self._recompute_distance_map(handle)
                break

    # ------------------------------------------------------------------
    # Forward exploration along a branch (used to detect blocking agents
    # and downstream switches).
    # ------------------------------------------------------------------

    def _explore(self, handle, new_position, new_direction, depth=0):
        has_opp_agent = 0
        has_same_agent = 0
        has_switch = 0
        visited = []

        if depth >= self.max_depth:
            return has_opp_agent, has_same_agent, has_switch, visited

        # Walk forward up to 100 cells, stopping at: a blocking agent, a
        # near-switch cell, or a switch (where we recurse on each branch).
        cnt = 0
        while cnt < 100:
            cnt += 1
            # LOCAL CHANGE (flatland-ui-hub): stop at the grid edge. Networks
            # with open track ends at the border (Olten) walk off the map here;
            # the ECML topology never does. Treated like the end of a branch.
            if not (0 <= new_position[0] < self.env.height and 0 <= new_position[1] < self.env.width):
                return has_opp_agent, has_same_agent, has_switch, visited
            visited.append(new_position)

            # Detect another agent in this cell.
            opp_a = self.env.agent_positions[new_position]
            if opp_a != -1 and opp_a != handle:
                if agent_direction(self.env.agents[opp_a]) != new_direction:
                    has_opp_agent = 1
                else:
                    has_same_agent = 1
                return has_opp_agent, has_same_agent, has_switch, visited

            agents_on_switch, agents_near_to_switch, _ = self.check_agent_decision(
                new_position, new_direction
            )
            if agents_near_to_switch:
                return has_opp_agent, has_same_agent, has_switch, visited

            possible_transitions = self.env.rail.get_transitions(
                (new_position, new_direction)
            )
            if agents_on_switch:
                # Recurse on each outgoing branch, average results.
                f = 0
                for dir_loop in range(4):
                    if possible_transitions[dir_loop] == 1:
                        f += 1
                        hoa, hsa, hs, v = self._explore(
                            handle,
                            get_new_position(new_position, dir_loop),
                            dir_loop,
                            depth + 1,
                        )
                        visited.append(v)
                        has_opp_agent += hoa
                        has_same_agent += hsa
                        has_switch += hs
                f = max(f, 1.0)
                return has_opp_agent / f, has_same_agent / f, has_switch / f, visited
            else:
                # Straight track: follow the single transition.
                new_direction = fast_argmax(possible_transitions)
                new_position = get_new_position(new_position, new_direction)

        return has_opp_agent, has_same_agent, has_switch, visited

    # ------------------------------------------------------------------
    # Main observation.
    # ------------------------------------------------------------------

    def get(self, handle):
        # Observation layout (all values in [0,1]):
        #  0..3   per-direction flag: this branch leads closer to the next waypoint
        #  4      state == READY_TO_DEPART
        #  5      state in {MOVING, STOPPED, MALFUNCTION}
        #  6      state in {DONE, DONE_REMOVED}
        #  7      on a switch (routing decision required)
        #  8      one step before a switch (stop-or-go decision)
        #  9      one step before/after a switch (regardless of direction choice)
        # 10..13  per-direction flag: a transition exists in that direction
        # 14..17  per-direction: opposite-direction agent ahead on this branch
        # 18..21  per-direction: same-direction agent ahead on this branch
        # 22..25  per-direction: a switch (not usable by us) lies ahead
        # 26..29  per-direction: normalised distance to next waypoint (1.0 = unreachable)
        # 30      priority signal: normalised distance from current cell to next waypoint
        # 31      elapsed-time fraction
        # 32      fraction of agents currently active
        # 33      proximity to next stop (1 at stop, decays with distance)
        # 34      fraction of intermediate waypoints already served
        # 35      time slack: fraction of remaining steps until latest arrival

        observation = np.zeros(self.OBSERVATION_DIM, dtype=np.float32)
        visited = []
        agent = self.env.agents[handle]

        # Advance waypoint index if agent reached the next stop.
        self._check_and_advance_waypoint(handle)

        # --- State flags (obs[4..6]) and current virtual position. ---
        agent_done = False
        if agent.state == TrainState.READY_TO_DEPART:
            agent_virtual_position = agent_initial_position(agent)
            observation[4] = 1
        elif agent.state in (
            TrainState.MOVING,
            TrainState.STOPPED,
            TrainState.MALFUNCTION,
        ):
            agent_virtual_position = agent_position(agent)
            observation[5] = 1
        else:
            observation[6] = 1
            agent_virtual_position = (-1, -1)
            agent_done = True

        # READY_TO_DEPART agents have no current direction until they enter
        # the grid; fall back to the initial one.
        direction = agent_direction(agent)
        if direction is None:
            direction = agent_initial_direction(agent)

        max_dist = self.env.width + self.env.height

        # --- Per-branch features (obs[0..3], [10..29]). ---
        if not agent_done:
            visited.append(agent_virtual_position)
            distance_map = self._get_distance_map(handle)
            current_cell_dist = distance_map[
                agent_virtual_position[0], agent_virtual_position[1], direction
            ]
            possible_transitions = self.env.rail.get_transitions(
                (agent_virtual_position, direction)
            )
            # In a single-transition cell the "orientation" is the forced
            # outgoing direction; otherwise it equals agent direction. This
            # is the reference frame used to map (left, forward, right, back)
            # onto absolute directions.
            orientation = direction
            if fast_count_nonzero(possible_transitions) == 1:
                orientation = fast_argmax(possible_transitions)

            for dir_loop, branch_direction in enumerate(
                [(orientation + dir_loop) % 4 for dir_loop in range(-1, 3)]
            ):
                if possible_transitions[branch_direction]:
                    new_position = get_new_position(
                        agent_virtual_position, branch_direction
                    )
                    new_cell_dist = distance_map[
                        new_position[0], new_position[1], branch_direction
                    ]
                    # Binary "is this branch closer to the goal".
                    if not (np.isinf(new_cell_dist) and np.isinf(current_cell_dist)):
                        observation[dir_loop] = int(new_cell_dist < current_cell_dist)

                    # Continuous normalised distance per direction.
                    observation[26 + dir_loop] = (
                        new_cell_dist / max_dist if np.isfinite(new_cell_dist) else 1.0
                    )

                    # Walk this branch to find blockers and downstream switches.
                    has_opp_agent, has_same_agent, has_switch, v = self._explore(
                        handle, new_position, branch_direction
                    )
                    visited.append(v)

                    observation[10 + dir_loop] = 1
                    observation[14 + dir_loop] = has_opp_agent
                    observation[18 + dir_loop] = has_same_agent
                    observation[22 + dir_loop] = has_switch

        # --- Switch-context flags (obs[7..9]). ---
        agents_on_switch, agents_near_to_switch, agents_near_to_switch_all = (
            self.check_agent_decision(agent_virtual_position, direction)
        )
        observation[7] = int(agents_on_switch)
        observation[8] = int(agents_near_to_switch)
        observation[9] = int(agents_near_to_switch_all)

        # --- Global / scalar features (obs[30..35]). ---
        nb_active_agents = sum(
            1
            for h in self.env.get_agent_handles()
            if self.env.agents[h].state
            in (TrainState.MOVING, TrainState.STOPPED, TrainState.MALFUNCTION)
        )

        # Priority signal: closer agents get lower values, letting the
        # network learn right-of-way without depending on agent IDs.
        if not agent_done:
            observation[30] = (
                current_cell_dist / max_dist if np.isfinite(current_cell_dist) else 1.0
            )
        else:
            observation[30] = 0.0

        observation[31] = (
            self.env._elapsed_steps / self.env._max_episode_steps
            if self.env._max_episode_steps > 0
            else 0.0
        )
        observation[32] = nb_active_agents / self.env.get_num_agents()

        # Proximity to next stop: 1.0 at the stop, decays linearly with distance.
        if not agent_done and np.isfinite(current_cell_dist):
            observation[33] = max(0.0, 1.0 - current_cell_dist / max(1, max_dist))
        else:
            observation[33] = 0.0

        # Fraction of intermediate waypoints served (excludes start + final target).
        wps = agent.waypoints
        n_intermediate = max(len(wps) - 2, 0)
        if n_intermediate > 0:
            served = min(max(0, self.waypoint_index[handle]), n_intermediate)
            observation[34] = served / n_intermediate
        else:
            observation[34] = 1.0

        # Time slack: fraction of episode remaining until the next stop's
        # latest-arrival deadline (or the agent's overall deadline).
        next_idx = self.waypoint_index[handle] + 1
        wps_la = agent.waypoints_latest_arrival
        deadline = None
        if next_idx < len(wps_la) and wps_la[next_idx] is not None:
            deadline = wps_la[next_idx]
        elif agent.latest_arrival is not None:
            deadline = agent.latest_arrival
        if deadline is not None:
            remaining = deadline - self.env._elapsed_steps
            max_steps = self.env._max_episode_steps
            observation[35] = max(0.0, min(1.0, remaining / max(1, max_steps)))
        else:
            observation[35] = 1.0

        self.env.dev_obs_dict.update({handle: visited})

        if not self.with_action_mask:
            return observation

        # --- Action mask (appended after the feature block). ---
        # State-aware mask: training slices it from the observation directly,
        # so the same valid-action set is used at training and inference time.
        mask = np.zeros(self.ACTION_MASK_SIZE, dtype=np.float32)
        mask[0] = 1.0  # DO_NOTHING always valid

        if agent_done or agent.state == TrainState.WAITING:
            # WAITING: only DO_NOTHING has any effect.
            # Done: agent is removed; mask is irrelevant but fail-closed.
            pass
        elif agent_position(agent) is None:
            # READY_TO_DEPART: agent enters the grid by moving forward.
            mask[2] = 1.0  # MOVE_FORWARD
        else:
            # On-map: STOP always valid; L/F/R from rail transitions.
            mask[4] = 1.0  # STOP_MOVING
            pt = self.env.rail.get_transitions((agent_position(agent), agent_direction(agent)))
            d = int(agent_direction(agent))
            mask[1] = float(pt[(d - 1) % 4])
            mask[2] = float(pt[d])
            mask[3] = float(pt[(d + 1) % 4])

        return np.concatenate([observation, mask])

    @staticmethod
    def agent_can_choose(observation):
        return observation[7] == 1 or observation[8] == 1


MyObservationBuilder = FastTreeObsBuilder
