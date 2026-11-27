"""Phase-1 proximity recommender: the first concrete InterventionRecommender.

Wraps the existing impact analysis (path/ETA intersection with the blocked cell +
coarse reroute/hold suggestion). Later recommenders (greedy what-if, PP replan,
RL) implement the same interface and register alongside this one.
"""
from __future__ import annotations

from typing import Any, Dict, List

from flatland.envs.rail_env import RailEnv

from app.core.impact_analysis import compute_impact
from app.core.recommenders.base import InterventionRecommender


class Phase1ProximityRecommender(InterventionRecommender):
    id = "proximity"
    label = "Proximity (Phase 1)"
    description = (
        "Flags trains whose path crosses the malfunction's blocked cell before it "
        "clears; suggests reroute (if a switch is reachable first) or hold."
    )
    family = "rule-based"
    deterministic = True
    role = "operational"
    observation = "RailEnv paths and ETAs"
    at_conflict = (
        "Does not plan. For a malfunction it lists the trains that reach the blocked cell "
        "before it clears, and per train suggests a reroute when a switch comes first, "
        "otherwise a hold."
    )
    provenance = "Own implementation (app/core/impact_analysis.py)."
    licence = "Own implementation"
    grounding = (
        "Phase 1 of the tactical recommendation seam: who is affected comes first, "
        "a coherent re-plan (PP) and learned recommenders are planned behind it."
    )

    def recommend(self, env: RailEnv) -> List[Dict[str, Any]]:
        return compute_impact(env)
