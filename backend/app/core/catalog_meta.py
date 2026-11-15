"""Catalog metadata shared by every algorithm seam (docs/plans/algorithm-catalog-all-seams.md).

`PolicySpec` (app/policies/registry.py) carries these fields per policy; the
proposal-agent and recommender seams carry them as class attributes through
this mixin, so the Algorithm Gallery can describe an algorithm at any seam and
the description stays next to the code that runs. No imports on purpose: the
seam base classes import it.
"""
from __future__ import annotations

from typing import Tuple


class CatalogMeta:
    #: How it decides: rule-based | search-based | learned | hybrid.
    family: str = "rule-based"
    #: Same env + same seed -> same output?
    deterministic: bool = True
    #: Why it is in the list: operational | baseline | diagnostic.
    role: str = "operational"
    #: What it reads from the env.
    observation: str = "RailEnv (direct)"
    #: The operationally interesting bit: behaviour when trains contend.
    at_conflict: str = ""
    #: Where the implementation comes from.
    provenance: str = ""
    #: Licence of the source. Blocking question for any open-source release.
    licence: str = "Own implementation"
    #: Why this exists — a source, a paper, or control-room practice.
    grounding: str = ""
    #: Other places in the playground that run the same algorithm.
    used_in: Tuple[str, ...] = ()
