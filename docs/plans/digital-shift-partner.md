# Digital shift partner: human + partner staffing

## Purpose and scope

Add a third staffing condition alongside Human and Synthetic dispatcher. Staffing
is independent from the existing InteractionMode union: Recommendation,
Co-Learning and Director remain unchanged. No new widget or layout. Use the
existing start configuration, one additional prepared Team demo (a tour in the Dispatcher demos group,
[tour-picker-groups.md](tour-picker-groups.md)), and
existing floating speech/avatar for consent. Retain normal human study defaults.

## Behaviour contract

`operator_type=human_dispatcher_team` is a stable run classification, never
inferred from a later takeover. Team free runs are distinct from existing human
study conditions and from fully synthetic runs. Record real human decisions as
human events, partner commands as digital_shift_partner; no invented questionnaire
or reflection answers. Human data is never attributed to the scripted operator.

- Recommendation: partner observes existing public options, proposes a validated
  original command, then waits for explicit human approval. No unattended action,
  implicit approval or wall-clock timeout. Environment holds at that decision.
- Director: consent applies to high-level goal directives. Existing autonomous
  train planning remains unchanged. Once consent is given the partner executes
  the same validated directive path. Pending initial directive may hold startup;
  subsequent controller operation continues while consent is pending.
- Co-Learning: baseline-only neutral observation; human owns decisions and
  reflection. No preferred choice, ranking or automated human answer is generated.
- One active command owner. Human may take over, cancelling pending work and
  invalidating its generation. Delegation starts afresh; Director validates and
  restores its required goal_directed controller.
- Approval API: POST `/session/{id}/dispatcher/decision` with command_id,
  generation and decision approve|decline. Bind to the immutable pending proposal,
  reject stale/opposing responses; identical retries are idempotent. Approval
  grants execution on the next normal pulse and never resumes a paused run.
  Decline suppresses the same proposal instead of prompting in a loop.
- Snapshot adds requires_approval, awaiting_approval and approved_command_id.
  Preserve existing human/synthetic creation defaults and API fields.

## Runtime integrity and responsiveness

Preserve aborted/error outcomes and their final measurements across subsequent
manual stepping/reset; a failed synthetic run cannot become complete. Effective
Director evidence requires the actual goal_directed controller. Identical
initial/replacement objectives do not count as a changed goal.

Move synchronous synthetic step/planner work off the ASGI event loop, preserving
one sequential command transaction and deterministic logical pulses. Stop signals
prevent another step. If computation is already in flight, drain it before
acknowledging ownership/pause; manual writes cannot race late planner results.
The UI displays a pending handoff/stop until the backend confirms completion.
Do not claim uninterruptible model computation has been interrupted.

Pure Director progress and playback-status reads bypass expensive session
transactions; unsafe environment reads and writes retain serialization. Publish
backend playing/busy state on initial snapshots, step snapshots and control
changes so other views do not infer playback from local clicks. Discard stale
WebSocket callbacks using the active socket/connection generation.

## UI and evidence

Three staffing choices in Build your own; keep existing synthetic select value
agent for compatibility, new Team value human_dispatcher_team. Team Co-Learning
resolves to neutral baseline. One-click Team demo reuses the authored small
Recommendation scenario and existing measures layout. Existing two demos remain.

Speech identifies the Team role and offers Approve/Decline on the real proposal,
with command/generation test hooks. Control-pending state is explicit. Existing
native target markers, current-state/history separation and reduced motion remain.
All new copy EN/DE/FR; French copy is a draft pending native review.

## Files

New: this plan; `backend/app/core/dispatcher_driver.py` (worker drain and read-only
playback telemetry); `backend/tests/test_dispatcher_team.py` and
`backend/tests/test_dispatcher_driver.py`; `frontend/e2e/dispatcher-team.spec.ts`;
`frontend/src/app/core/websocket.service.spec.ts` and
`frontend/src/app/features/dispatcher-config/dispatcher-config.component.spec.ts` and
`frontend/src/app/features/mode-intro/mode-intro.component.spec.ts`;
production captures/exports in
`docs/examples/dispatcher-agents/team/`.

Modified backend: core/dispatcher.py (consent/lifecycle/metrics), models/session.py
(staffing), core/session_manager.py (creation), api/dispatcher.py (consent and
control serialization), api/sessions.py and api/websockets.py (public staffing,
step worker and authoritative playback; existing PlayManager uses the drained worker),
core/lab_session.py (classification), serializer/models if needed for status.

Modified frontend: dispatcher DTO/API/store, config component, app launchers and
setup persistence, toolbar and WS service; interaction-log metadata; existing
activity service/overlay (consent controls); ModeIntro start guard and session
creation/opening barriers; EN/DE/FR copy; E2E matrix/page objects.
Modified docs: usage/results/index, generated experiment click-id table and mode/staffing guidance. No changes to
trajectory compression, scenario refresh throttling, recovery fallbacks or
existing human study layouts.

## Acceptance

Team launch → actual proposal → no command before human consent → approve while
paused preserves pause → resume executes original command exactly once. Decline,
stale reply, double reply, takeover and reset cannot execute an old command.
Co-Learning remains neutral and human-driven. Director delegation restores the
proper controller and proves committed-plan uptake. Error/abort classifications
stay terminal. A second real browser controlling the same backend changes the
first view's actual play/pause status. Old WS closure cannot clobber a new socket.

Run focused backend and UI cases, frontend production/i18n/style checks, relevant
backend suite, then broad fast E2E. Known open baseline failures remain red with
causes recorded; no skips/retries/relaxed assertions or timeout budget increases.
Verify in production browser and preserve running user-session exports before any
backend restart. Commit/push the tested addition to the already shared branch.
