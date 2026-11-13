"""Derived relative peer features for the fixed PF-CH observation contract.

The original272 features are preserved exactly. Six features per peer are
appended, using only the original vector: own-heading projected distance,
row difference, heading agreement, opposing/same-direction ahead proximity,
and relative release slack. There is no plan, teacher action or future input.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np

from app.policies.learned.pf_ch_observation import (
    BASE_FEATURES,
    CONTEXT_OFFSET,
    MAX_TRAINS,
    OWN_FEATURE_NAMES,
    PEER_FEATURE_NAMES,
    PEER_FEATURES,
    PFChObservationBuilder,
)
from app.policies.learned.pf_ch_observation import (
    OBSERVATION_DIM as CONTEXT_DIM,
)

OBSERVATION_SCHEMA = "pf-ch-relative-v1"
CONTEXT_SCHEMA = "pf-ch-context-v1"
RELATIVE_FEATURE_NAMES = (
    "along_distance",
    "row_delta",
    "heading_dot",
    "opponent_ahead_proximity",
    "same_direction_ahead_proximity",
    "release_slack_delta",
)
RELATIVE_FEATURES = len(RELATIVE_FEATURE_NAMES)
OBSERVATION_DIM = CONTEXT_DIM + MAX_TRAINS * RELATIVE_FEATURES
PF_CH_HEIGHT = 9
PF_CH_WIDTH = 191


def augment_context_features(context: np.ndarray) -> np.ndarray:
    """Map (...,272) to (...,368) without an environment or policy query."""
    features = np.asarray(context, dtype=np.float32)
    if features.ndim < 1 or features.shape[-1] != CONTEXT_DIM or not np.isfinite(features).all():
        raise ValueError("relative PF-CH features require finite272-feature context vectors")
    peers = features[..., CONTEXT_OFFSET:].reshape(*features.shape[:-1], MAX_TRAINS, PEER_FEATURES)
    own = features[..., BASE_FEATURES:CONTEXT_OFFSET]
    own_id = np.rint(own[..., OWN_FEATURE_NAMES.index("handle")] * (MAX_TRAINS - 1)).astype(np.int64)
    if np.any((own_id < 0) | (own_id >= MAX_TRAINS)):
        raise ValueError("relative PF-CH features require own handle in0..15")
    # Coordinates in the source vector represent discrete cells. Reconstruct
    # them before subtraction, avoiding float32 normalisation boundary noise.
    row_delta = (
        np.rint(peers[..., PEER_FEATURE_NAMES.index("row")] * (PF_CH_HEIGHT - 1))
        - np.rint(own[..., OWN_FEATURE_NAMES.index("row")] * (PF_CH_HEIGHT - 1))[..., None]
    )
    col_delta = (
        np.rint(peers[..., PEER_FEATURE_NAMES.index("column")] * (PF_CH_WIDTH - 1))
        - np.rint(own[..., OWN_FEATURE_NAMES.index("column")] * (PF_CH_WIDTH - 1))[..., None]
    )
    own_sin = own[..., OWN_FEATURE_NAMES.index("heading_sin")][..., None]
    own_cos = own[..., OWN_FEATURE_NAMES.index("heading_cos")][..., None]
    along = col_delta * own_sin - row_delta * own_cos
    heading_dot = (
        peers[..., PEER_FEATURE_NAMES.index("heading_sin")] * own_sin
        + peers[..., PEER_FEATURE_NAMES.index("heading_cos")] * own_cos
    )
    slack_delta = (
        peers[..., PEER_FEATURE_NAMES.index("departure_slack")]
        - own[..., OWN_FEATURE_NAMES.index("departure_slack")][..., None]
    )
    on_map_ahead = (peers[..., PEER_FEATURE_NAMES.index("on_map")] > 0.5) & (along > 0)
    proximity = 1.0 / (1.0 + np.maximum(along, 0.0) / 8.0)
    relative = np.stack(
        (
            np.clip(along / 20.0, -1.0, 1.0),
            np.clip(row_delta / 2.0, -1.0, 1.0),
            np.clip(heading_dot, -1.0, 1.0),
            np.where(on_map_ahead & (heading_dot < -0.5), proximity, 0.0),
            np.where(on_map_ahead & (heading_dot > 0.5), proximity, 0.0),
            np.clip(slack_delta * 16.0, -1.0, 1.0),
        ),
        axis=-1,
    )
    valid = (
        (peers[..., PEER_FEATURE_NAMES.index("present")] > 0.5)
        & (peers[..., PEER_FEATURE_NAMES.index("done")] < 0.5)
        & (np.arange(MAX_TRAINS) != own_id[..., None])
    )
    relative = np.where(valid[..., None], relative, 0.0).astype(np.float32)
    return np.concatenate((features, relative.reshape(*features.shape[:-1], MAX_TRAINS * RELATIVE_FEATURES)), axis=-1)


def augment_observation(observation: np.ndarray, *, with_action_mask: bool = True) -> np.ndarray:
    """Append derived features before, never inside, the original action mask."""
    observation = np.asarray(observation, dtype=np.float32)
    expected = CONTEXT_DIM + (PFChObservationBuilder.ACTION_MASK_SIZE if with_action_mask else 0)
    if observation.ndim < 1 or observation.shape[-1] != expected:
        raise ValueError("context observation width does not match its mask contract")
    features = augment_context_features(observation[..., :CONTEXT_DIM])
    return np.concatenate((features, observation[..., CONTEXT_DIM:]), axis=-1) if with_action_mask else features


class PFChRelativeObservationBuilder(PFChObservationBuilder):
    """Same physical observations and masks, with explicit relative features."""

    OBSERVATION_SCHEMA = OBSERVATION_SCHEMA
    OBSERVATION_DIM = OBSERVATION_DIM

    def __init__(self, max_depth: int = 3, with_action_mask: bool = True) -> None:
        super().__init__(max_depth=max_depth, with_action_mask=with_action_mask)
        self.schema = OBSERVATION_SCHEMA

    def get(self, handle: int = 0) -> np.ndarray:
        return augment_observation(super().get(handle), with_action_mask=self.with_action_mask)

    def get_many(self, handles: Iterable[int] | None = None) -> dict[int, np.ndarray]:
        return {
            handle: augment_observation(value, with_action_mask=self.with_action_mask)
            for handle, value in super().get_many(handles).items()
        }


def augment_demonstrations(source, output) -> dict:
    """Stream a272-feature teacher file to368 features; preserve actions/data."""
    import hashlib
    import json
    from pathlib import Path

    source, output = Path(source), Path(output)
    manifest = output.with_suffix(".manifest.json")
    temporary = output.with_suffix(output.suffix + ".tmp")
    if output.exists() or manifest.exists() or temporary.exists():
        raise FileExistsError("choose a fresh derived dataset name")
    output.parent.mkdir(parents=True, exist_ok=True)
    source_hash = hashlib.sha256()
    output_hash = hashlib.sha256()
    count = 0
    with source.open("rb") as incoming, temporary.open("wb") as outgoing:
        for number, raw in enumerate(incoming, 1):
            source_hash.update(raw)
            if not raw.strip():
                continue
            row = json.loads(raw)
            if row.get("observation_schema") != CONTEXT_SCHEMA:
                raise ValueError(f"{source}:{number}: expected original context schema")
            row["obs"] = augment_context_features(row["obs"]).tolist()
            row["observation_schema"] = OBSERVATION_SCHEMA
            row["derived_from_observation_schema"] = CONTEXT_SCHEMA
            encoded = (json.dumps(row, separators=(",", ":")) + "\n").encode()
            outgoing.write(encoded)
            output_hash.update(encoded)
            count += 1
    temporary.replace(output)
    report = {
        "schema": "pf-ch-derived-teacher-v1",
        "source": str(source),
        "source_sha256": source_hash.hexdigest(),
        "output": str(output),
        "output_sha256": output_hash.hexdigest(),
        "records": count,
        "input_observation_schema": CONTEXT_SCHEMA,
        "observation_schema": OBSERVATION_SCHEMA,
        "obs_size": OBSERVATION_DIM,
        "new_teacher_rollouts": 0,
        "transform_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    manifest.write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Derive relative features from existing context teacher records")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(augment_demonstrations(args.input, args.output), indent=2), flush=True)
