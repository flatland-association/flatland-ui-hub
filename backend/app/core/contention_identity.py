"""Canonical references to public contention groups, independent of forecast time."""
import json
from hashlib import sha256


def contention_identity(group: dict) -> str:
    reference = {
        "handles": sorted({int(handle) for handle in group.get("handles", [])}),
        "window": sorted({(int(cell[0]), int(cell[1])) for cell in group.get("window", []) or []}),
    }
    return sha256(json.dumps(reference, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:20]


def referenced_contention(groups: list[dict], contention_id: str | None = None) -> dict | None:
    if contention_id is None:
        return groups[0] if groups else None
    group = next((group for group in groups if contention_identity(group) == contention_id), None)
    if group is None:
        raise LookupError("The referenced contention is no longer present")
    return group
