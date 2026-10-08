# Terminology of Record

This glossary is the vocabulary of record for Issue #63. It separates Flatland
integration terms, AI4REALNET Use Case 2 terms, local HMI concepts and visible
German labels.

## Canonical concepts

| English source term | German target term | Meaning and ownership |
|---|---|---|
| rail network | Bahnnetz | Physical railway topology. Local UI concept. |
| train run | Zuglauf | A train's planned and executed movement. Flatland agent handles remain unchanged. |
| timetable / service plan | Betriebsprogramm | Planned train services, relations, departures and stops. |
| technical fault | Technischer Fehler | Flatland `malfunction` at the integration boundary; never a generic operational scenario. |
| operational disruption | Betriebsstörung | A disruption affecting railway operations. Local presentation concept. |
| deviation | Abweichung | Difference between planned and observed state. |
| re-scheduling / replanning | Neuplanung | Response to a disruption or changed operating state. |
| operational scenario (D4.1) | Betriebsszenario (D4.1) | Consortium term for the D4.1 catalog. The suffix is mandatory. |
| experimental setup | Versuchskonfiguration | Concrete network, service plan, disruption data and start parameters selected for a run. |
| reference run | Referenzlauf | Baseline execution used for comparison. |
| simulation run | Simulationslauf | Actual executed sequence of simulation steps. |
| decision policy | Entscheidungsverfahren | User-facing description of a technical `Policy`. |
| strategy | Strategie | A comparable action or policy option shown to a dispatcher. |
| recommendation | Empfehlung | A ranked or framed AI suggestion; the human decision remains mode-dependent. |
| widget | Widget | Reusable HMI unit represented by `WidgetMeta` and `WIDGET_CATALOG`. |
| widget catalog | Widget-Katalog | Catalog of available HMI widgets. |
| experimental setup catalogue | Katalog der Versuchskonfigurationen | Catalog of reproducible experimental setups. |
| strategy catalog | Strategie-Katalog | Catalog of selectable decision strategies. |
| strategy comparison | Strategienvergleich | Panel for comparing and choosing action options. |
| network editor | Netz-Editor | Editor for the physical railway topology. |
| layout editor | Layout-Editor | Editor for widget placement and layout persistence. |
| session | Sitzung | Runtime state containing mode, experimental setup, layout and simulation state. |
| interaction mode | Interaktionsmodus | Existing `recommendation`, `co-learning` and `director` semantics. |
| tour | Tour | Guided learning flow. |
| experiment | Experiment | Higher-level study or comparison context. |

## Required code mappings

| Current local name | Target name | Scope |
|---|---|---|
| `scenario` panel type | `strategy-comparison` | Frontend layout and plugin registration |
| `ScenarioPanelComponent` | `StrategyComparisonPanelComponent` | Frontend component |
| `ScenarioGalleryComponent` | `SetupCatalogComponent` | Frontend feature |
| `WidgetsGalleryComponent` | `WidgetCatalogComponent` | Frontend feature |
| `AlgorithmsGalleryComponent` | `StrategyCatalogComponent` | Frontend feature |
| `features/infrastructure-builder/` | `features/network-editor/` | Frontend feature path |
| `InfrastructureScene` | `RailNetwork` | Local frontend model |
| `InfrastructureAgent` | `NetworkTrainRun` | Local frontend model |
| `ScenarioOption` | `ActionOption` | Local frontend model |
| `/scenarios` | `/setups` | Local frontend navigation |
| `/algorithms` | `/strategies` | Local frontend navigation |
| `scenario_presets.py` | `setup_presets.py` | Backend module |
| `ScenarioPreset` | `SetupPreset` | Backend model |
| `_PRESETS` | `_SETUPS` | Backend registry |
| `scenario_preset_id` | `setup_id` | Local API/session field |
| `/session/scenario-presets` | `/setups` | Local backend endpoint |
| `list_presets()` | `list_setups()` | Backend helper |
| `/scenario-policies` | `/strategies` | Local backend endpoint |
| `_invalidate_scenario_forecasts` | `_invalidate_strategy_forecasts` | Backend helper |
| `ScenarioDisturbance` | `DisruptionEvent` | Backend model |
| `disturbance_ids` | `disruption_ids` | Local API field |
| `disturbances.py` | `disruptions.py` | Backend module |
| `select_disturbances()` | `select_disruptions()` | Backend helper |
| `parse_disturbance()` | `parse_disruption()` | Backend helper |
| `infrastructure_scene_id` | `network_id` | Local API/session field |
| `disturbance.scenario` | `disruption.setup_id` | Local fixture/event ownership |

## Ownership boundaries

These Flatland terms are external integration vocabulary and remain unchanged:
`RailEnv`, `env.agents`, agent handles, `malfunction` and
`malfunction_rate`. They may occur in adapters, payloads, fixtures or comments
that explain the upstream contract, but they must not be copied into visible UI
labels.

These D4.1 terms are consortium vocabulary and remain unchanged:
`operational_scenario` and `UC1.R-*`. The visible German label is always
**Betriebsszenario (D4.1)**.

The following local concepts may be renamed in Issue #63: experimental setup,
strategy comparison, catalogs, network editor, local preset identifiers,
disruption presentation and local routes.

## Prohibited usage

- Do not use standalone `Scenario` or `Szenario` in local UI copy, new local identifiers or new active documentation.
- Do not use `Scenario` as the visible name of an experimental setup catalogue.
- Do not use Builder, Designer, Generator or Gallery as the visible name of a local catalog/editor. `Layout-Editor` remains the established exception for the layout feature.
- Do not use `Fehlfunktion` as the operational label for a disruption. Use `Technischer Fehler` for Flatland malfunction and `Betriebsstörung` for the operational event.
- Do not translate `operational_scenario` as a generic scenario. Use `Betriebsszenario (D4.1)`.
- Do not rename Flatland boundary fields, `AgentDTO`, `AgentStop` or `scene.agents` in this issue.

## Ambiguous words

`Policy` is a technical runtime term. `Strategie` is the user-facing option
shown in a comparison. `Algorithmus` is not used in the visible catalog.

`Technischer Fehler` describes a technical fault. `Betriebsstörung` describes
its operational impact or another operational event. `Abweichung` describes an
observed difference, and `Neuplanung` describes the response.

`Versuchskonfiguration` is the concrete selectable experimental setup. `Betriebsszenario (D4.1)` is
the consortium catalog concept. `Störungsszenario` may be used only when the
content specifically describes a disruption case; it is not a replacement for
the D4.1 term.
