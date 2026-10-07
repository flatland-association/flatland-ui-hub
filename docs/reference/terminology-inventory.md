# Issue #63 Terminology Inventory

This is the Phase-1 inventory and the PR-A handover list. It records local
rename owners separately from Flatland and D4.1 names that must remain stable.
Line numbers are intentionally omitted because the inventory is updated while
identifiers move; symbol and path names are the stable anchors.

## Local frontend rename anchors

| Category | Current occurrence | Target | Main owner / consumers | Treatment |
|---|---|---|---|---|
| Panel type | `scenario` | `strategy-comparison` | `core/layout`, `panel-plugin-host`, layout presets, palette, mode availability | PR B plus one-time Local-Storage migration |
| Component | `ScenarioPanelComponent` | `StrategyComparisonPanelComponent` | `features/scenario-panel/`, plugin host | PR B |
| Feature | `features/scenario-gallery/` | `features/setup-catalog/` | setup picker and route entry | PR B |
| Component | `ScenarioGalleryComponent` | `SetupCatalogComponent` | scenario gallery component and shell | PR B |
| Component | `WidgetsGalleryComponent` | `WidgetCatalogComponent` | widgets gallery component and navigation | PR B |
| Component | `AlgorithmsGalleryComponent` | `StrategyCatalogComponent` | algorithms gallery component and navigation | PR B |
| Feature | `features/infrastructure-builder/` | `features/network-editor/` | builder component, shell and lazy route | PR B |
| Model | `InfrastructureScene` | `RailNetwork` | infrastructure scene/model adapters | PR B |
| Model | `InfrastructureAgent` | `NetworkTrainRun` | network editor view model | PR B |
| Model | `ScenarioOption` | `ActionOption` | scenario panel and recommendation adapters | PR B |
| Navigation | `/scenarios` | `/setups` | shell navigation and browser location changes | PR B |
| Navigation | `/algorithms` | `/strategies` | shell navigation and browser location changes | PR B |
| Translation namespace | `scenarioGallery` | setup-catalog wording | `frontend/public/i18n/{en,de,fr}.json` | PR A visible values; key rename only with consumers in PR B |

## Local backend rename anchors

| Category | Current occurrence | Target | Main owner / consumers | Treatment |
|---|---|---|---|---|
| Module | `backend/app/core/scenario_presets.py` | `setup_presets.py` | env factory, sessions, tests | PR C with `git mv` |
| Registry | `ScenarioPreset`, `_PRESETS` | `SetupPreset`, `_SETUPS` | setup preset module and API models | PR C |
| Field | `scenario_preset_id` | `setup_id` | session model, env factory, API requests and tests | PR C |
| Endpoint | `/session/scenario-presets` | `/setups` | `backend/app/api/sessions.py` and frontend API client | PR C |
| Helper | `list_presets()` | `list_setups()` | setup catalog endpoint | PR C |
| Endpoint | `/{session_id}/scenario-policies` | `/{session_id}/strategies` | session strategy settings endpoint | PR C |
| Helper | `_invalidate_scenario_forecasts` | `_invalidate_strategy_forecasts` | session and contention APIs | PR C |
| Module | `backend/app/core/disturbances.py` | `disruptions.py` | preset loading and fixture parsing | PR C |
| Model | `ScenarioDisturbance` | `DisruptionEvent` | API/event parsing and tests | PR C |
| Field | `disturbance_ids` | `disruption_ids` | session request model and API | PR C |
| Helper | `select_disturbances()` | `select_disruptions()` | setup preset and sandbox APIs | PR C |
| Helper | `parse_disturbance()` | `parse_disruption()` | disruption parser | PR C |
| Field | `infrastructure_scene_id` | `network_id` | session request/model and frontend request | PR C |
| Event ownership | `disturbance.scenario` | `disruption.setup_id` | disruption fixtures and loader | PR C |

## Visible UI-copy inventory

The following translation areas contain user-facing terms and must be reviewed
in all three language files. Technical keys may remain stable until their
consumers are renamed.

| Translation area | Current wording to review | Target direction |
|---|---|---|
| `scenarioGallery` | Scenario & Infrastructure Gallery, scenario catalog, scenarios | Aufbau-Katalog, setups, Aufbau |
| `welcome.door.build` | Choose the network, scenario and layout | Choose the network, setup and layout |
| `welcome.field` | scenario | setup / Aufbau |
| `welcome.planNote` | this scenario ships a premade plan | this setup ships a premade plan |
| `welcome.experimentFixed` | scenario | setup / Aufbau |
| `scenarios` | Scenarios, Recommended, Avoid, policy switching | Strategies / Strategie, while preserving recommendation semantics |
| `disturbances` | Disturbances and event copy | Betriebsstörungen, preserving event IDs |
| `malfunction` | Malfunction, Train breakdown | Technischer Fehler / Train technical fault where visible |
| `situation` and `roster` | malfunction(s), Malfunction title | Technischer Fehler / technical fault |
| `views`, `panels`, `layout` | gallery, builder, panel names | catalog, editor, comparison names |
| help and onboarding text | scenario as a generic noun | qualified setup, disruption scenario or D4.1 term |

## Backend and fixture inventory

The initial search found local occurrences in the following active owners:

- `backend/app/api/sessions.py`: preset endpoint, setup request field,
  strategy endpoint, forecast invalidation and session comments.
- `backend/app/api/sandbox.py`: disturbance selection and cloned session setup.
- `backend/app/api/hmi.py` and `backend/app/api/overrides.py`: scenario
  forecast/cache terminology and scenario option adapters.
- `backend/app/core/scenario_presets.py`: registry, preset loaders, plan and
  disturbance helpers.
- `backend/app/core/disturbances.py`: event parser and fixture directory
  discovery.
- `backend/app/core/env_factory.py`: preset loading and `malfunction_rate`
  integration.
- `backend/app/core/session_manager.py` and `backend/app/models/session.py`:
  persisted session field and session construction.
- `backend/app/policies/registry.py` and contention/goal-based modules:
  scenario-policy factories and policy cache consumers.
- `backend/app/fixtures/**`: JSON `scenario` ownership fields and disturbance
  event data.
- `backend/tests/**`: API, preset, disturbance, cache and strategy tests.

Fixture JSON keys and Flatland payload fields are not renamed until PR C. The
same PR must update every fixture and add a load test for each changed fixture
family.

## Protected external vocabulary

The following matches are inventory entries, not rename tasks:

- `RailEnv`, `env.agents`, agent handles, `malfunction` and
  `malfunction_rate` in Flatland adapters and payloads.
- `operational_scenario` and `UC1.R-*` in D4.1 references.
- `AgentDTO`, `AgentStop` and `scene.agents`.
- Historical material under `docs/archive/`, unless a current active document
  links to it or the terminology guard explicitly scopes it in.

## Phase-1 decision record

The current local API has no confirmed external consumers in this repository.
The API cutover is therefore planned as a hard rename, not an alias migration.
The inventory remains open until the repository-owner check for external
consumers is recorded in the Issue #63 closing comment.
