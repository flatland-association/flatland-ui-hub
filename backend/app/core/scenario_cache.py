"""Tiny per-session cache for scenario computation.

Two shapes per (session, cache_key) pair:
  * 'scenarios'   — List[Scenario] objects (used by /hmi/recommendations,
                    which needs the full Scenario incl. result + score).
  * 'options'     — List[ScenarioOption] (serialized DTOs, returned by
                    /hmi/scenarios to the frontend).

Both are computed from the same ScenarioBuilder run, so storing both
lets us serve recommendations and scenarios from one compute.

Cache key format: "{step}:{override_hash}"
  - step: elapsed_steps * 1000 + horizon
  - override_hash: MD5 of sorted override items (first 8 chars)
This ensures cache is invalidated when overrides change.
"""
from threading import RLock
from typing import Any, Callable, Dict, List, Optional, Tuple


class ScenarioCache:
    def __init__(self, session_exists: Optional[Callable[[str], bool]] = None):
        # (session_id, cache_key_str) -> {"scenarios": [...], "options": [...]}
        self._cache: Dict[Tuple[str, str], Dict[str, List[Any]]] = {}
        self._session_exists = session_exists
        self._lock = RLock()

    # --- options (serialized DTOs for /hmi/scenarios) ---

    def get(self, session_id: str, cache_key: str) -> Optional[List[Any]]:
        """Get cached options by session and cache key (step:override_hash)."""
        with self._lock:
            entry = self._cache.get((session_id, cache_key))
            return entry["options"] if entry else None

    def put(self, session_id: str, cache_key: str, options: List[Any]) -> None:
        """Store options under session and cache key.

        Backwards-compatible: drops old entries for this session first.
        """
        with self._lock:
            if self._session_exists is not None and not self._session_exists(session_id):
                return
            self._drop_session(session_id)
            self._cache[(session_id, cache_key)] = {"options": options, "scenarios": None}

    # --- full (Scenario objects + options) ---

    def get_scenarios(self, session_id: str, cache_key: str) -> Optional[List[Any]]:
        with self._lock:
            entry = self._cache.get((session_id, cache_key))
            return entry["scenarios"] if entry else None

    def put_full(self, session_id: str, cache_key: str,
                 scenarios: List[Any], options: List[Any]) -> None:
        """Store both shapes from a single ScenarioBuilder compute."""
        with self._lock:
            # Forecasts run in request workers. A forecast that finishes after
            # DELETE must not recreate the deleted session's retained history.
            if self._session_exists is not None and not self._session_exists(session_id):
                return
            self._drop_session(session_id)
            self._cache[(session_id, cache_key)] = {
                "scenarios": scenarios,
                "options": options,
            }

    def clear_session(self, session_id: str) -> None:
        with self._lock:
            self._drop_session(session_id)

    def _drop_session(self, session_id: str) -> None:
        self._cache = {k: v for k, v in self._cache.items() if k[0] != session_id}


def _session_exists(session_id: str) -> bool:
    # Resolve lazily: the session manager imports the policy registry at startup.
    from app.core.session_manager import session_manager

    return session_manager.get(session_id) is not None


scenario_cache = ScenarioCache(session_exists=_session_exists)
