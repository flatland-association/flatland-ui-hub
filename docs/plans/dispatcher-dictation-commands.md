# Optional dictation command entry

## Scope

Add an opt-in, browser-persisted setting for text commands in the existing
floating dispatcher speech bubble. Wispr Flow can insert dictation into this
ordinary focused text field. No microphone access, speech SDK, external service,
new widget or new interaction mode. Default off. Existing mouse controls remain.

Submit explicitly with Enter or Send; typing/pasting alone never executes. Support
exact German/English/French aliases for Pause, Resume, Approve proposal, Decline
proposal and Take over. Normalise casing, whitespace and sentence-final full stops;
reject unknown/negated/combined commands, never infer a command from a substring.
No LLM or new algorithm: this is a small input adapter to existing validated
SessionStore/backend commands.

Capture the active session and proposal when editing begins/focus enters. Approval
and decline must match the captured session, command ID and generation and the
currently awaiting proposal. Old text cannot approve a replacement proposal.
Clear draft/context on disable and session changes. Pending requests block duplicate
submissions. Pause remains available during ongoing computation. Respect existing
ownership, terminal states, Co-Learning neutrality, session startup and actual
playback; approval never implies Play. Feedback says submitted/blocked/no-op,
never claims backend execution before acknowledgement. Do not record raw dictation.

## New files

- frontend/src/app/core/dispatcher-commands.ts — exact command parser + context types.
- frontend/src/app/core/dispatcher-commands.spec.ts — meaningful parser cases.
- frontend/src/app/core/dispatcher-commands.service.ts — preference, context binding,
  command gating and delegation to existing SessionStore controls.
- frontend/src/app/core/dispatcher-commands.service.spec.ts — stale context,
  opt-out, consent and existing control dispatch verification.
- frontend/e2e/dispatcher-commands.spec.ts — actual UI settings, persistence,
  no execution on typing, commands and invalid/stale proposal handling.

## Modified files

- App component TS/HTML — settings draft, apply/cancel and opt-in checkbox.
- Existing dispatcher monitor TS/HTML/SCSS — inline input/form in speech only.
- EN/DE/FR dictionaries — all copy; French draft pending native review.
- E2E page objects/matrix as necessary, generated click-id docs and usage/results.
- No backend, policy, trajectory, scenario-throttle or recovery-method changes.

## Verification and delivery

Use the project e2e-tests skill. Run scoped parser/service units, a production
build, style and translation checks, focused real-backend browser cases followed
by broad fast regression (existing known bugs remain red). Inspect actual UI.
Deploy frontend assets without restarting existing backend sessions, then commit
and push to the already shared codex/dispatcher-agents branch. Guard canonical
file copies against independent changes. Confirm exact served build and clean Git.
