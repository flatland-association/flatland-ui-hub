# Synthetic dispatcher

Deterministic operators that take the human's role, for reproducible runs and
demos. Usage: [dispatcher-agents.md](../dispatcher-agents.md). Measurements:
[dispatcher-agents-results.md](../dispatcher-agents-results.md).

**Grounding:** the requested test strategies and D3.1's allocation and audit
trail. **Source:** built here, as a written decision: it is operator automation
around existing commands, not a new dispatching algorithm. The event format has
not been compared with the A3S/TraceRL audit trail yet; do that before study use.

## Promise

Observe a synthetic operator's actual decisions and results, pause the
simulation, or explicitly take over its role.

## Per-mode behaviour

| Mode | Behaviour |
|---|---|
| Recommendation | Accept the preferred strategy; optionally delay it, or choose the PP alternative for an explicit train order. |
| Director | Set explicit goal weights; optionally delay them, emphasise one objective, or replace them at a planned logical time. |
| Co-Learning | Unsupported: neutral choices and human reflection are not automated. |

## How it works

- **One owner.** `owner` is `human` or `synthetic`, separate from the train policy
  and from `InteractionMode`. Manual commands while the synthetic operator owns
  the role return 409 `dispatcher_owns_role`.
- **One clock.** The backend pulses before each Flatland step: observe, plan,
  validate, execute if due. Reads and the overlay never advance it. Recommendation
  holds the step while a response is pending; explicit Pause advances nothing.
- **Same commands.** Execution calls the human endpoints' functions, not the DOM.
- **Invalidation.** Takeover, stop, reset, mode change and end cancel pending work.
  A takeover marks the run `mixed`. Parameters are frozen for the run.
- **Director.** Planning is synchronous at logical boundaries for determinism and
  runs in a worker (`run_in_worker`, `dispatcher_driver.py`), so other sessions keep
  answering; a takeover or pause is acknowledged once the step in flight is done. `directive_effective` needs matching
  weights in a committed plan, separately from command acceptance.
- **Presentation.** A read-only speech overlay and cursor follow the native
  Apply/Commit controls. There is no widget, panel or layout slot.
- **Start.** Prepared demos are tours in the **Dispatcher demos** group
  ([tour-picker-groups.md](tour-picker-groups.md)) and carry no run reference. In
  **Build your own**, the operator choice defaults to Human and is not stored across
  reloads. Guided experiments and other tours never use it.

## Boundaries

Single backend process, as with sessions today. No LLM calls, training, stress
estimates or psychological claims. Only public operator payloads enter decisions.
Synthetic runs answer no questionnaires and carry no participant id.

## New files

| File | Adds |
|---|---|
| `backend/app/core/dispatcher.py` | Profiles, config, runtime, export |
| `backend/app/core/dispatcher_driver.py` | Worker transaction, playback status, stop request |
| `backend/app/api/dispatcher.py` | Profiles, demos, ownership, stop, export; the middleware that gates commands |
| `backend/app/dispatcher_batch.py` | Browser-free driver |
| `backend/app/core/director_objectives.py` | A/B/C presets, moved from `sessions.py` unchanged |
| `backend/examples/dispatcher-*.json` | Batch configurations |
| `backend/tests/test_dispatcher.py` | Gating, lifecycle and determinism tests |
| `frontend/src/app/core/dispatcher.ts` | Types and default config |
| `frontend/src/app/core/dispatcher-activity.service.ts` | Read-only projection for the overlay |
| `frontend/src/app/core/dispatcher-target.directive.ts` | Marks native controls the overlay points at |
| `frontend/src/app/features/dispatcher-activity-overlay/` | Speech overlay, cursor, event log |
| `frontend/src/app/features/dispatcher-config/` | Operator form in Build your own |
| `frontend/e2e/dispatcher.spec.ts`, `e2e/support/dispatcher-batch.ts` | Browser and parity tests |

## Modified files

| File | Change |
|---|---|
| `backend/app/api/sessions.py`, `websockets.py` | Create option, pulse before each step, state payload, ownership checks |
| `backend/app/api/overrides.py`, `core/contention_strategies.py` | `require_human` on manual commands |
| `backend/app/core/session_manager.py`, `models/session.py` | `operator_type`, `dispatcher`, `interaction_mode` on create |
| `backend/app/core/env_step.py` | `after_step` hook |
| `backend/app/core/lab_session.py` | Command origin in the choice log |
| `backend/app/policies/goal_directed_policy.py` | Synchronous replan switch, off for human sessions |
| `backend/app/main.py` | Router and middleware |
| `frontend/src/app/core/session.store.ts`, `api.service.ts`, `models.ts` | Dispatcher state, ownership, autoplay, API calls |
| `frontend/src/app/core/websocket.service.ts` | Receipt time of the last state |
| `frontend/src/app/core/interaction-log/` | `operatorType` and config in the session header |
| `frontend/src/app/app.component.*` | Dispatcher tours, config form, overlay host |
| `frontend/src/app/features/toolbar/` | Owner, takeover, hand-back, event log |
| `frontend/src/app/features/strategy-options/`, `combined-actions/`, `director-weights/`, `flatland-map/` | Overlay targets, selection follows confirmed plans, train rings |
| `frontend/public/i18n/{en,de,fr}.json` | `dispatcher.*` keys |
| `frontend/e2e/support/pages.ts`, `matrix.ts` | Page objects and setup matrix |
