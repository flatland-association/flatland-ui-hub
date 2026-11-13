"""Release Flatland's process-wide, self-keyed caches at session boundaries.

Flatland 4.3 decorates these instance methods with functools.lru_cache. Their
keys retain each environment/rail map, including retired maps with changed
UUIDs, until millions of entries have accumulated. Use only the wrappers'
public cache_clear API; do not replace methods or mutate native cache keys.

Clearing is global because functools cannot evict one instance. Other live
sessions lose cache warmth, then recompute the same pure results. Physics,
rail topology and the live sessions themselves are unchanged. In-flight
forecasts can still retain their working environments until they finish.
"""
from flatland.core.transition_map import GridTransitionMap
from flatland.envs.rail_env import RailEnv
from flatland.envs.rail_grid_transition_map import RailGridTransitionMap

# RailEnv inherits the first two wrappers from AbstractRailEnv: inspecting only
# vars(RailEnv) misses them. action_required is deliberately excluded; its
# bounded static cache has no environment/rail object in its key.
_NATIVE_CACHE_METHODS = (
    (RailEnv, ("_is_speed_zero", "_fast_state_position_sync_check")),
    (RailGridTransitionMap, (
        "get_successor_configurations", "get_predecessor_configurations",
        "_check_action_new", "_check_action_on_agent", "apply_action_independent",
    )),
    (GridTransitionMap, (
        "get_full_transitions", "get_transitions", "get_transition", "is_dead_end",
        "is_simple_turn", "check_path_exists", "cell_neighbours_valid",
        "validate_new_transition", "check_bounds", "is_valid_configuration",
    )),
)


def clear_native_environment_caches() -> None:
    """Drop the seventeen self-keyed native LRUs after disposal or reset.

    Missing wrappers are tolerated for older Flatland versions; the pinned
    4.3 version's complete method inventory is covered by regression tests.
    """
    for owner, names in _NATIVE_CACHE_METHODS:
        for name in names:
            clear = getattr(getattr(owner, name, None), "cache_clear", None)
            if clear is not None:
                clear()
