"""
Per-Session Per-Agent Action Overrides.

User sets an override action for an agent. The override applies at the
NEXT SWITCH/MERGING cell the agent reaches (sticky while at that position).
Once the agent moves away, the override auto-clears.

We track the action value. Position tracking is done by OverridePolicy.
"""
from typing import Dict, Optional, Set


class OverrideManager:
    """In-Memory Override Storage."""

    def __init__(self):
        # session_id -> handle -> action_int
        self._overrides: Dict[str, Dict[int, int]] = {}
        # session_id -> handles whose override the system set (the automatic
        # hold of an affected train), not the operator (#230)
        self._system: Dict[str, Set[int]] = {}

    def set(self, session_id: str, handle: int, action: int, system: bool = False) -> None:
        """Set override action for an agent; `system`: set by the HMI, not the operator."""
        if session_id not in self._overrides:
            self._overrides[session_id] = {}
        self._overrides[session_id][handle] = int(action)
        if system:
            self._system.setdefault(session_id, set()).add(handle)
        else:
            self._system.get(session_id, set()).discard(handle)

    def is_system(self, session_id: str, handle: int) -> bool:
        """Whether the agent's override was set by the system, not the operator."""
        return handle in self._system.get(session_id, set())

    def get(self, session_id: str, handle: int) -> Optional[int]:
        """Get override action (if set)."""
        return self._overrides.get(session_id, {}).get(handle)

    def clear(self, session_id: str, handle: int) -> None:
        """Clear override for an agent."""
        if session_id in self._overrides:
            self._overrides[session_id].pop(handle, None)
        self._system.get(session_id, set()).discard(handle)

    def clear_all(self, session_id: str) -> None:
        """Clear all overrides for a session."""
        self._overrides.pop(session_id, None)
        self._system.pop(session_id, None)

    def get_all(self, session_id: str) -> Dict[int, int]:
        """Return all overrides (as action values)."""
        return dict(self._overrides.get(session_id, {}))


override_manager = OverrideManager()
