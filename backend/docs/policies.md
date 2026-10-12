# Policy Extension Guide

This project now uses a central registry to make policy integration simple and consistent.

## 1) Where to add a new policy

1. Create your policy class under `app/policies/` (or copy from `app/policies/templates/template_policy.py`).
2. Implement:
   - `act_for_handle(...)`
   - `build_observation_builder(...)`
   - optional lifecycle hooks (`reset`, `start_step`, `end_step`, ...)
3. Register it in `app/policies/registry.py` (`_REGISTRY`).

## 2) Registry is the single source of truth

`app/policies/registry.py` drives:
- `/policies` UI list (label + description)
- runtime policy creation for step/play
- scenario candidate policies for what-if evaluation

So, adding one entry in `_REGISTRY` is enough to wire backend usage.

Additionally, the frontend policy selectors are dynamic:
- Welcome page policy checklist (session creation)
- Toolbar policy dropdown (active runtime policy)
- Scenario recommendation "Switch to this policy"

All three read from backend registry-backed endpoints, so new registered policies appear automatically without frontend code changes.

## 3) Session-scoped enable/disable for scenario candidates

Each session has a filter set (`enabled_strategies`) controlling which strategies are used in `/hmi/scenarios` and `/hmi/recommendations`.

Endpoints:
- `GET /session/{id}/strategies`
- `POST /session/{id}/strategies` with `{ "enabled_ids": [ ... ] }`

Rules:
- At least one scenario policy must remain enabled.
- The currently active baseline policy is always forced enabled.
- On the welcome page, users can deselect policies before creating a session,
  but at least one policy must stay selected.

## 4) Example policies folder

Three example policies are available under:
- `app/policies/examples/deadlock_avoidance_policy.py`
- `app/policies/examples/shortest_path_policy.py`
- `app/policies/examples/random_policy.py`

Use them as reference implementations.

## 5) Observation builder note

A policy should always declare the observation builder it expects in `build_observation_builder()`.

Examples:
- DLA: `FullEnvObservation`
- ShortestPath/Random: `DummyObservationBuilder`

Keeping this explicit avoids hidden coupling and makes policy plugins portable.
