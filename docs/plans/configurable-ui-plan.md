# Configurable UI — a startup config file for hiding UI items (issue #145)

> **Status: proposal, nothing implemented yet.** This plan answers the "how"
> for [issue #145](https://github.com/flatland-association/flatland-ui-hub/issues/145)
> ("Configurable UI") and its own first comment, which scopes the first step
> deliberately small: a **startup option pointing at a configuration file**,
> with no in-app selection UI or export yet ("starten ohne Auswahl / Export im
> UI, ggf. später noch dazunehmen"). Frontend-only; no backend change needed.

---

## 1. The issue, translated

The issue body is explicitly "(Nicht abschliessende Liste)" — a non-exhaustive
list, gathered from a dispatcher/demo review. Translated from German in full
below (the issue itself stays German; this table is the English reading this
plan works from):

| # | Issue item (translated from German) | Concrete UI location (verified in code) |
|---|---|---|
| 1 | Remove the contrast setting and the whole map pan/zoom control overlay | Contrast = the "Colours" tab of the Session Settings dialog (`app.component.html:719-740`, the Visual-Encoding preset radiogroup). The control overlay = **both** the map's `.map-nav-overlay` (pan D-pad + reset, `flatland-map.component.html:789-795`) and `.map-zoom-overlay` (zoom in/out, `:797-802`) — confirmed (2026-10-23) to be one and the same ask: no pan, no zoom, no contrast setting. |
| 2 | Hide the Decision Log, or collapse it by default | The `decision-log` panel (catalog id A2, `widget-catalog.ts:1030`). Collapsed-by-default is the panel's own `collapsed` signal (`decision-log-panel.component.ts:120`, currently hardcoded `false`). |
| 3 | Comparison section (bottom right): which figures does it show, and what do they mean? Currently shown: delay vs. timetable and time in network, as bars and numbers — exactly which figures help here is still to be decided. | Identified (2026-10-23): widget `proposal-compare` ("Plan / KI / Mensch", catalogId B1b), its `pc-compare` section (`proposal-compare.component.html:128-156`), fed by the `comparison` computed property (`proposal-compare.component.ts:345-383`) with two axes, `lateness` ("Verspätung gegenüber Fahrplan") and `time` ("Zeit im Netz"). Which figures belong here long-term is still open — see §6 — but per-axis visibility is now in scope for this plan, worked out in §4.3b/§5. |
| 4 | The "End shift" button isn't needed -> remove | `director-directive.component.html:38-40` (`store.endShift()`); also reachable from `tour-guide.component.html:48-49`. |
| 5 | Policy not selectable -> hide | The toolbar's `<select class="policy-select">` (`toolbar.component.html:48-66`), populated from `selectablePolicies()` (`toolbar.component.ts:48-51`) and shown only `@if (selectablePolicies().length > 0)`. Confirmed (2026-10-24) to be about **which policies appear in the dropdown**, not an all-or-nothing toggle on the control — see §4.3c. |

The PR-linked comment adds the actual ask: start with a **configuration file**,
loaded via a **startup option**, created by hand (or with an LLM) rather than
built in-app. The in-UI selector/export mentioned there is explicitly a later
step, not this one.

---

## 2. Goal

A frontend startup option that points at a JSON file. The file declares, by
a stable id, which UI items are **hidden** (not rendered at all) or
**collapsed by default** (rendered, but starts closed) — so a deployment can
hand someone a restricted view (a public demo, a study condition, an
onboarding profile) without a code change per audience.

No item needs a third, "visible but non-interactive" (disabled) state: the one
candidate for it (the policy selector) turned out to need a content filter
instead (§4.3c), not a disabled-but-visible control — see §6. `hidden` and
`collapsedByDefault` cover every id-based item; a "disabled" state can still be
added later if a real need for it turns up.

**The issue's own config ships as a real, checked-in file, not just a doc
example.** The issue carries the `plan b` label ("user studies FHNW & SBB") —
this is a real study condition, not a hypothetical. `§5`'s config — every item
in §1's table, encoded — is committed at
`frontend/public/assets/ui-configs/plan-b-ui-config.json` and serves two roles
at once: it's the literal config the Plan B study launches with
(`?uiConfig=assets/ui-configs/plan-b-ui-config.json`), and it's exercised
directly by the test suite (§4.5, §7), so "what the tests check" and "what
Plan B actually ships" can't drift apart into two separate files that quietly
diverge.

**Human-readable** is the hard requirement from the issue: reading the file
must make it obvious what is hidden, without having to cross-reference code.
This plan meets that with:
- Plain English **ids** per item (`widget.decision-log`, `control.endShift`),
  not source identifiers, so the file reads like a checklist.
- The file is grouped **by verb** (`hidden` / `collapsedByDefault` arrays of
  ids), not one object per item with a boolean buried inside — scanning two
  short arrays says more at a glance than scanning thirty keys.
- A **JSON Schema** alongside the format, with an `enum` + `description` per
  valid id, so an editor (e.g. VS Code) offers inline documentation and
  autocomplete, and a bad id is flagged before the file is ever loaded.

## 3. Non-goals (v1)

- No in-app config builder or export (per the issue comment — later step).
- No per-session runtime toggle UI for these items (a dispatcher using a
  restricted profile cannot turn a hidden item back on from inside the app —
  that is the point of a *deployment* config, not a *preference*).
- No resolution of *which* figures the `proposal-compare` comparison section
  should show long-term, or what its numbers mean — that's a content
  question, not a hide/disable one. Flagged in §6; genuinely unresolved, not
  blocking this plan. Per-axis visibility for the two figures shown today
  (§4.3b) is in scope and does not require answering it.
- No "disabled" (visible-but-non-interactive) state in v1 — see §2.
- No change to `panel-mode-availability.ts`'s semantics — this plan adds an
  **orthogonal** gate (deployment config), it does not touch the existing
  per-interaction-mode gate.

---

## 4. Design

### 4.1 Startup option

A query parameter read once at boot, resolved to a URL and fetched as JSON —
the same timing `app.config.ts` already uses to warm up Transloco:

```ts
// app.config.ts
provideAppInitializer(() => {
  ...
  const uiConfig = inject(UiConfigService);
  const url = new URLSearchParams(window.location.search).get('uiConfig');
  return url ? uiConfig.load(url) : Promise.resolve();
}),
```

Two forms of value, with different implications:

- **A relative path** (`?uiConfig=assets/ui-configs/plan-b-ui-config.json`)
  resolves against the app's own deployed root, the same way the existing
  `TranslocoHttpLoader` resolves `/i18n/${lang}.json`
  (`core/i18n/transloco-loader.ts:11`) — `angular.json`'s `assets: [{"input":
  "public"}]` copies everything under `frontend/public/` flat into the build
  output, so this form can only ever name a file that is **checked into this
  repo and built into that deployment** — exactly what `plan-b-ui-config.json`
  is (§2, §5).
- **A full URL** (`https://…/some-config.json`) carries no such constraint:
  `HttpClient` performs a plain GET, so any origin that sends permissive CORS
  headers works, whether or not the file is part of this repo at all. This is
  the escape hatch for a one-off config nobody wants to commit here (e.g.
  hosted as a Gist) — not how Plan B's own config is meant to be loaded.

Loading before the first render means a hidden item never flashes on screen
before disappearing, unlike a config applied post-bootstrap.

No default path is assumed for v1 (no query param → nothing hidden, i.e. the
app behaves exactly as it does today). A fixed-profile deployment can still
bookmark/iframe the URL with the query param baked in.

### 4.2 File format

```jsonc
{
  "$schema": "https://.../ui-config.schema.json",
  "hidden": [
    "control.contrast",
    "control.mapNavigation",
    "control.endShift"
  ],
  "collapsedByDefault": [
    "widget.decision-log"
  ],
  "policyAllowlist": ["deadlock_avoidance", "plan"]
}
```

Two id-keyed arrays, both opt-out: everything not named in `"hidden"` stays
visible, everything not named in `"collapsedByDefault"` starts open — the
same rule for every id in the catalog, no exceptions and no per-id defaults to
look up. `"policyAllowlist"` is not id-keyed; it's a separate, narrower,
**optional** mechanism for one specific control (absent → every policy the
session enabled stays offered, i.e. today's behaviour) — see §4.3c for why it
doesn't fit the `hidden`/`collapsedByDefault` model.

- Unknown ids are **ignored with a console warning**, not a hard error — a
  config written against a future/past app version should still load, rather
  than block startup over one stale id (see §4.5).
- `"hidden"` and `"collapsedByDefault"` are independent: an id can be in both
  (though `collapsedByDefault` is then a no-op — nothing to collapse if it's
  not rendered), in neither, or in just one.
- Not every id supports every verb (`control.endShift` is a button —
  "collapsed" doesn't apply to it). The schema's `enum` only offers the verbs
  each id actually supports (see §4.3's `supports` field).

### 4.3 The id catalog — single source of truth

A new registry, `frontend/src/app/core/config/ui-config-items.ts`, lists every
configurable id. Two kinds:

- **`widget`** — every panel type that already has an entry in
  `WIDGET_CATALOG` (`core/widgets/widget-catalog.ts`) gets an id
  `widget.<type>` for free, generated from the catalog rather than hand-copied
  (so the two can't drift):

  ```ts
  const WIDGET_IDS: UiConfigItem[] = WIDGET_CATALOG
    .filter((w) => w.type)
    .map((w) => ({
      id: `widget.${w.type}`,
      label: w.title,
      // Only decision-log has a collapsed-by-default hook today (§4.4) — the
      // schema shouldn't offer a verb that silently does nothing everywhere
      // else.
      supports: w.type === 'decision-log' ? ['hidden', 'collapsedByDefault'] : ['hidden'],
    }));
  ```

- **`control`** — chrome elements that are *not* panels, declared by hand
  because nothing registers them today:

  ```ts
  const CONTROL_IDS: UiConfigItem[] = [
    { id: 'control.contrast', label: 'Colours / high-contrast setting (Session Settings)', supports: ['hidden'] },
    { id: 'control.mapNavigation', label: 'Map pan + zoom control overlay', supports: ['hidden'] },
    { id: 'control.endShift', label: 'End shift button', supports: ['hidden'] },
  ];
  ```

  The toolbar's policy selector is **not** in this list — §4.3c covers it
  separately, since hiding it outright isn't actually the need (see §1, item 5).

`ui-config-items.ts` exports the merged list; a unit test asserts the schema's
id `enum` (§4.5) matches it exactly, the same drift guard the widget gallery
already applies to `WIDGET_CATALOG` vs. the designer palette.

### 4.3b A third kind: `axis` — data items *inside* one widget

Item 3's comparison section (§1) needs a finer grain than "hide the whole
widget": it has two **figures** (`proposal-compare.component.ts:34`'s
`ComparisonAxis['id']`: `'lateness'` and `'time'`), and the question is which
of them belong there, not whether the section exists at all. Otherwise these
are ordinary ids — same `hidden`-only, opt-out model as everything else (§4.2):

```ts
const AXIS_IDS: UiConfigItem[] = [
  { id: 'widget.proposal-compare.axis.lateness', label: 'Comparison: delay vs. timetable (Plan/KI/Mensch)', supports: ['hidden'] },
  { id: 'widget.proposal-compare.axis.time', label: 'Comparison: time in network (Plan/KI/Mensch)', supports: ['hidden'] },
];
```

No special default-visibility handling: both figures render today, so both
stay visible unless a config's `"hidden"` array names one — exactly like
hiding any widget or control. If a future figure is added and the team wants
it to start hidden, that's a one-line decision made at that time (omit it from
the default demo config, or ship it already in `"hidden"`), not a mechanism
built in advance for a figure that doesn't exist yet.

### 4.3c The policy selector: a content filter, not a presence toggle

Item 5 (§1) turns out not to be "hide the whole selector" — it's "which
policies does it offer". `selectablePolicies()`
(`toolbar.component.ts:48-51`) already filters the backend's full policy list
down to whatever the session's scenario enabled
(`enabledPolicyIds`/`enabledControlPolicyIds`, `session.store.ts:134`); the
deployment config needs to narrow that further, not toggle the control on/off.

This doesn't fit the id-based `hidden`/`collapsedByDefault` model at all —
there's no fixed set of "policy ids" to register in the catalog the way
widgets or controls are (policies come from the backend, `store.availablePolicies()`,
not from a frontend registry), and what's being configured is *which values a
control offers*, not *whether it exists*. So it gets its own top-level key
instead of an id:

```jsonc
"policyAllowlist": ["deadlock_avoidance", "plan"]
```

`"policyAllowlist"` is **optional**. Absent, it changes nothing — every policy
the session already enabled stays offered, today's behaviour. Present,
`selectablePolicies()` gains one more filter step: a policy must be in
`enabledPolicyIds()` **and** in `"policyAllowlist"` — the config can only
narrow what the scenario already enabled, never add a policy the scenario
didn't. `"plan"` (`backend/app/policies/registry.py:255`, "Scripted Plan" —
runs the scenario's premade timetable) is itself `show_in_ui: false` and only
ever enabled for a session whose scenario ships a plan; listing it here has no
effect unless Plan B's scenario is one of those, which is tracked as part of
the still-open question in §6.

An **empty** `"policyAllowlist"` filters every policy out, which already
collapses the whole control via the existing
`@if (selectablePolicies().length > 0)` — so "no policies allowed" and "hide
the selector" are the same outcome through the same code path, not two
mechanisms to keep in sync. An unknown policy id in the list is ignored with a
console warning (§4.5), same as an unknown catalog id.

### 4.4 Runtime service and gate points

`UiConfigService` (`core/config/ui-config.service.ts`): loads the file, holds
it as a signal, exposes `isHidden(id)` and `isCollapsedByDefault(id)` — used
identically at every id-based call site, including the comparison axes (§4.3b
introduces no separate resolution logic) — plus one unrelated accessor,
`policyAllowlist()` (§4.3c), returning the raw array or `null` if absent. Call
sites, each a small, local change:

- **Widgets.** `isPanelAvailableInMode` (`core/layout/panel-mode-availability.ts`)
  gets a sibling `isPanelAvailable(type, mode, uiConfig)` that ANDs the
  existing mode check with `!uiConfig.isHidden('widget.' + type)`. The one
  caller that matters is `AppComponent.panelAvailable()`
  (`app.component.ts:389-390`), which every `@if (panelAvailable('...'))` in
  `app.component.html` already funnels through — so widget hiding reaches all
  of them (including the hardcoded `three-col` default layout) from one
  change. `panel-plugin-host` and the Layout Designer palette get the same
  check so a hidden widget can't be reintroduced via a saved design either.
- **Decision Log collapsed-by-default.** `decision-log-panel.component.ts:120`
  currently seeds `collapsed = signal(false)`. Seed it from
  `uiConfig.isCollapsedByDefault('widget.decision-log')` instead. The signal
  stays mutable — this is a *default*, not a lock (matches the issue wording,
  "hide, or default to collapsed": hidden and collapsed-by-default are offered
  as alternatives, not both a lock).
- **Map pan + zoom overlay.** Guard both `flatland-map.component.html:789-795`
  (`.map-nav-overlay`) and `:797-802` (`.map-zoom-overlay`) with
  `@if (!uiConfig.isHidden('control.mapNavigation'))` — one id, two markup
  blocks, since the two overlays are hidden together (§1, item 1).
- **End shift button.** Guard `director-directive.component.html:38-40` and
  `tour-guide.component.html:48-49` the same way — both are the one
  `store.endShift()` action, hiding both button locations from one id.
- **Policy selector.** `selectablePolicies()` (`toolbar.component.ts:48-51`)
  adds one more `.filter()` step against `uiConfig.policyAllowlist()` (§4.3c)
  when it's present. No template change needed: the existing
  `@if (selectablePolicies().length > 0)` already hides the control once the
  filtered list is empty.
- **Contrast / Colours tab.** Guard the tab button and its `@if (settingsTab() === 'colours')`
  block (`app.component.html:719`, `:720`) with `!uiConfig.isHidden('control.contrast')`;
  if hidden while the tab happens to be active, fall back `settingsTab` to `'basic'`.
- **Comparison axes (Plan/KI/Mensch).** `proposal-compare.component.ts:376-382`
  builds the two-element `comparison` array unconditionally; filter it through
  `!uiConfig.isHidden('widget.proposal-compare.axis.' + axis.id)`, same call
  as every other gate point. Return `null` rather than `[]` when the filter
  leaves no axes, so `@if (comparison(); as axes)`
  (`proposal-compare.component.html:128`) drops the whole `pc-compare` section
  — an empty array is still truthy in Angular's `@if`, which would otherwise
  leave the section's header and note rendered over zero rows.

### 4.5 Validation and fail-safe behaviour

- **Fetch/parse failure** (404, malformed JSON): log a console warning, proceed
  with nothing hidden — a broken config must never block the app from loading.
- **Unknown id**: warn and ignore that one id, keep the rest of the file in
  effect (forward/backward compatible with a typo or a renamed widget type).
- **Id used with an unsupported verb** (e.g. `control.endShift`, a button,
  under `collapsedByDefault`): warn and ignore.
- A hand-maintained `ui-config.schema.json` (served from `frontend/public/`,
  referenced via the file's own `$schema`) gives editor-time validation before
  any of the above run-time fallbacks are needed. A unit test
  (`ui-config-items.spec.ts`) keeps the schema's id `enum` and the
  `UI_CONFIG_ITEMS` registry from drifting apart.

### 4.6 Composes with, doesn't replace

- **Per-mode availability** (`panel-mode-availability.ts`) is untouched;
  config hiding is a second, independent gate. A widget hidden by mode in
  Director but shown in Recommendation is unaffected by a config that hides it
  everywhere, and vice versa.
- **Saved layouts / Layout Designer** (`localStorage`, `layout-presets.ts`): a
  saved design naming a config-hidden widget type simply renders nothing for
  that panel slot (same "known gap, inherited" bypass pattern the presets file
  already documents for mode availability — not a new one).

### 4.7 Added vs. modified — the complete file list

§4.1-§4.6 name symbols inline, which reads as "everything here is new" even
though most of the work is a one-line change inside existing files. Spelled
out explicitly:

**New files**

| File | What it is |
|---|---|
| `core/config/ui-config-items.ts` | The id registry: `UI_CONFIG_ITEMS` (merged from `WIDGET_IDS`, `CONTROL_IDS`, `AXIS_IDS`), the `UiConfigItem` type (§4.3, §4.3b). |
| `core/config/ui-config.service.ts` | `UiConfigService`: `load(url)`, `isHidden(id)`, `isCollapsedByDefault(id)`, `policyAllowlist()` (§4.4, §4.3c). |
| `core/config/ui-config-items.spec.ts` | Drift test: schema `enum` vs. `UI_CONFIG_ITEMS` (§4.5). |
| `core/config/ui-config.service.spec.ts` | Load success/failure/unknown-id tests, against the real `plan-b-ui-config.json` (§7). |
| `frontend/public/ui-config.schema.json` | The JSON Schema (§4.5). |
| `frontend/public/assets/ui-configs/plan-b-ui-config.json` | The real Plan B config (§5) — **already committed**, ahead of the rest of this plan. |

**Modified files** — existing file, existing symbol, behaviour changes

| File | Symbol | Change |
|---|---|---|
| `app.config.ts` | the existing `provideAppInitializer` callback | gains a step: read the `uiConfig` query param, call `UiConfigService.load()` (§4.1). |
| `core/layout/panel-mode-availability.ts` | — | gains a new exported function, `isPanelAvailable(type, mode, uiConfig)`, alongside the existing `isPanelAvailableInMode` (unchanged, still called internally) (§4.4). |
| `app.component.ts` | `panelAvailable(type)` (existing method, `:389-390`) | body changes to call the new `isPanelAvailable()` instead of `isPanelAvailableInMode()` directly; every `@if (panelAvailable('…'))` already in `app.component.html` picks this up with no template edit. |
| `app.component.html` | the Colours tab button + its `@if (settingsTab() === 'colours')` block (`:719`, `:720`) | wrapped in `!uiConfig.isHidden('control.contrast')` (§4.4). |
| `decision-log-panel.component.ts` | `collapsed` (existing signal, `:120`, hardcoded `signal(false)`) | initial value seeded from `uiConfig.isCollapsedByDefault('widget.decision-log')` instead (§4.4). |
| `flatland-map.component.html` | `.map-nav-overlay` (`:789-795`) and `.map-zoom-overlay` (`:797-802`) (existing blocks) | both wrapped in `@if (!uiConfig.isHidden('control.mapNavigation'))` (§4.4). |
| `director-directive.component.html` | the end-shift button (`:38-40`, existing) | wrapped in `@if (!uiConfig.isHidden('control.endShift'))` (§4.4). |
| `tour-guide.component.html` | the end-shift button (`:48-49`, existing) | same guard (§4.4). |
| `toolbar.component.ts` | `selectablePolicies` (existing computed, `:48-51`) | gains one more `.filter()` step against `uiConfig.policyAllowlist()` (§4.3c, §4.4) — no template change. |
| `proposal-compare.component.ts` | `comparison` (existing computed, `:345-383`) | each axis filtered through `!uiConfig.isHidden('widget.proposal-compare.axis.' + axis.id)`; returns `null` instead of `[]` when nothing survives (§4.4). |
| `panel-plugin-host.component.ts` (`features/layout/components/panel-plugin-host/`) | its panel-type switch | gated with the same `isPanelAvailable()` check as `AppComponent`, so a saved design can't reintroduce a config-hidden widget. |
| `layout-designer.component.ts` | `filteredPalette` (existing getter, reads `palette`) | gains the same `isPanelAvailable()` filter, so a config-hidden widget type doesn't appear in the designer palette either. |

Nothing in `panel-mode-availability.ts`'s existing behaviour changes for a
caller that never passes a `UiConfigService` (§4.6) — the new function is
additive, the old one is untouched.

---

## 5. `plan-b-ui-config.json` — the issue's own list as a checked-in config file

Committed at `frontend/public/assets/ui-configs/plan-b-ui-config.json` (see
§2) — not a hypothetical, the actual file the Plan B study loads and the test
suite exercises:

Shown here in full — not a fragment — for transparency; this is exactly what
the checked-in file contains, byte for byte:

```jsonc
{
  "$schema": "https://flatland-ui-hub/assets/ui-configs/ui-config.schema.json",
  "hidden": [
    "control.contrast",
    "control.mapNavigation",
    "control.endShift",
    "widget.proposal-compare.axis.time"
  ],
  "collapsedByDefault": [
    "widget.decision-log"
  ],
  "policyAllowlist": ["deadlock_avoidance", "plan"]
}
```

`widget.proposal-compare.axis.time` ("Zeit im Netz") is hidden; its sibling
`widget.proposal-compare.axis.lateness` ("Verspätung gegenüber Fahrplan") is
simply absent from `"hidden"`, so it keeps rendering — the same rule as every
other id in the file, nothing figure-specific about it.

`"policyAllowlist"` offers exactly two policies: `deadlock_avoidance` ("DLA
(Default)") and `plan` ("Scripted Plan" — the scenario's predetermined,
premade run). This is an illustrative choice, not a confirmed one — **the
exact policy list for Plan B is an open question**, tracked in §6.

Reading this file top to bottom already answers "what's hidden, what's
collapsed by default, which policies may be picked" — the issue's own
legibility bar — without opening any code.

---

## 6. Open questions

**Resolved (2026-10-23):**

- **"Controls" (item 1, third term)** — confirmed to be the whole map pan/zoom
  control overlay (`.map-nav-overlay` + `.map-zoom-overlay`), hidden together
  with the contrast setting. One id, `control.mapNavigation` (§4.3-§4.4).
- **Scope of "disabled"** — dropped from v1; no id needs it (§2).
- **Item 3's panel** — identified as `proposal-compare` ("Plan / KI / Mensch"),
  its `pc-compare` comparison section, currently showing two figures: delay
  vs. timetable (`lateness`) and time in network (`time`) (§1, §4.3b).
- **Item 5's actual shape** (2026-10-24) — not a hide toggle on the control,
  but a whitelist of which policies it offers; `"policyAllowlist": []`
  produces the same visible outcome ("hide") as a side effect (§4.3c).

**Still open — not blocking this plan:**

1. **Which figures the comparison section should show long-term**, and what
   they mean to a reader (confirmed 2026-10-23: genuinely unresolved, not yet
   answerable) — the plan ships a concrete *example* answer for now (hide
   `time`, keep `lateness`, §5) as a config choice rather than a code change,
   so flipping it later needs no redeploy. Needs its own clarification and, if
   more figures turn out to be needed, its own design work (§4.3b only covers
   hide/show of the two figures that exist today).
2. **The exact `policyAllowlist` for Plan B.** §5 ships `["deadlock_avoidance",
   "plan"]` as an illustrative example, not a confirmed answer — whether these
   are the right two (or the only two), and whether Plan B's scenario even
   enables `plan` in the first place (§4.3c), both need confirming before the
   study launches with this file.

## 7. Implementation checklist

New vs. modified for every file below: §4.7.

- [ ] *(new)* `core/config/ui-config-items.ts` — the id registry (generated
      widget ids + hand-declared control ids + the two comparison-axis ids,
      §4.3b).
- [ ] *(new)* `core/config/ui-config.service.ts` — load/hold/query the config
      (`isHidden`, `isCollapsedByDefault`, `policyAllowlist`).
- [ ] *(new)* `frontend/public/ui-config.schema.json` + a drift test against
      the registry.
- [ ] *(modified)* `app.config.ts` — read the `uiConfig` query param in the
      existing `provideAppInitializer`; needs `ui-config.service.ts` to exist.
- [ ] *(modified)* `panel-mode-availability.ts` — add `isPanelAvailable()`
      alongside the existing, untouched `isPanelAvailableInMode()`.
- [ ] *(modified)* `app.component.ts` — `panelAvailable()`'s body calls the
      new `isPanelAvailable()`; needs the bullet above.
- [ ] *(modified)* `app.component.html` — guard the Colours tab button + its
      content block with `!uiConfig.isHidden('control.contrast')`.
- [ ] *(modified)* `decision-log-panel.component.ts` — seed `collapsed` from
      `uiConfig.isCollapsedByDefault('widget.decision-log')`.
- [ ] *(modified)* `flatland-map.component.html` — guard `.map-nav-overlay`
      and `.map-zoom-overlay` with `!uiConfig.isHidden('control.mapNavigation')`.
- [ ] *(modified)* `director-directive.component.html` and
      `tour-guide.component.html` — guard each end-shift button with
      `!uiConfig.isHidden('control.endShift')`.
- [ ] *(modified)* `toolbar.component.ts` — add the `policyAllowlist` filter
      step to `selectablePolicies()` (§4.3c) — no template change needed.
- [ ] *(modified)* `proposal-compare.component.ts` — filter `comparison()`'s
      axes against `uiConfig.isHidden('widget.proposal-compare.axis.…')`.
- [ ] *(modified)* `panel-plugin-host.component.ts` and
      `layout-designer.component.ts` — same `isPanelAvailable()` check as
      `app.component.ts`, so a config-hidden widget can't be reintroduced via
      a saved design or picked from the palette; needs `isPanelAvailable()`
      to exist first.
- [ ] *(already committed, ahead of the rest of this plan)*
      `frontend/public/assets/ui-configs/plan-b-ui-config.json` — the real
      Plan B study config, exactly as given in §5.
- [ ] Manual smoke test against the real file, once every gate point above is
      wired: `?uiConfig=assets/ui-configs/plan-b-ui-config.json`.
- [ ] Tests: `ui-config.service.spec.ts` loads `plan-b-ui-config.json` itself
      (not a synthetic fixture) for its success-path assertions, plus
      separate load-failure/unknown-id fallback cases; one assertion per gated
      template that the item disappears under its id.
