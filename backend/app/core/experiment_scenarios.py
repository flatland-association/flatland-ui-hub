"""Experiment scenarios: the folder format.

One folder per scenario (docs/reference/experiment-scenarios.md, data model in
docs/plans/experiment-scenario-import.md §3.1): ``scenario.pkl``
(``RailEnvPersister``), ``scenario.json`` (title, description, image, pace),
an optional ``generator.json`` (the scenario generator's output, whose
``timetables[i].name`` names handle *i*) and an optional image. Station names
come from the ``.pkl``'s ``stations_links``. ``config.json`` and ``draw.json``
are the generator's input and not read here.

This module only reads and checks a folder. Where the folders live, and how
they join the preset registry, is ``scenario_presets``'s business, which is
the only importer.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

# Registers the compat effects generators the .pkls name (TODO in there), for
# discovery here and for every session that loads one later.
import app.utils.flatland_compat  # noqa: F401

_log = logging.getLogger(__name__)

_SCENARIO_FIELDS = {"id": True, "title": True, "description": True, "image": False, "source": False}
# Not text: real seconds per simulation step at the scenario's default pace.
_SECONDS_PER_STEP_MIN = 0.1
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}


class ScenarioFolderError(ValueError):
    """A malformed experiment scenario folder, with the file named.
    `scenario_presets.discover_scenarios` leaves such a folder out and logs it."""


def _random_malfunction_rate(env) -> float:
    """The highest rate of a random malfunction generator the env carries, 0 if none."""
    from flatland.core.effects_generator import find_all_effects_generators
    from flatland.envs.malfunction_effects_generators import MalfunctionEffectsGenerator
    from flatland.envs.malfunction_generators import ParamMalfunctionGen

    rates = [
        float(eg.malfunction_generator.get_process_data().malfunction_rate)
        for eg in find_all_effects_generators(env.effects_generator, MalfunctionEffectsGenerator)
        if isinstance(eg.malfunction_generator, ParamMalfunctionGen)
    ]
    return max(rates, default=0.0)


def _stations_links_geography(env) -> dict[str, Any] | None:
    """The env's named stations in the shape of a network sidecar such as
    Olten's: one platform entry per stopping point, `track` its index + 1.
    None when the `.pkl` carries no `stations_links` (built before the
    scenario generator wrote them).

    Read as a corridor: the ZWL (Zeit-Weg-Linie-Diagramm) then draws the stations from
    the farthest left to the farthest right without a picked section. All
    experiment scenarios are single lines for now; a network one would need
    its layout named in `scenario.json`."""
    stations_links = getattr(env, "stations_links", None)
    if not stations_links or not stations_links.stations:
        return None
    return {
        "layout": "corridor",
        "stations": [
            {"code": name, "name": name, "track": i + 1, "cell": [int(sp.node[0]), int(sp.node[1])], "kind": "platform"}
            for name, station in stations_links.stations.items()
            for i, sp in enumerate(station.stopping_points)
        ],
        "locations": [],
        "single_track": [],
    }


def _load_train_names(path: Path, env) -> list[str] | None:
    """Train names in handle order from the scenario generator's output,
    checked against the `.pkl` it was written with: a stale file would put a
    wrong name on a train. None when the folder has no such file."""
    if not path.is_file():
        return None
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ScenarioFolderError(f"{path}: not valid JSON ({e})") from e
    dims = doc.get("gridDimensions") if isinstance(doc, dict) else None
    if not isinstance(dims, dict) or (dims.get("rows"), dims.get("cols")) != (env.height, env.width):
        raise ScenarioFolderError(
            f"{path}: gridDimensions {dims and (dims.get('rows'), dims.get('cols'))} differ from the .pkl's {(env.height, env.width)}"
        )
    timetables = doc.get("timetables")
    if not isinstance(timetables, list) or len(timetables) != len(env.agents):
        raise ScenarioFolderError(
            f"{path}: {len(timetables) if isinstance(timetables, list) else 'no'} timetables for {len(env.agents)} trains in the .pkl"
        )
    names = [t.get("name") if isinstance(t, dict) else None for t in timetables]
    for handle, name in enumerate(names):
        if not isinstance(name, str) or not name.strip():
            raise ScenarioFolderError(f"{path}: timetable {handle} has no name")
    duplicates = sorted({n for n in names if names.count(n) > 1})
    if duplicates:
        raise ScenarioFolderError(f"{path}: train name(s) {', '.join(duplicates)} used more than once")
    return names


def load_scenario_folder(folder: Path) -> dict[str, Any]:
    """One scenario folder as preset fields (all but `kind`, which the
    registry adds); see the module docstring."""
    from flatland.envs.persistence import RailEnvPersister

    meta_path = folder / "scenario.json"
    pkl_path = folder / "scenario.pkl"
    for path in (meta_path, pkl_path):
        if not path.is_file():
            raise ScenarioFolderError(f"{path}: missing")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise ScenarioFolderError(f"{meta_path}: not valid JSON ({e})") from e
    if not isinstance(meta, dict):
        raise ScenarioFolderError(f"{meta_path}: must be a JSON object")
    unknown = set(meta) - set(_SCENARIO_FIELDS) - {"seconds_per_step", "locked"}
    if unknown:
        raise ScenarioFolderError(f"{meta_path}: unknown field(s) {', '.join(sorted(unknown))}")
    for field, required in _SCENARIO_FIELDS.items():
        value = meta.get(field)
        if value is None and not required:
            continue
        if not isinstance(value, str) or not value.strip():
            raise ScenarioFolderError(f"{meta_path}: field {field!r} must be a non-empty string")
    seconds_per_step = meta.get("seconds_per_step")
    if seconds_per_step is not None and (
        isinstance(seconds_per_step, bool)
        or not isinstance(seconds_per_step, (int, float))
        or not seconds_per_step >= _SECONDS_PER_STEP_MIN
    ):
        raise ScenarioFolderError(
            f"{meta_path}: field 'seconds_per_step' must be a number of at least {_SECONDS_PER_STEP_MIN}"
        )
    locked = meta.get("locked", False)
    if not isinstance(locked, bool):
        raise ScenarioFolderError(f"{meta_path}: field 'locked' must be true or false")
    if meta["id"] != folder.name:
        raise ScenarioFolderError(f"{meta_path}: id {meta['id']!r} differs from the folder name {folder.name!r}")

    image = None
    if meta.get("image"):
        # A bare file name in the folder: the image route serves exactly this file.
        image = folder / meta["image"]
        if Path(meta["image"]).name != meta["image"] or not image.is_file():
            raise ScenarioFolderError(f"{meta_path}: image {meta['image']!r} is not a file in {folder}")
        if image.suffix.lower() not in IMAGE_TYPES:
            raise ScenarioFolderError(
                f"{meta_path}: image {meta['image']!r} must be one of {', '.join(sorted(IMAGE_TYPES))}"
            )

    try:
        env, _ = RailEnvPersister.load_new(str(pkl_path))
    except Exception as e:  # noqa: BLE001 — any load failure is the folder's fault
        raise ScenarioFolderError(f"{pkl_path}: cannot be loaded ({e!r})") from e
    rate = _random_malfunction_rate(env)
    if rate > 0:
        _log.warning(
            "%s: random malfunction generator (rate %s) — two participants will see different runs",
            pkl_path, rate,
        )
    train_names = _load_train_names(folder / "generator.json", env)

    return {
        "id": meta["id"],
        "name": meta["title"],
        "title": meta["title"],
        "description": meta["description"],
        "path": pkl_path,
        "image": image,
        "image_url": f"/session/scenario-presets/{meta['id']}/image" if image else None,
        "width": int(env.width),
        "height": int(env.height),
        "agents": len(env.agents),
        "source": meta.get("source") or "Experiment scenario",
        "experiment_only": True,
        "available_modes": ["recommendation", "co-learning", "director"],
        "seconds_per_step": seconds_per_step,
        "locked": locked,
        "geography": _stations_links_geography(env),
        "train_names": train_names,
    }
