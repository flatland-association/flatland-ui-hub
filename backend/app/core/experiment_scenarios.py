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
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError

# Registers the compat effects generators the .pkls name (TODO in there), for
# discovery here and for every session that loads one later.
import app.utils.flatland_compat  # noqa: F401

_log = logging.getLogger(__name__)

# Not text: real seconds per simulation step at the scenario's default pace.
_SECONDS_PER_STEP_MIN = 0.1
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}


class ScenarioFolderError(ValueError):
    """A malformed experiment scenario folder, with the file named.
    `scenario_presets.discover_scenarios` leaves such a folder out and logs it."""


def _not_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must be a non-empty string")
    return value


_Text = Annotated[str, Field(strict=True, min_length=1), AfterValidator(_not_blank)]


class ScenarioMeta(BaseModel):
    """``scenario.json``: the one file format of a scenario folder that is
    ours. Its JSON schema is ``fixtures/plan-b/scenario.schema.json``
    (``write_schema``, kept current by a test)."""

    model_config = ConfigDict(
        extra="forbid",
        title="Flatland Dispatcher experiment scenario",
        json_schema_extra={
            "description": "scenario.json of an experiment scenario folder: the intro card's texts and image, "
            "the pace, and whether a session may add anything on top of the .pkl "
            "(docs/reference/experiment-scenarios.md).",
        },
    )

    id: _Text = Field(description="Equals the folder name, and differs from every built-in preset id.")
    title: _Text = Field(description="Heading of the intro card, and the scenario's name in a leg's label.")
    description: _Text = Field(description="Plain text; blank lines separate paragraphs.")
    image: _Text | None = Field(None, description="A file name in the same folder: .png, .jpg/.jpeg or .svg.")
    source: _Text | None = Field(None, description="Where the scenario comes from.")
    seconds_per_step: Annotated[float, Field(strict=True, ge=_SECONDS_PER_STEP_MIN)] | None = Field(
        None, description="Real seconds one step lasts at the speed slider's «Normal»; without it 2 s.")
    locked: Annotated[bool, Field(strict=True)] = Field(
        False, description="true: the scenario runs exactly as its .pkl says; a session adds nothing on top.")


# The message per field, so a file author reads what is wanted, not pydantic's wording.
_FIELD_RULES = {
    "seconds_per_step": f"must be a number of at least {_SECONDS_PER_STEP_MIN}",
    "locked": "must be true or false",
}


def _meta_error(meta_path: Path, error: ValidationError) -> ScenarioFolderError:
    errors = error.errors()
    unknown = sorted(str(e["loc"][0]) for e in errors if e["type"] == "extra_forbidden")
    if unknown:
        return ScenarioFolderError(f"{meta_path}: unknown field(s) {', '.join(unknown)}")
    first = errors[0]
    if not first["loc"]:
        return ScenarioFolderError(f"{meta_path}: must be a JSON object")
    field = str(first["loc"][0])
    return ScenarioFolderError(
        f"{meta_path}: field {field!r} {_FIELD_RULES.get(field, 'must be a non-empty string')}"
    )


SCHEMA_PATH = Path(__file__).resolve().parent.parent / "fixtures" / "plan-b" / "scenario.schema.json"


def scenario_schema() -> dict[str, Any]:
    """``ScenarioMeta``'s JSON schema, as committed in ``SCHEMA_PATH``."""
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", **ScenarioMeta.model_json_schema()}


def write_schema() -> None:
    """Rewrite the committed schema: ``python -m app.core.experiment_scenarios``."""
    SCHEMA_PATH.write_text(json.dumps(scenario_schema(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


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


def _check_scheduled_malfunctions(env, pkl_path: Path) -> None:
    """Every scheduled malfunction names a train of the scenario: a wrong
    handle would load fine and only fail at its step, during a study."""
    from flatland.core.effects_generator import find_all_effects_generators
    from flatland.envs.malfunction_effects_generators import ScheduledMalfunctionEffectsGenerator

    n = len(env.agents)
    for eg in find_all_effects_generators(env.effects_generator, ScheduledMalfunctionEffectsGenerator):
        for m in eg.malfunctions:
            if not 0 <= m.handle < n:
                raise ScenarioFolderError(
                    f"{pkl_path}: scheduled malfunction at step {m.step} names train {m.handle}, "
                    f"but the scenario has {n} trains (0–{n - 1})"
                )


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


def _read_scenario_meta(meta_path: Path) -> dict[str, Any]:
    """``scenario.json`` checked against ``ScenarioMeta``, as a dict."""
    try:
        return ScenarioMeta.model_validate_json(meta_path.read_bytes()).model_dump()
    except ValidationError as e:
        if any(err["type"] == "json_invalid" for err in e.errors()):
            raise ScenarioFolderError(f"{meta_path}: not valid JSON ({e.errors()[0]['msg']})") from e
        raise _meta_error(meta_path, e) from e


def _scenario_image(meta_path: Path, name: str | None) -> Path | None:
    """The image ``scenario.json`` names: a bare file name in its folder, of
    a known type. The image route serves exactly this file."""
    if not name:
        return None
    folder = meta_path.parent
    image = folder / name
    if Path(name).name != name or not image.is_file():
        raise ScenarioFolderError(f"{meta_path}: image {name!r} is not a file in {folder}")
    if image.suffix.lower() not in IMAGE_TYPES:
        raise ScenarioFolderError(f"{meta_path}: image {name!r} must be one of {', '.join(sorted(IMAGE_TYPES))}")
    return image


def load_scenario_folder(folder: Path) -> dict[str, Any]:
    """One scenario folder as preset fields (all but `kind`, which the
    registry adds); see the module docstring."""
    from flatland.envs.persistence import RailEnvPersister

    meta_path = folder / "scenario.json"
    pkl_path = folder / "scenario.pkl"
    for path in (meta_path, pkl_path):
        if not path.is_file():
            raise ScenarioFolderError(f"{path}: missing")
    meta = _read_scenario_meta(meta_path)
    locked = meta["locked"]
    seconds_per_step = meta["seconds_per_step"]
    if meta["id"] != folder.name:
        raise ScenarioFolderError(f"{meta_path}: id {meta['id']!r} differs from the folder name {folder.name!r}")
    image = _scenario_image(meta_path, meta.get("image"))

    try:
        env, _ = RailEnvPersister.load_new(str(pkl_path))
    except Exception as e:  # noqa: BLE001 — any load failure is the folder's fault
        raise ScenarioFolderError(f"{pkl_path}: cannot be loaded ({e!r})") from e
    _check_scheduled_malfunctions(env, pkl_path)
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


if __name__ == "__main__":
    write_schema()
