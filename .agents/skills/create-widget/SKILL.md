---
name: create-widget
description: Author a new HMI widget (panel) for the Flatland Dispatcher playground. Use when the user wants to create, add, design, or scaffold a new widget / panel / dashboard widget, pick the right widget kind, or figure out how a widget should behave per interaction mode. Guides the spec-before-code process, shows a visual kind-picker and a widget preview, and wires the widget into every registration seam and the Widget Gallery.
---

# Create a Widget

Author a new HMI **widget** (panel) end-to-end: pick its `kind`, write the spec,
define per-mode behaviour, scaffold the component, and register it at every seam
— including the widget-catalog registry that feeds the in-app **Widget Gallery**.

This skill operationalises [`docs/reference/widget-authoring-process.md`](../../../docs/reference/widget-authoring-process.md).
Read that doc and [`docs/reference/interaction-framework.md`](../../../docs/reference/interaction-framework.md)
if you have not; this skill assumes their vocabulary.

## Core principles (do not skip)

1. **Spec before code.** Never scaffold a component before the spec's three axes
   are answered: *what function* (`kind`), *how it behaves per mode*, *how it
   touches the system*. The spec usually surfaces a backend gap first.
2. **Grounded + source-origin.** Every widget names **two** things, both written
   into the spec's Identity (§1):
   - **Reference** — the conceptual grounding (a consortium deliverable, a paper, a
     control-room practice). No generic-dashboard widgets.
   - **Source origin** — where any reused *source code* comes from (e.g.
     `Source: AI4REALNET/InteractiveAI — frontend/src/components/organisms/Graph.vue`),
     or `Source: from-scratch, deliberately` when there is none. This makes the
     "reuse, don't reinvent" guardrail ([`ecosystem.md`](../../../docs/reference/ecosystem.md)) auditable per
     widget — the reader can see at a glance whether an algorithm was integrated or
     rebuilt, and where to find the upstream code.
3. **Reuse the AI4REALNET algorithm, don't rebuild it.** If a capability has a
   consortium reference implementation (A3S/TraceRL, RL_agent_failure_forecast,
   Tokener, T2.3…), integrate it. Building our own is an *explicit* decision
   written into the spec's Open questions — never by omission. ([`ecosystem.md`](../../../docs/reference/ecosystem.md).)
4. **One mode-aware component, not three.** Mode-varying behaviour lives inside a
   single component via a `modeBehavior` computed (reference:
   `impact-panel.component.ts`, `risk-uncertainty-panel.component.ts`).
5. **No hardcoded colours.** Lyne tokens (`--sbb-color-*`), app tokens
   (`--app-*`), or `light-dark()`. Kind badge colours are the `--app-kind-*`
   tokens. Agent colours via `AgentColorService`.

## Workflow

Run these steps **in order**. Do not jump to scaffolding.

### Step 0 — Orient in the existing catalog
Read [`frontend/src/app/core/widgets/widget-catalog.ts`](../../../frontend/src/app/core/widgets/widget-catalog.ts).
It is the single source of truth for every widget's kind, granularity, status,
per-mode behaviour and grounding. Check whether the user's idea overlaps an
existing widget or a `status: 'planned'` catalog entry (A3, B1, B2, C1, C2, D1, D2).
If it does, prefer extending that entry over inventing a new one.

### Step 1 — Pick the `kind` (visual decision aid)
The widget's **primary** classification is its function in the human-AI loop, not
its visual form. Present the seven kinds and let the user choose, using
[`assets/kind-picker.md`](assets/kind-picker.md) as the source (it encodes each
kind's badge colour, the question it answers, and whether it is AI-novel). If your
tool can render inline HTML/SVG (e.g. Claude's `mcp__visualize__show_widget`),
**render it as a visual kind-picker**; otherwise present the table in that file as text.

Decision guide — ask *"what does the operator do with this widget?"*:
- *Notice what's happening* → **Event**
- *Understand why / how bad / whom it affects* → **Context**
- *Know what happens next or try a what-if* → **Prediction** ⭐
- *Choose among options on evidence* → **Decision Support** ⭐ (framing varies by mode)
- *Act on / adjust the system* → **Control**
- *Learn / reflect / record a decision* → **Capitalization** ⭐
- *Judge whether to rely on the AI* → **Trust** ⭐

⭐ = AI-novel core capability (the project's centre of gravity).

**Decision Support is special:** it is *framed by the mode* — Assessment
(neutral, evidence for/against) in Co-Learning, Recommendation (ranked +
confidence) in Recommendation mode, suppressed/read-only in Director. Say which
framing per mode explicitly.

### Step 2 — Write the spec
Create `docs/plans/widget-<id>-<slug>.md` from
[`assets/widget-spec-template.md`](assets/widget-spec-template.md). Fill **all eight
sections**. The per-mode behaviour section (3) and the backend table (4) are the
ones that most often expose problems — do not hand-wave them.

Confirm the spec with the user before writing any code.

### Step 3 — Preview the widget idea (optional but encouraged)
Before scaffolding, show a quick **mockup** of the proposed widget so the user can
react to the layout — rendered inline if your tool can (e.g.
`mcp__visualize__show_widget`), otherwise a small standalone HTML file or an ASCII sketch. Use the kind's
badge colour for the header. Keep it schematic — this is to align on content and
hierarchy, not final styling.

### Step 4 — Scaffold the component
Create `frontend/src/app/features/<slug>/<slug>.component.{ts,html,scss}`:
- Standalone component, `signals`, `CUSTOM_ELEMENTS_SCHEMA` if Lyne elements are used.
- `@Input() embedded = false` if it renders inside the plugin host (most do).
- Mode-varying behaviour via a `modeBehavior = computed(() => { switch (store.interactionMode()) … })`.
  Framing that is already a store projection uses `store.optionPresentation()`.
- Honest backend scoping: start with data the store already exposes; anything
  richer is a **flagged extension**, never faked.

### Step 5 — Register at every seam
A finished widget touches this exact set of registration points. Miss one and it
either won't render, won't be draggable, or won't appear in the gallery. Use
[`assets/registration-checklist.md`](assets/registration-checklist.md) as the
authoritative list; the seams are:

1. `features/layout/components/panel-plugin-host/panel-plugin-host.component.ts` — import + add to `imports[]`.
2. `…/panel-plugin-host.component.html` — add a `@case ('<type>')` rendering the component.
3. `features/layout-designer/layout-designer.component.ts` — add a `palette` entry (type, title, minHeight, description, kind).
4. `core/layout/panel-mode-availability.ts` — add to `PANEL_MODE_AVAILABILITY` **only if** the widget is mode-restricted (omit = all modes).
5. **`core/widgets/widget-catalog.ts`** — add a `WidgetMeta` entry: `kind`, `granularity`, `status`, `description`, `promise`, `grounding`, `availableModes`, `perMode` (all three), `defaultZone`, `minHeight`, `spec`. **This is what the Widget Gallery reads** — keep `availableModes` identical to step 4 (the gallery flags drift).
6. `app.component.html` / `app.component.ts` hardcoded default layout — **only** if the widget ships in the default layout by default.

### Step 6 — Backend (only if the spec's table needs it)
Add the endpoint/field; keep `backend/tests/` green; add coverage for new gating.
Prefer gating presentation in the frontend over reshaping payloads ([`backend/AGENTS.md`](../../../backend/AGENTS.md)).

### Step 7 — Verify
- `cd frontend && npx ng build` clean (no template/type errors).
- Run the app and drive it **per mode** (your tool's browser preview if it has one,
  otherwise `npm run start` + a browser): behaviour must differ
  across the three modes exactly as the spec's section 3 states.
- Open `/widgets`, confirm the new widget appears under the right kind with correct
  per-mode text and no "availability drift" warning.
- Walk the spec's acceptance scenario.

### Step 8 — Document
- Add a row to [`docs/reference/panel-mode-matrix.md`](../../../docs/reference/panel-mode-matrix.md)
  (availability + per-mode behaviour) if behaviour branches on mode.
- Flip/append the widget's status in [`docs/plans/widget-catalog.md`](../../../docs/plans/widget-catalog.md).

## Definition of done
- Spec sections 1–8 answered; acceptance scenario demonstrably passes.
- Behaviour differs across the three modes exactly as the spec states.
- Registered at **all six** applicable seams; `widget-catalog.ts` entry present and
  consistent with `panel-mode-availability.ts` (no gallery drift warning).
- Appears correctly in `/widgets`; `panel-mode-matrix` row added.
- `ng build` clean; `npm run lint:styles` and `npm run i18n:check` green; backend tests green.
- All new user-facing text is in `frontend/public/i18n/{en,de,fr}.json`.
- Any deferred capability is a written flagged extension, not silently dropped.

## Guardrails ([`AGENTS.md`](../../../AGENTS.md))
- Keep mode semantics in the `InteractionMode` union — no parallel flags.
- Don't touch trajectory compression (`session.store.ts _recordTrajectory`),
  scenario-refresh throttling, or the `_recoverPolicyAndRetry*` fallbacks.
- Policy is global per session; per-agent policy does not exist yet.
- Frontend stays Angular standalone + signals + SBB Lyne.
