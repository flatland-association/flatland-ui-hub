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


def _write_scenario(root, scenario_id="test-scenario", meta=None, image=True):
    """A small scenario folder as scenario_generator would write it."""
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
    RailEnvPersister.save(env, str(folder / "scenario.pkl"))
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
