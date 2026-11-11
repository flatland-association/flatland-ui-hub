# PF-CH RL in the Explore-DB UI

Base: current `hub/explore_db` (`d7d64c7`). Integrate the verified public-demo actor as an explicitly selectable session policy. In its guided PF-CH run it executes actions instead of PP. Existing sessions and the objective-aware PP dispatcher keep their current semantics.

## Runtime and entry point

- Reuse the exact service/context observation and learned-policy runtime from training commit `75af18b`; retain legacy checkpoint behaviour.
- Bundle an inference-only export of `pf-ch-public-demos-20261111-b` under `app/policies/learned/checkpoints`, with original checkpoint SHA `73afbad39106ac972884d0ef88cf99e44cf50861593a4146179cd5a83aa9d5d5`. Preserve every model tensor; exclude optimiser/RNG state and private training paths. Record both hashes and validate tensor equality.
- Register stable id `pf_ch_rl`, independent of the writable MARL lab directory. Describe its PF-CH/16-train scope and known-demo evidence explicitly. No planner fallback inside this policy.
- Provide a guided RL corridor run through the existing tour mechanism, including the four authored faults and a 320-step horizon. It starts without a synthetic dispatcher and pins the RL policy. Existing toolbar policy selection remains available.
- Keep an explicitly selected PF-CH RL policy when changing interaction modes; presentation, human overrides and existing dispatcher ownership remain governed by the same modes.
- Ship Torch and the bundled actor in production/HF images. Do not repurpose the lab output directory.

## New files

| File | Purpose |
| --- | --- |
| `backend/app/policies/learned/pf_ch_observation.py` | Verified 272-feature PF-CH context builder |
| `backend/app/policies/learned/pf_ch_bundle.py` | Torch-free fixed bundle metadata/path and compatibility helpers |
| `backend/app/policies/learned/checkpoints/pf_ch_demo_ppo.pt` and `.json` | Portable inference weights and provenance |
| `backend/tests/test_pf_ch_bundle.py` | Bundle identity, loading, availability and compatibility |
| `backend/tests/test_pf_ch_playback_control.py`, `test_pf_ch_request_control.py` | Responsive controls, mutation serialization, actor changes and inference equivalence |
| `backend/tests/test_pf_ch_context_observation.py`, `test_ecml_service_observation.py` | Port runtime/legacy regressions |

## Modified files

| File | Change |
| --- | --- |
| `backend/app/policies/learned/ecml_observation.py`, `learned_ppo_policy.py` | Port versioned service/context runtime; separate synchronous feature capture from pure inference |
| `backend/app/policies/registry.py` | Register bundled PF-CH actor and accurate metadata |
| `backend/app/api/sessions.py`, `websockets.py`, `dispatcher.py` | Scope validation; responsive PF-CH inference; serialize mutations and drain before control/actor-change ACKs |
| `backend/app/policies/override_policy.py` | Apply human overrides only after a proposal is accepted for the physical step |
| `backend/app/core/lab_session.py`, `lab_training.py`, `backend/lab/marl/common.py`, `train_ppo.py` | Keep read-only learned-policy displays and schema handling correct; reject unsupported browser fine-tuning |
| `backend/app/core/online_learning/learner.py` | Preserve explicit service schema on newly trained 36-feature models |
| `backend/lab/marl/finetune_interventions.py` | Preserve legacy schema and reject unsupported context fine-tuning |
| `frontend/src/app/core/demo/tours.ts`, `frontend/src/app/app.component.ts`, `frontend/src/app/core/layout/layout-presets.ts` | Guided RL recipe, its episode horizon and an existing-panel layout without planner controls |
| `frontend/src/app/core/session.store.ts` and related tests | Preserve explicitly selected RL through mode changes |
| `frontend/public/i18n/{en,de,fr}.json` | Policy/tour wording where keyed UI requires it |
| `Dockerfile` | Install CPU Torch; the existing HF image already installs Torch and copies the app bundle |
| `frontend/e2e/support/pages.ts`, `support/setup-check.ts`, `tours.spec.ts` | Reuse page objects and the generated setup matrix; check actual RL driver, horizon and restart |

## Acceptance

1. Fresh Explore-DB checkout/image exposes `pf_ch_rl` with no lab files or training installation.
2. Starting the RL tour selects the bundled network and remains under that policy across steps, pause/restart and mode switches.
3. Native execution checks 16/16 destinations and 48/48 calls on unchanged and four-fault corridor fixtures. HTTP checks arrivals/finish times; the browser checks the visible driver and running app.
4. No arbitrary-map global default, no silent PP replacement of the RL driver, no change to existing synthetic dispatcher or human authority semantics.
5. Backend/runtime checks and frontend style/i18n/build/E2E checks pass, with existing documented E2E bugs reported separately.

Known scope: fifteen trained public fixtures passed; changed development timetables passed 4/10. This integration does not establish generalisation or PP superiority.

## Using the integration

In Introduction → Watch, choose **PF-CH · trained RL dispatcher**, or open `#/tour/pf-ch-rl-corridor/start`. This starts a new Director-mode session with the bundled `pf_ch_rl` policy, four scripted corridor faults and the trained 320-step horizon. The RL supervision layout uses existing state/map/timetable/inspection panels and does not instantiate PP strategy or training widgets. The existing policy picker can also select the actor for another supported PF-CH preset. Changing between PP and PF-CH RL through the picker pauses and drains the prior driver; press Play to run the selected policy. A direct Play request for a changed PF-CH actor drains the old loop before starting the new one.

The local preview uses `http://127.0.0.1:8003/#/tour/pf-ch-rl-corridor/start`; existing sessions on other ports were preserved. The deployed Explore-DB Space receives the integration after merge and a rebuild through the existing Space workflow. An `explore_db` push by the Space owner deploys automatically; other actors use the workflow’s explicit manual trigger. The actor is included in `app`, so it survives the writable lab directory being empty or redirected.

## Verification

- Inference export: 288717 bytes, SHA256 `a449bcccc3a0066bc33985be325f11cac22364e34d5624cf4384dd52c457b831`; every model tensor equals the verified training artifact. No optimiser, RNG state or private training paths are shipped.
- Native runtime and [recorded HTTP cases](../examples/pf-ch-rl-ui/http-proof.json) reproduce all fifteen known demo arrival/finish results. Required-stop correctness is checked independently in native mission tests.
- The generated Playwright RL tour and layout tests pass, including confirmed policy selection, actual Play requests, the 320-step horizon, pause and UI restart. Store regression tests and frontend style/i18n/production build pass.
- Complete native backend regression: 810 passed, 25 skipped. [GitHub CI with the slow backend tier](https://github.com/flatland-association/flatland-ui-hub/actions/runs/43016359097) passed all three jobs on `0bc3d376`. Full browser results are recorded separately in the PR; existing documented failures remain separate from this feature.

A [running-app screenshot](pf-ch-rl-ui-integration/1-rl-driver.png) shows the confirmed RL driver, Director supervision and the 320-step horizon. The final production build also passes the start-screen and RL lifecycle browser cases.

French UI copy is a draft. The inference scope remains the known public PF-CH fixtures; the model has not passed the varied sixteen-train timetable gate.

## Control responsiveness and final regression

The first complete browser matrix recorded **124 passed / 20 failed**. Seventeen failures match documented bugs 2, 6, 9 and 10. Two PP-only time-budget failures remain unisolated and are documented as bug 12; a passing pristine focused run does not prove their cause. The new RL lifecycle exposed a real delayed Pause response after restart. That defect was fixed rather than hidden by retries or larger timeouts.

Only pure network inference now leaves ASGI: features are captured into a private batch first, and physics and human override consumption remain synchronous. Pause/Reset/Delete signal Stop, wait for inference to drain, and prevent its discarded proposals from stepping or consuming one-shot overrides. Mutation requests serialize; read-only forecasts retain their existing paths. PP/RL switches use the actual prior PlayState and validate before stopping it.

The final targeted regression passes **63 tests**, covering actor changes in both directions, unchanged legacy retunes, mutation/control barriers, unchanged PF-CH and legacy logits/actions, and no live-env access in the worker. The affected browser lifecycle passes in **33.28 s** with both server-confirmed pauses and UI restart, original deadlines and zero retries. The full matrix has not been relabelled green or rerun to replace its original result.

Two extra uninterrupted browser observations hit their unchanged 90-second measurement window at steps 145 and 107 on a heavily loaded shared host; cleanup alone stopped those runs. They establish neither an early UI pause nor a complete browser mission. Full destination/stop correctness remains established by the native missions and recorded HTTP cases above.
