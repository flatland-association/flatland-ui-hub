"""Prebuilt scenarios that ship with the repo.

A preset is an environment committed to the repo and offered in the UI's
Infrastructure picker, so a fresh clone can select it without importing
anything. Two kinds, differing only in what the file holds:

- ``env`` — a pickled Flatland env (``RailEnvPersister.save`` format). Loading
  one reproduces a challenge instance exactly: network, traffic, train goals,
  intermediate stops, timetable and malfunctions. This is the ECML 2026 case
  from ``docs/plans/ecml2026-flatland-env.md``.
- ``scene`` — an Infrastructure-Builder scene (the same JSON the builder
  exports). It goes through the normal scene path in ``env_factory``, so the
  scene dict stays with the session and named stations survive; a pickled env
  would lose them, because ``RailEnvPersister`` does not persist ``stations``.

Presets are **non-editable by design**: selecting one must give every user the
same environment, so nothing here is copied into the builder's local storage.

A preset may pin the session settings that belong to the scenario rather than
to the user's Settings fields (``session`` below) — otherwise a scenario would
silently depend on those fields happening to be right.

A preset may also ship two further layers, both optional:

- ``plan`` — a ``*.plan.json`` giving every train's exact route and timing
  (``app.core.plans``). Selecting the scenario makes the ``plan`` policy
  available, which drives the trains along it.
- ``disturbances`` — a directory of files describing what goes wrong and when
  (``app.core.disturbances``). The user picks any subset of them at session
  start, so one scenario+plan can be run against several conditions.

**Experiment scenarios** are not listed here but found on disk: one folder per
scenario under ``fixtures/plan-b/`` with ``scenario.pkl``, ``scenario.json``
(title, description, image) and an optional image
(docs/reference/experiment-scenarios.md). They are ``env`` presets marked
``experiment_only``: the ``.pkl`` is the whole simulation, so a session on one
takes no disturbances or live malfunctions, and the free Infrastructure picker
leaves them out. Their station names come from the ``.pkl``'s
``stations_links``, their train names from an optional ``generator.json`` (the
scenario generator's output, whose ``timetables[i].name`` names handle *i*).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

# Registers the compat effects generators the experiment .pkls name (TODO in there).
import app.utils.flatland_compat  # noqa: F401
from app.core.disturbances import list_disturbances

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

ENV_PRESET = "env"
SCENE_PRESET = "scene"

# Keys that are implementation detail, not part of the UI payload.
_INTERNAL_FIELDS = {"path", "kind", "session", "plan", "disturbances", "tour_disturbances", "geography", "timetable_compression", "max_episode_steps", "image", "train_names"}

_log = logging.getLogger(__name__)


# id -> metadata. `path` points at the file; width/height/agents are the loaded
# env's dimensions (shown in the UI picker before loading).
_PRESETS: dict[str, dict[str, Any]] = {
    "ecml2026-scene1-level0": {
        "id": "ecml2026-scene1-level0",
        "name": "ECML 2026 — Scene 1 (Level 0)",
        "kind": ENV_PRESET,
        "path": _FIXTURES / "ecml2026" / "ecml2026_scene1_level0.pkl",
        "width": 150,
        "height": 120,
        "agents": 6,
        "source": "flatland-association/ecml2026-starterkit",
        "network": "ECML 2026 starter network",
        "traffic": "6 scheduled trains",
        "disruption": "Undisrupted baseline",
        "description": "A reproducible ECML 2026 starter environment for infrastructure and timetable experiments.",
        "available_modes": ["recommendation", "co-learning", "director"],
    },
    # Olten — a real Swiss network, taken verbatim from the MIT-licensed
    # `flatland-association/flatland-scenarios` (see fixtures/olten/SOURCE.md).
    # The first scenarios here that nobody on this project authored, which is
    # the point: the PF-CH scenes are built from a Gleisschema by hand, and a
    # study wants at least one environment it did not design its own answer for.
    # They also carry a timetable dense enough for transfers to exist — 171
    # planned connections against the hand-built corridor's 66 — so the
    # Combined Actions transfers axis has real data rather than authored data.
    "olten": {
        "id": "olten",
        "name": "Olten — undisrupted",
        "kind": ENV_PRESET,
        "path": _FIXTURES / "olten" / "olten.pkl",
        # Names for platforms, stops and line portals (the .pkl carries none).
        "geography": _FIXTURES / "olten" / "olten.geography.json",
        # The tour's scripted breakdown; selectable by id, never in the picker.
        "tour_disturbances": _FIXTURES / "olten" / "disturbances_tour",
        "width": 35,
        "height": 60,
        "agents": 52,
        "source": "flatland-association/flatland-scenarios (MIT)",
        "network": "Olten station and approach network",
        "traffic": "52 scheduled trains with transfer connections",
        "disruption": "Undisrupted baseline",
        "description": "A real Swiss network with named platforms and a dense timetable for connection-aware studies.",
        "available_modes": ["recommendation", "co-learning", "director"],
    },
    # Olten with the departures compressed threefold (env_factory.compress_timetable):
    # the same 52 trains and runs, ~9 on the map at once instead of ~3, so the
    # node has contentions for Combined Actions' strategies to answer. Measured
    # 2026-09-25: factor 3 is the densest where every train still arrives
    # (2 and 4 leave trains stuck within the horizon).
    "olten-dense": {
        "id": "olten-dense",
        "name": "Olten — dense (departures ×1/3)",
        "kind": ENV_PRESET,
        "path": _FIXTURES / "olten" / "olten.pkl",
        "timetable_compression": 3,
        "max_episode_steps": 700,
        "width": 35,
        "height": 60,
        "agents": 52,
        "source": "flatland-association/flatland-scenarios (MIT), timetable compressed",
        "network": "Olten station and approach network",
        "traffic": "52 scheduled trains, departures compressed 3×",
        "disruption": "Undisrupted baseline",
        "description": "The Olten network with a denser operating programme to expose more simultaneous contentions.",
        "available_modes": ["recommendation", "co-learning", "director"],
        "geography": _FIXTURES / "olten" / "olten.geography.json",
        "tour_disturbances": _FIXTURES / "olten" / "disturbances_tour",
    },
    "olten-disrupted": {
        "id": "olten-disrupted",
        "name": "Olten — disrupted",
        "kind": ENV_PRESET,
        "path": _FIXTURES / "olten" / "olten_disrupted.pkl",
        "geography": _FIXTURES / "olten" / "olten.geography.json",
        "width": 35,
        "height": 60,
        "agents": 52,
        "source": "flatland-association/flatland-scenarios (MIT)",
        "network": "Olten station and approach network",
        "traffic": "52 scheduled trains with transfer connections",
        "disruption": "Disrupted environment baseline",
        "description": "The Olten network with its committed disrupted environment, suitable for recovery studies.",
        "available_modes": ["recommendation", "co-learning", "director"],
    },
    "olten-partially-closed": {
        "id": "olten-partially-closed",
        "name": "Olten — partially closed",
        "kind": ENV_PRESET,
        "path": _FIXTURES / "olten" / "olten_partially_closed.pkl",
        "geography": _FIXTURES / "olten" / "olten.geography.json",
        "width": 35,
        "height": 60,
        "agents": 52,
        # The variant the WP4 orchestrator playground runner loads, so results
        # here are the ones comparable to the validation campaign's.
        "source": "flatland-association/flatland-scenarios (MIT)",
        "network": "Olten station and approach network",
        "traffic": "52 scheduled trains with transfer connections",
        "disruption": "Partial infrastructure closure",
        "description": "The validation variant used by the WP4 orchestrator playground runner.",
        "available_modes": ["recommendation", "co-learning", "director"],
    },
    "pf-ch-corridor": {
        "id": "pf-ch-corridor",
        "name": "PF–CH corridor (double track)",
        "kind": SCENE_PRESET,
        "path": _FIXTURES / "pf_ch" / "pf-ch-corridor.scene.json",
        "width": 191,
        "height": 9,
        "agents": 16,
        "source": "Gleisschema of the Pfäffikon SZ–Chur line",
        "network": "Pfäffikon SZ–Chur double-track corridor",
        "traffic": "16 corridor services, origin and destination calls",
        "disruption": "Undisrupted baseline",
        "description": "A hand-built Swiss corridor derived from a track diagram.",
        "available_modes": ["recommendation", "co-learning", "director"],
    },
    "pf-ch-corridor-stops": {
        "id": "pf-ch-corridor-stops",
        "name": "PF–CH corridor (with intermediate stops)",
        "kind": SCENE_PRESET,
        "path": _FIXTURES / "pf_ch" / "pf-ch-corridor-stops.scene.json",
        "width": 191,
        "height": 9,
        "agents": 16,
        "source": "Gleisschema of the Pfäffikon SZ–Chur line",
        "network": "Pfäffikon SZ–Chur double-track corridor",
        "traffic": "16 corridor services with intermediate station calls",
        "disruption": "Undisrupted baseline",
        "description": "The corridor variant that makes station-to-station connection effects observable.",
        "available_modes": ["recommendation", "co-learning", "director"],
        # The corridor variant whose trains call at stations on the way instead
        # of only at origin and destination. Without intermediate calls a
        # scenario has no train pairs meeting at a station, so
        # `planned_connections` finds nothing and any connection-based measure
        # is flat — see the E1 spec's §8 note on the trade-off axes.
    },
    "pf-ch-wn-wal-conflict": {
        "id": "pf-ch-wn-wal-conflict",
        "name": "PF–CH · WN↔WAL single-track conflict",
        "kind": SCENE_PRESET,
        "path": _FIXTURES / "pf_ch" / "pf-ch-wn-wal-conflict.scene.json",
        "width": 191,
        "height": 9,
        "agents": 3,
        "source": "Gleisschema of the Pfäffikon SZ–Chur line",
        "network": "Pfäffikon SZ–Chur corridor with WN–WAL single track",
        "traffic": "3 plan-driven corridor services",
        "disruption": "Scripted WN↔WAL single-track conflict",
        "description": "A deterministic conflict condition with an authored plan and selectable disturbances.",
        "available_modes": ["recommendation", "co-learning", "director"],
        "plan": _FIXTURES / "pf_ch" / "pf-ch-wn-wal-conflict.plan.json",
        "disturbances": _FIXTURES / "pf_ch" / "disturbances",
        # All three services are meant to be on the map from the first step;
        # Flatland's timetable generator would otherwise stagger them over the
        # first few steps and the conflict would not arise as intended.
        # malfunction_rate is pinned because this scenario ships a plan: with
        # random breakdowns left on, the same plan and the same disturbances
        # would still give a different episode every run.
        "session": {
            "latest_departure_max": 0,
            "malfunction_rate": 0.0,
            "max_episode_steps": 140,
        },
    },
    "pf-ch-wn-wal-long-approach": {
        "id": "pf-ch-wn-wal-long-approach",
        "name": "PF–CH · WN↔WAL conflict (long approach)",
        "kind": SCENE_PRESET,
        "path": _FIXTURES / "pf_ch" / "pf-ch-wn-wal-long-approach.scene.json",
        "width": 191,
        "height": 9,
        "agents": 3,
        "source": "Gleisschema of the Pfäffikon SZ–Chur line",
        "network": "Pfäffikon SZ–Chur corridor with WN–WAL single track",
        "traffic": "3 plan-driven corridor services with a longer approach",
        "disruption": "Scripted WN↔WAL conflict after a long approach",
        "description": "A longer-horizon version of the WN↔WAL conflict for observing earlier choices.",
        "available_modes": ["recommendation", "co-learning", "director"],
        "plan": _FIXTURES / "pf_ch" / "pf-ch-wn-wal-long-approach.plan.json",
        "disturbances": _FIXTURES / "pf_ch" / "disturbances_long_approach",
        # Selectable by id (a tour pins it) but never listed in the picker, so a
        # demo disturbance cannot be mistaken for a study condition.
        "tour_disturbances": _FIXTURES / "pf_ch" / "disturbances_tour_long_approach",
        # Same network, trains and targets as the short version; both spawns
        # move one station further out (WN->ZB eastbound, WAL->FMS westbound)
        # so the conflict is visible for longer before it has to be resolved.
        #
        # Its plan is authored, not recorded. Each train is routed
        # individually, because Flatland's shortest path puts all of them on
        # row 0 even where a parallel track exists — which makes the eastbound
        # and westbound runs look like they contend for 26 columns when the
        # single-track section is really only six (cols 96-101). Routed
        # properly and with the departures spaced, all three converge on those
        # six cells within about a dozen steps and pass through in the order
        # 0, 1, 2 without any of them ever stopping.
        #
        # The single disturbance takes exactly the headway train 0 holds over
        # train 1 away again, so the two meet at the section — the one thing a
        # conflict-free plan cannot absorb, and therefore the decision the
        # operator is there to make. Only then does anything wait, and it waits
        # on the approach or at the mouth, never at a platform.
        "session": {
            "latest_departure_max": 0,
            "malfunction_rate": 0.0,
            "max_episode_steps": 180,
        },
    },
}


# Named after the only study it serves for now; a neutral name comes with a
# second study (docs/plans/experiment-scenario-import.md, §6).
_SCENARIOS_DIR = _FIXTURES / "plan-b"
# Before the scenario folders join them: discovering twice must not clash with itself.
_BUILT_IN_IDS = frozenset(_PRESETS)
_SCENARIO_FIELDS = {"id": True, "title": True, "description": True, "image": False, "source": False}
# Not text: real seconds per simulation step at the scenario's default pace.
_SECONDS_PER_STEP_MIN = 0.1
_IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml"}


class ScenarioFolderError(ValueError):
    """A malformed experiment scenario folder. Raised at import, so a study
    never runs with a scenario silently dropped."""


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


def _load_scenario_folder(folder: Path) -> dict[str, Any]:
    """One experiment scenario folder as an `env` preset; see the module docstring."""
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
    unknown = set(meta) - set(_SCENARIO_FIELDS) - {"seconds_per_step"}
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
    if meta["id"] != folder.name:
        raise ScenarioFolderError(f"{meta_path}: id {meta['id']!r} differs from the folder name {folder.name!r}")

    image = None
    if meta.get("image"):
        # A bare file name in the folder: the image route serves exactly this file.
        image = folder / meta["image"]
        if Path(meta["image"]).name != meta["image"] or not image.is_file():
            raise ScenarioFolderError(f"{meta_path}: image {meta['image']!r} is not a file in {folder}")
        if image.suffix.lower() not in _IMAGE_TYPES:
            raise ScenarioFolderError(
                f"{meta_path}: image {meta['image']!r} must be one of {', '.join(sorted(_IMAGE_TYPES))}"
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
        "kind": ENV_PRESET,
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
        "geography": _stations_links_geography(env),
        "train_names": train_names,
    }


def discover_scenarios(root: Path = _SCENARIOS_DIR) -> dict[str, dict[str, Any]]:
    """Every scenario folder under `root`, by id."""
    if not root.is_dir():
        return {}
    found: dict[str, dict[str, Any]] = {}
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))):
        preset = _load_scenario_folder(folder)
        if preset["id"] in _BUILT_IN_IDS:
            raise ScenarioFolderError(f"{folder}: id {preset['id']!r} is already a built-in preset")
        found[preset["id"]] = preset
    return found


_PRESETS.update(discover_scenarios())


def get_preset(preset_id: str) -> dict[str, Any]:
    """Return the preset metadata (incl. `path`), or raise KeyError/FileNotFoundError."""
    preset = _PRESETS.get(preset_id)
    if preset is None:
        raise KeyError(f"Unknown scenario preset: {preset_id!r}")
    path = preset["path"]
    if not Path(path).is_file():
        raise FileNotFoundError(f"Scenario preset file missing: {path}")
    return preset


def preset_kind(preset_id: str) -> str:
    """`ENV_PRESET` for a pickled env, `SCENE_PRESET` for a builder scene."""
    return str(get_preset(preset_id).get("kind", ENV_PRESET))


def load_preset_scene(preset_id: str) -> dict[str, Any] | None:
    """The Infrastructure-Builder scene behind a scene preset, else None."""
    preset = get_preset(preset_id)
    if preset.get("kind") != SCENE_PRESET:
        return None
    return json.loads(Path(preset["path"]).read_text(encoding="utf-8"))


def is_experiment_only(preset_id: str) -> bool:
    """An experiment scenario: the `.pkl` is the whole simulation."""
    return bool(get_preset(preset_id).get("experiment_only"))


def preset_image(preset_id: str) -> tuple[Path, str] | None:
    """The scenario's image file and media type, if it has one."""
    image = get_preset(preset_id).get("image")
    if image is None:
        return None
    return Path(image), _IMAGE_TYPES[Path(image).suffix.lower()]


def preset_session_settings(preset_id: str) -> dict[str, Any]:
    """Session settings the scenario pins, e.g. `latest_departure_max`."""
    return dict(get_preset(preset_id).get("session") or {})


def preset_plan_path(preset_id: str) -> Path | None:
    """The scenario's plan file, if it ships one and the file is there."""
    path = get_preset(preset_id).get("plan")
    if path is None or not Path(path).is_file():
        return None
    return Path(path)


def preset_disturbances(preset_id: str) -> list[dict[str, Any]]:
    """The scenario's disturbance files, parsed. Empty when it ships none."""
    return list_disturbances(get_preset(preset_id).get("disturbances"))


def select_disturbances(preset_id: str, ids: list[str] | None) -> list[dict[str, Any]]:
    """The requested disturbances, in the scenario's own order.

    An unknown id is an error rather than a silent skip: a study run that
    quietly drops a condition would look like a valid run of that condition.
    """
    if not ids:
        return []
    wanted = set(ids)
    available = preset_disturbances(preset_id) + list_disturbances(
        get_preset(preset_id).get("tour_disturbances")
    )
    unknown = wanted - {d["id"] for d in available}
    if unknown:
        raise KeyError(
            f"Unknown disturbance(s) for {preset_id!r}: {', '.join(sorted(unknown))}"
        )
    return [d for d in available if d["id"] in wanted]


def list_presets() -> list[dict[str, Any]]:
    """Public listing for the UI picker.

    Internal fields are replaced by what the picker actually needs: whether a
    plan exists, and the disturbances offered alongside it.
    """
    listing = []
    for preset in _PRESETS.values():
        entry = {k: v for k, v in preset.items() if k not in _INTERNAL_FIELDS}
        entry["has_plan"] = preset_plan_path(preset["id"]) is not None
        entry["disturbances"] = [
            {"id": d["id"], "name": d["name"], "description": d["description"]}
            for d in preset_disturbances(preset["id"])
        ]
        entry["available_modes"] = list(
            preset.get("available_modes")
            or ["recommendation", "co-learning", "director"]
        )
        listing.append(entry)
    return listing
