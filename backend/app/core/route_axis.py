"""Route axis — a time-distance axis between two chosen stations.

The Zug-Weg-Diagramm's v1 axis is "position = grid column", which only holds for
a west-east corridor (Walensee). In a network (Olten) the operator picks a
section instead: from station A to station B. This module turns that choice
into an axis, straight from the rail grid — no `StationsLinks` needed
(docs/plans/zug-weg-route-selection.md).

Method, on Flatland's directed state graph `(row, col, heading)`:

1. Forward shortest distances from every cell of A (any heading the rail
   allows there), backward shortest distances to every cell of B.
2. A state belongs to the route when it lies on a path from A to B that is at
   most `tolerance` cells longer than the shortest one. That takes in parallel
   platform tracks, passing loops and crossovers — they are only a cell or two
   longer — and keeps out loops that run past B and turn back.
3. A cell's axis position is the mean of its distance from A and the route
   length minus its distance to B (minimum over its route states). On the
   shortest path that is just the distance from A; on a parallel track the
   detour cancels, so a station's tracks share (nearly) one position — what the
   column gave for a straight corridor.

Pure: takes the env's rail and cell lists, knows nothing about sessions.
"""
from __future__ import annotations

from collections import deque
from typing import Any, Iterable, Optional

# Flatland: 0=N, 1=E, 2=S, 3=W.
_DELTA = {0: (-1, 0), 1: (0, 1), 2: (1, 0), 3: (0, -1)}

Cell = tuple[int, int]
State = tuple[int, int, int]


def _exits(rail: Any, state: State) -> list[int]:
    r, c, d = state
    try:
        flags = rail.get_transitions(((r, c), d))
    except Exception:
        return []
    return [nd for nd, ok in enumerate(flags) if ok]


def _successors(rail: Any, state: State) -> Iterable[State]:
    """Leaving `state` towards `nd` lands in the neighbour cell heading `nd`."""
    r, c, _ = state
    for nd in _exits(rail, state):
        dr, dc = _DELTA[nd]
        yield (r + dr, c + dc, nd)


def _states_at(rail: Any, cell: Cell) -> list[State]:
    """Headings under which a train can stand in `cell` and move on."""
    return [(cell[0], cell[1], d) for d in range(4) if _exits(rail, (cell[0], cell[1], d))]


def _bfs(starts: Iterable[State], step) -> dict[State, int]:
    dist: dict[State, int] = {}
    queue: deque[State] = deque()
    for s in starts:
        if s not in dist:
            dist[s] = 0
            queue.append(s)
    while queue:
        s = queue.popleft()
        for n in step(s):
            if n not in dist:
                dist[n] = dist[s] + 1
                queue.append(n)
    return dist


def _in_grid(rail: Any, state: State) -> bool:
    return 0 <= state[0] < rail.height and 0 <= state[1] < rail.width


def route_axis(
    rail: Any,
    from_cells: list[Cell],
    to_cells: list[Cell],
    tolerance: Optional[int] = None,
) -> Optional[dict[str, Any]]:
    """`{"length": L, "positions": {cell: pos}}`, or None when B is unreachable from A.

    `tolerance` — how much longer than the shortest A→B path a path may be and
    still count as the same route; default max(8, 15 % of L).
    """
    fwd_step = lambda s: (n for n in _successors(rail, s) if _in_grid(rail, n))
    starts = [s for cell in from_cells for s in _states_at(rail, cell)]
    fwd = _bfs(starts, fwd_step)

    # Backward: predecessors of `s` are states whose successor is `s`. Built
    # from the forward-reachable set only — nothing else can be on an A→B path.
    preds: dict[State, list[State]] = {}
    for s in fwd:
        for n in fwd_step(s):
            preds.setdefault(n, []).append(s)
    targets = {tuple(c) for c in to_cells}
    ends = [s for s in fwd if (s[0], s[1]) in targets]
    if not ends:
        return None
    bwd = _bfs(ends, lambda s: preds.get(s, ()))

    shortest = min(fwd[s] for s in ends)
    tol = tolerance if tolerance is not None else max(8, int(0.15 * shortest))

    # Position = mean of "distance from A" and "length minus distance to B".
    # On a shortest path the two agree. On a parallel track the detour adds to
    # the first after the diversion and to the second before the rejoin, so the
    # mean cancels it midway (at the platform) instead of shifting every
    # further cell by the detour — the station's tracks line up again.
    positions: dict[Cell, float] = {}
    for s, df in fwd.items():
        db = bwd.get(s)
        if db is None or df + db > shortest + tol:
            continue
        cell = (s[0], s[1])
        pos = (df + (shortest - db)) / 2
        if cell not in positions or pos < positions[cell]:
            positions[cell] = pos
    return {"length": shortest, "positions": positions}


__all__ = ["route_axis"]
