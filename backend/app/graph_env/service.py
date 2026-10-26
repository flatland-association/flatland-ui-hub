"""Graph env playground sessions: one live GraphRailEnv per page load, stepped on demand with the shortest-path policy
(docs/plans/graph-env-playground.md §2).

The env is stepped directly (`policy.act_many` + `env.step`), not through `PolicyRunner`: that needs a trajectory data
dir, and reading graph trajectories back is broken upstream. Sessions live in memory only; every page load creates
one, so the oldest are evicted beyond `MAX_SESSIONS`.
"""
from __future__ import annotations

import threading
import uuid
from collections import OrderedDict

from flatland.envs.graph_rail_env import GraphRailEnv

from app.graph_env.env_factory import GraphShortestPathPolicy, create_playground_env

MAX_SESSIONS = 20


class GraphEnvSession:
    """A live GraphRailEnv and its policy. `step()` and `reset()` hold `lock`, so concurrent requests can't interleave."""

    def __init__(self, session_id: str):
        self.id = session_id
        self.lock = threading.Lock()
        self.env: GraphRailEnv
        self.policy: GraphShortestPathPolicy
        self.done = False
        self.reset()

    def reset(self) -> None:
        with self.lock:
            self.env = create_playground_env()
            self.env.reset()
            self.policy = GraphShortestPathPolicy()
            self.done = False

    def step(self, n: int = 1) -> None:
        """Advance up to `n` steps; stops early once the episode is done (a no-op after that)."""
        with self.lock:
            handles = self.env.get_agent_handles()
            for _ in range(n):
                if self.done:
                    break
                actions = self.policy.act_many(handles, [self.env] * len(handles))
                _, _, dones, _ = self.env.step(actions)
                self.done = bool(dones["__all__"])


class GraphEnvSessions:
    """In-memory sessions by id, at most `max_sessions` - the least recently used is evicted first."""

    def __init__(self, max_sessions: int = MAX_SESSIONS):
        self.max_sessions = max_sessions
        self._sessions: OrderedDict[str, GraphEnvSession] = OrderedDict()
        self._lock = threading.Lock()

    def create(self) -> GraphEnvSession:
        session = GraphEnvSession(uuid.uuid4().hex)
        with self._lock:
            self._sessions[session.id] = session
            while len(self._sessions) > self.max_sessions:
                self._sessions.popitem(last=False)
        return session

    def get(self, session_id: str) -> GraphEnvSession:
        """The session with `session_id`; raises `KeyError` if unknown or evicted."""
        with self._lock:
            session = self._sessions[session_id]
            self._sessions.move_to_end(session_id)
            return session

    def __len__(self) -> int:
        return len(self._sessions)


sessions = GraphEnvSessions()
