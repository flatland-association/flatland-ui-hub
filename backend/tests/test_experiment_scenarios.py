"""Experiment scenarios: folders of `.pkl` + `scenario.json` (+ image) under
fixtures/scenarios/ (docs/plans/experiment-scenario-import.md)."""
import json
import warnings

import pytest
from fastapi.testclient import TestClient

warnings.filterwarnings("ignore")

from flatland.envs import malfunction_effects_generators as mfg  # noqa: E402
from flatland.envs.line_generators import sparse_line_generator  # noqa: E402
from flatland.envs.persistence import RailEnvPersister  # noqa: E402
from flatland.envs.rail_env import RailEnv  # noqa: E402
from flatland.envs.rail_generators import sparse_rail_generator  # noqa: E402
from flatland.envs.step_utils.states import TrainState  # noqa: E402

from app.core import scenario_presets  # noqa: E402
from app.core.env_factory import load_preset_env  # noqa: E402
from app.core.scenario_presets import ScenarioFolderError, discover_scenarios  # noqa: E402
from app.main import app  # noqa: E402

# Train 0 breaks down at step 3 for 4 steps: in malfunction during steps 3..6.
SCHEDULE = [[0, 3, 4]]


def _write_scenario(root, scenario_id="test-scenario", meta=None, image=True, generator=None, stations_links=True):
    """A small scenario folder as scenario_generator would write it.
    `generator`: the generator output's content, written as generator.json."""
    folder = root / scenario_id
    folder.mkdir(parents=True)
    env = RailEnv(
        30, 30,
        rail_generator=sparse_rail_generator(max_num_cities=2, seed=1),
        line_generator=sparse_line_generator(),
        number_of_agents=2,
        effects_generator=mfg.ScheduledMalfunctionEffectsGenerator(SCHEDULE),
    )
    env.reset(random_seed=1)
    if not stations_links:
        env.stations_links = None  # a .pkl from before the generator wrote them
    RailEnvPersister.save(env, str(folder / "scenario.pkl"))
    if generator is not None:
        (folder / "generator.json").write_text(json.dumps(generator), encoding="utf-8")
    if image:
        (folder / "scenario.png").write_bytes(b"\x89PNG\r\n\x1a\nnot really")
    meta = meta if meta is not None else {
        "id": scenario_id,
        "title": "Störung am Einspurabschnitt",
        "description": "Ein Zug bleibt stehen.\n\nDu entscheidest.",
        **({"image": "scenario.png"} if image else {}),
    }
    (folder / "scenario.json").write_text(json.dumps(meta), encoding="utf-8")
    return folder


@pytest.fixture
def scenario(tmp_path, monkeypatch):
    """One scenario folder, registered as a preset for the duration of the test."""
    _write_scenario(tmp_path)
    found = discover_scenarios(tmp_path)
    for preset_id, preset in found.items():
        monkeypatch.setitem(scenario_presets._PRESETS, preset_id, preset)
    return found["test-scenario"]


# ── Discovery ──────────────────────────────────────────────────────────────

def test_a_folder_becomes_an_experiment_only_env_preset(scenario):
    assert scenario["kind"] == scenario_presets.ENV_PRESET
    assert scenario["experiment_only"] is True
    assert scenario["name"] == scenario["title"] == "Störung am Einspurabschnitt"
    assert scenario["image_url"] == "/session/scenario-presets/test-scenario/image"
    # Read from the env, not written by hand.
    assert (scenario["width"], scenario["height"], scenario["agents"]) == (30, 30, 2)


def test_the_listing_carries_the_card_fields_but_not_the_file_paths(scenario):
    entry = next(p for p in scenario_presets.list_presets() if p["id"] == "test-scenario")
    assert entry["experiment_only"] is True
    assert entry["description"].startswith("Ein Zug")
    assert entry["image_url"].endswith("/image")
    assert "path" not in entry and "image" not in entry


def test_the_scheduled_malfunction_survives_the_pkl_and_breaks_the_train_for_exactly_its_window(scenario):
    env = load_preset_env("test-scenario")
    malfunctioning = []
    for _ in range(10):
        env.step({h: 2 for h in range(len(env.agents))})
        if env.agents[0].state in (TrainState.MALFUNCTION, TrainState.MALFUNCTION_OFF_MAP):
            malfunctioning.append(env._elapsed_steps)
    assert malfunctioning == [3, 4, 5, 6]


@pytest.mark.parametrize("meta, message", [
    ({"title": "t", "description": "d"}, "'id'"),
    ({"id": "test-scenario", "description": "d"}, "'title'"),
    ({"id": "test-scenario", "title": "t", "description": ""}, "'description'"),
    ({"id": "other", "title": "t", "description": "d"}, "folder name"),
    ({"id": "test-scenario", "title": "t", "description": "d", "image": "missing.png"}, "missing.png"),
    ({"id": "test-scenario", "title": "t", "description": "d", "image": "../scenario.png"}, "../scenario.png"),
    ({"id": "test-scenario", "title": "t", "description": "d", "colour": "red"}, "unknown field"),
])
def test_a_malformed_folder_fails_with_the_file_and_field_named(tmp_path, meta, message):
    _write_scenario(tmp_path, meta=meta)
    with pytest.raises(ScenarioFolderError) as e:
        discover_scenarios(tmp_path)
    assert "scenario.json" in str(e.value) and message in str(e.value)


def test_a_folder_without_pkl_fails(tmp_path):
    folder = _write_scenario(tmp_path)
    (folder / "scenario.pkl").unlink()
    with pytest.raises(ScenarioFolderError, match="scenario.pkl: missing"):
        discover_scenarios(tmp_path)


def test_an_id_clashing_with_a_built_in_preset_fails(tmp_path):
    _write_scenario(tmp_path, scenario_id="olten")
    with pytest.raises(ScenarioFolderError, match="built-in"):
        discover_scenarios(tmp_path)


SHIPPED = sorted(discover_scenarios())


@pytest.mark.skipif(not SHIPPED, reason="no experiment scenarios shipped yet")
@pytest.mark.parametrize("preset_id", SHIPPED)
def test_every_shipped_scenario_loads_steps_and_has_no_random_malfunctions(preset_id):
    env = load_preset_env(preset_id)
    assert scenario_presets._random_malfunction_rate(env) == 0
    for _ in range(10):
        env.step({})


# ── Seconds per step (§3.8) ────────────────────────────────────────────────

_META = {"id": "test-scenario", "title": "t", "description": "d"}


@pytest.mark.parametrize("value", [0.1, 2.5, 3, 60])
def test_seconds_per_step_is_listed_on_the_preset(tmp_path, monkeypatch, value):
    _write_scenario(tmp_path, meta={**_META, "seconds_per_step": value}, image=False)
    for preset_id, preset in discover_scenarios(tmp_path).items():
        monkeypatch.setitem(scenario_presets._PRESETS, preset_id, preset)
    entry = next(p for p in scenario_presets.list_presets() if p["id"] == "test-scenario")
    assert entry["seconds_per_step"] == value


def test_without_seconds_per_step_the_preset_has_none(scenario):
    assert scenario["seconds_per_step"] is None


@pytest.mark.parametrize("value", [0, 0.05, -1, True, "2", [2]])
def test_a_bad_seconds_per_step_fails_with_the_file_and_field_named(tmp_path, value):
    _write_scenario(tmp_path, meta={**_META, "seconds_per_step": value}, image=False)
    with pytest.raises(ScenarioFolderError) as e:
        discover_scenarios(tmp_path)
    assert "scenario.json" in str(e.value) and "seconds_per_step" in str(e.value)


# ── Names (§3.7) ───────────────────────────────────────────────────────────

def _generator(names, rows=30, cols=30):
    return {"gridDimensions": {"rows": rows, "cols": cols, "cellSize": 20}, "timetables": [{"name": n} for n in names]}


def test_station_names_come_from_the_pkls_stations_links(scenario):
    # Read as discovery reads it: a session's env is reset, which drops stations_links.
    env, _ = RailEnvPersister.load_new(str(scenario["path"]))
    expected = [
        (name, i + 1, list(sp.node))
        for name, station in env.stations_links.stations.items()
        for i, sp in enumerate(station.stopping_points)
    ]
    geo = scenario["geography"]
    assert geo["layout"] == "corridor"
    assert [(st["name"], st["track"], st["cell"]) for st in geo["stations"]] == expected
    assert all(st["code"] == st["name"] and st["kind"] == "platform" for st in geo["stations"])
    assert scenario["train_names"] is None


def test_a_pkl_without_stations_links_has_no_station_names(tmp_path):
    _write_scenario(tmp_path, stations_links=False)
    assert discover_scenarios(tmp_path)["test-scenario"]["geography"] is None


def test_train_names_come_from_generator_json_in_handle_order(tmp_path):
    _write_scenario(tmp_path, generator=_generator(["Z-W-1-S", "F-W-S"]))
    assert discover_scenarios(tmp_path)["test-scenario"]["train_names"] == ["Z-W-1-S", "F-W-S"]


@pytest.mark.parametrize("generator, message", [
    (_generator(["a", "b"], rows=31), "gridDimensions"),
    (_generator(["a"]), "1 timetables for 2 trains"),
    (_generator(["a", "a"]), "a used more than once"),
    (_generator(["a", " "]), "timetable 1 has no name"),
    ({"timetables": []}, "gridDimensions"),
])
def test_a_generator_json_that_does_not_fit_the_pkl_fails_with_the_file_named(tmp_path, generator, message):
    _write_scenario(tmp_path, generator=generator)
    with pytest.raises(ScenarioFolderError) as e:
        discover_scenarios(tmp_path)
    assert "generator.json" in str(e.value) and message in str(e.value)


def test_the_listing_keeps_names_internal(tmp_path, monkeypatch):
    _write_scenario(tmp_path, generator=_generator(["a", "b"]))
    for preset_id, preset in discover_scenarios(tmp_path).items():
        monkeypatch.setitem(scenario_presets._PRESETS, preset_id, preset)
    entry = next(p for p in scenario_presets.list_presets() if p["id"] == "test-scenario")
    assert "train_names" not in entry and "geography" not in entry


def test_the_geography_of_a_session_names_stations_and_trains(tmp_path, monkeypatch):
    _write_scenario(tmp_path, generator=_generator(["Z-W-1-S", "F-W-S"]))
    for preset_id, preset in discover_scenarios(tmp_path).items():
        monkeypatch.setitem(scenario_presets._PRESETS, preset_id, preset)
    client = TestClient(app)
    sid = client.post("/session", json={"scenario_preset_id": "test-scenario", "seed": 1}).json()["id"]
    geo = client.get(f"/session/{sid}/hmi/geography").json()
    assert geo["trains"] == [{"handle": 0, "name": "Z-W-1-S"}, {"handle": 1, "name": "F-W-S"}]
    # A corridor, so the ZWL draws it without a picked section.
    assert geo["layout"] == "corridor" and geo["stations"]


def test_other_sessions_name_no_trains(scenario):
    client = TestClient(app)
    for body in ({"scenario_preset_id": "test-scenario", "seed": 1}, {"width": 30, "height": 30, "agents": 2, "seed": 1}):
        sid = client.post("/session", json=body).json()["id"]
        assert client.get(f"/session/{sid}/hmi/geography").json()["trains"] == []


# ── API ────────────────────────────────────────────────────────────────────

def test_a_session_starts_on_the_scenario_as_it_is(scenario):
    r = TestClient(app).post("/session", json={"scenario_preset_id": "test-scenario", "seed": 1})
    assert r.status_code == 200, r.text
    assert r.json()["num_agents"] == 2


@pytest.mark.parametrize("extra", [
    {"disturbance_ids": ["anything"]},
    {"malfunction_rate": 0.01},
])
def test_a_session_on_the_scenario_rejects_anything_on_top(scenario, extra):
    r = TestClient(app).post("/session", json={"scenario_preset_id": "test-scenario", "seed": 1, **extra})
    assert r.status_code == 400
    assert "experiment scenario" in r.json()["detail"]


def test_the_image_route_serves_the_named_file(scenario):
    r = TestClient(app).get("/session/scenario-presets/test-scenario/image")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content.startswith(b"\x89PNG")


def test_the_image_route_serves_nothing_else(tmp_path, monkeypatch):
    _write_scenario(tmp_path, image=False)
    for preset_id, preset in discover_scenarios(tmp_path).items():
        monkeypatch.setitem(scenario_presets._PRESETS, preset_id, preset)
    client = TestClient(app)
    assert client.get("/session/scenario-presets/test-scenario/image").status_code == 404
    assert client.get("/session/scenario-presets/olten/image").status_code == 404
    assert client.get("/session/scenario-presets/no-such/image").status_code == 404
    # The id is only ever a key into the presets, never a path. (The client
    # normalises the `..` away, so this reaches the SPA fallback if anything.)
    r = client.get("/session/scenario-presets/..%2F..%2Fmain.py/image")
    assert not r.headers.get("content-type", "").startswith("image/")
