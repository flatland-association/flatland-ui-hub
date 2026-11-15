"""The existing A/B/C objectives shared by human controls and prepared agents."""

DIRECTOR_STRATEGY_PRESETS: list[dict[str, object]] = [
    {
        "id": "focus_delay",
        "ident": "A",
        "focus": "punctuality",
        "weights": {"punctuality": 5, "connections": 2, "stability": 2},
    },
    {
        "id": "focus_connections",
        "ident": "B",
        "focus": "connections",
        "weights": {"punctuality": 2, "connections": 5, "stability": 2},
    },
    {
        "id": "focus_stability",
        "ident": "C",
        "focus": "stability",
        "weights": {"punctuality": 2, "connections": 2, "stability": 5},
    },
]
