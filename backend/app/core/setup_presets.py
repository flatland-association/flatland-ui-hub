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
- ``disruptions`` — a directory of files describing what goes wrong and when
  (``app.core.disruptions``). The user picks any subset of them at session
  start, so one scenario+plan can be run against several conditions.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.core.disruptions import list_disruptions

_FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"

ENV_PRESET = "env"
SCENE_PRESET = "scene"

# Keys that are implementation detail, not part of the UI payload.
_INTERNAL_FIELDS = {"path", "kind", "session", "plan", "disruptions", "tour_disruptions", "geography", "timetable_compression", "max_episode_steps"}


# id -> metadata. `path` points at the file; width/height/agents are the loaded
# env's dimensions (shown in the UI picker before loading).
_SETUPS: dict[str, dict[str, Any]] = {
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
        "tour_disruptions": _FIXTURES / "olten" / "disruptions_tour",
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
        "tour_disruptions": _FIXTURES / "olten" / "disruptions_tour",
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
        "description": "A deterministic conflict condition with an authored plan and selectable disruptions.",
        "available_modes": ["recommendation", "co-learning", "director"],
        "plan": _FIXTURES / "pf_ch" / "pf-ch-wn-wal-conflict.plan.json",
        "disruptions": _FIXTURES / "pf_ch" / "disruptions",
        # All three services are meant to be on the map from the first step;
        # Flatland's timetable generator would otherwise stagger them over the
        # first few steps and the conflict would not arise as intended.
        # malfunction_rate is pinned because this scenario ships a plan: with
        # random breakdowns left on, the same plan and the same disruptions
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
        "disruptions": _FIXTURES / "pf_ch" / "disruptions_long_approach",
        # Selectable by id (a tour pins it) but never listed in the picker, so a
        # demo disruption cannot be mistaken for a study condition.
        "tour_disruptions": _FIXTURES / "pf_ch" / "disruptions_tour_long_approach",
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
        # The single disruption takes exactly the headway train 0 holds over
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


def get_setup(setup_id: str) -> dict[str, Any]:
    """Return the preset metadata (incl. `path`), or raise KeyError/FileNotFoundError."""
    preset = _SETUPS.get(setup_id)
    if preset is None:
        raise KeyError(f"Unknown scenario preset: {setup_id!r}")
    path = preset["path"]
    if not Path(path).is_file():
        raise FileNotFoundError(f"Scenario preset file missing: {path}")
    return preset


def setup_kind(setup_id: str) -> str:
    """`ENV_PRESET` for a pickled env, `SCENE_PRESET` for a builder scene."""
    return str(get_setup(setup_id).get("kind", ENV_PRESET))


def load_setup_scene(setup_id: str) -> dict[str, Any] | None:
    """The Infrastructure-Builder scene behind a scene preset, else None."""
    preset = get_setup(setup_id)
    if preset.get("kind") != SCENE_PRESET:
        return None
    return json.loads(Path(preset["path"]).read_text(encoding="utf-8"))


def setup_session_settings(setup_id: str) -> dict[str, Any]:
    """Session settings the scenario pins, e.g. `latest_departure_max`."""
    return dict(get_setup(setup_id).get("session") or {})


def setup_plan_path(setup_id: str) -> Path | None:
    """The scenario's plan file, if it ships one and the file is there."""
    path = get_setup(setup_id).get("plan")
    if path is None or not Path(path).is_file():
        return None
    return Path(path)


def setup_disruptions(setup_id: str) -> list[dict[str, Any]]:
    """The scenario's disruption files, parsed. Empty when it ships none."""
    return list_disruptions(get_setup(setup_id).get("disruptions"))


def select_disruptions(setup_id: str, ids: list[str] | None) -> list[dict[str, Any]]:
    """The requested disruptions, in the scenario's own order.

    An unknown id is an error rather than a silent skip: a study run that
    quietly drops a condition would look like a valid run of that condition.
    """
    if not ids:
        return []
    wanted = set(ids)
    available = setup_disruptions(setup_id) + list_disruptions(
        get_setup(setup_id).get("tour_disruptions")
    )
    unknown = wanted - {d["id"] for d in available}
    if unknown:
        raise KeyError(
            f"Unknown disruption(s) for {setup_id!r}: {', '.join(sorted(unknown))}"
        )
    return [d for d in available if d["id"] in wanted]


def list_setups() -> list[dict[str, Any]]:
    """Public listing for the UI picker.

    Internal fields are replaced by what the picker actually needs: whether a
    plan exists, and the disruptions offered alongside it.
    """
    listing = []
    for preset in _SETUPS.values():
        entry = {k: v for k, v in preset.items() if k not in _INTERNAL_FIELDS}
        entry["has_plan"] = setup_plan_path(preset["id"]) is not None
        entry["disruptions"] = [
            {"id": d["id"], "name": d["name"], "description": d["description"]}
            for d in setup_disruptions(preset["id"])
        ]
        entry["available_modes"] = list(
            preset.get("available_modes")
            or ["recommendation", "co-learning", "director"]
        )
        listing.append(entry)
    return listing
