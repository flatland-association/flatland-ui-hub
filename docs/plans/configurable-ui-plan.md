# Configurable UI — declaring which UI items a deployment or a study hides (issue #145)

> **Status: implemented** (§7.1, then the 2026-10-28 revision in §7.2 — all
> but its last item, the per-gate component tests). This plan answers the
> "how" for
> [issue #145](https://github.com/flatland-association/flatland-ui-hub/issues/145)
> ("Configurable UI") and its own first comment, which scopes the first step
> deliberately small: configuration **written by hand and loaded at startup**,
> with no in-app selection UI or export yet ("starten ohne Auswahl / Export im
> UI, ggf. später noch dazunehmen"). Frontend-only; no backend change needed.
>
> The original design delivered the configuration through a `?uiConfig=` query
> parameter. The review of 2026-10-27/28 replaced it with two declaration
> sites — a deployment file and a block on the layout preset a condition runs.
> **Start at §1.1**, which lists all eleven items and says which site each one
> belongs to and why.
>
> **Deferred (2026-10-30), §8:** a hidden stored setting keeps its stored
> value. That is safe only if one machine runs the whole study.

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

### 1.1 Coverage and delivery — the high-level implementation plan

> The review of 2026-10-27/28 replaced the `?uiConfig=` startup parameter with
> the two delivery routes below; §4.1 and §4.8 are rewritten to match, and
> §4.2-§4.7 (file format, id catalog, gate points, validation) carry over.

Two routes feed the same `UiConfigService`, so every gate point reads
`isHidden()` / `isCollapsedByDefault()` / `policyAllowlist()` without knowing
where the value came from:

- **global** — a deployment-wide `ui-config.json`, fetched in the app
  initializer from a fixed path and placed by the deployment
  (`UI_CONFIG=<file> ./start-demo.sh`). Ships empty, so an unconfigured
  deployment behaves exactly as today.
- **preset** — a `ui` block on the `LayoutPreset` a condition runs, applied in
  `setRuntimeLayout()` (`app.component.ts`). That is the one funnel every path
  goes through — a tour pinning its layout, a study condition, and the manual
  picker — so the restrictions follow the selected layout exactly as the layout
  does, and selecting another layout re-applies that one's block or none.

Both are subtractive and they **merge** by one rule, the more restrictive wins:
`hidden` / `collapsedByDefault` union, `policyAllowlist` intersection (`null` =
"no opinion"). Nothing one route hides can be restored by the other.

#### Why "global or preset" is not the same answer for every item

The routes do **not** have the same reach, because they bind at different
times. The global file is applied before the first render; a preset block only
exists from the moment a layout is selected. Verified in the running app on the
welcome screen, before any tour is started:

```json
{ "configShell": true, "toolbar": true,
  "modeTabs": false, "policySelect": false, "statusMessage": false,
  "menu.sections": ["Einrichtung & Konfiguration", "Dieser Durchlauf",
                    "Sprache", "Farben", "Darstellung", "Bereiche"] }
```

and on `/designer`, where no session can exist at all: `{ "configShell": true }`.

So the rule is:

- **global only** — anything on screen *outside* a running condition: the
  welcome screen's header and menu, the dialogs reachable from it, and the
  other full-page surfaces (Layout Designer, galleries, Infrastructure
  Builder). A preset block cannot reach these, because nothing has selected a
  preset yet. For a study this is the difference between a restriction and a
  suggestion: a participant can open the menu before pressing Start.
- **preset only** — anything that must differ *between* conditions. The global
  file applies to every session by definition, so it cannot express "hidden in
  Plan B, shown elsewhere".
- **both** — in-session items that Plan B happens to set the same way
  everywhere. Prefer the preset: the restriction then travels with the
  condition and leaves other sessions alone.

A further column records whether the item is also expressible by the **preset's
own structure** — its columns, panels and per-panel `settings` — without the
config at all.

#### The items

Items 1a-5 are the issue's own list (§1). Items 6-10 were **added on
2026-10-28** from the Plan B study preparation and are not in the issue body.

| # | Item | Where it is in the UI | Config id | Covered by | Preset structure alone? |
|---|---|---|---|---|---|
| 1a | Remove the contrast setting | "Farben" tab of the Session Settings dialog, `app.component.html:719-740` — reachable from the welcome screen's Menü, not only during a run | `control.contrast` | **global** — a preset block would leave it open until Start is pressed | **No** — the dialog is shell chrome, outside every layout |
| 1b | Remove the map pan/zoom control overlay | `.map-nav-overlay` (pan D-pad + reset) and `.map-zoom-overlay` (zoom), `flatland-map.component.html:789-802` | `control.mapNavigation` | both | Yes — `flatland-map` is a panel; reachable via panel `settings` (needs an input + 3 call sites) |
| 2 | Hide the Decision Log, or collapse it by default | `decision-log` panel; the collapse is the component's own signal, `decision-log-panel.component.ts:122` | `widget.decision-log` | both — **and both verbs stay configurable**, see below | Yes for *hide* (omit the panel). Note `expanded: false` is a **different** collapse: it folds the panel shell, while `collapsedByDefault` keeps the header and the live entry count visible |
| 3 | Comparison section: which figures does it show? | `proposal-compare` ("Plan / KI / Mensch"), its `pc-compare` section — two axes, `lateness` ("Verspätung gegenüber Fahrplan") and `time` ("Zeit im Netz"). Plan B hides `time`. | `widget.proposal-compare.axis.time` | both | Yes — `proposal-compare` is a panel; reachable via panel `settings` (needs an input + 1 call site) |
| 4 | "End shift" button isn't needed → remove | `director-directive.component.html:37` and `tour-guide.component.html:48` | `control.endShift` | both | **No** — `director-directive` is director-only (`panel-mode-availability.ts:35`) so it never renders in a Co-Learning condition, and the live button sits in `app-tour-guide` (`app.component.html:129-131`), a sibling of the layout and absent from `WIDGET_CATALOG` |
| 5 | Policy not selectable → hide | the toolbar's `<select class="policy-select">`, narrowed rather than removed; absent until a session exists | `policyAllowlist` | both | **No** — `app-toolbar` is rendered by the shell at `app.component.html:116`, outside `div.runtime-design`. The dormant panel path (`panel-plugin-host.component.html:43`) is unreachable because `runtimeLayoutActive()` (`app.component.ts:1953`) tests five properties that do not exist and always returns `false` — a separate defect, not fixed here |
| 6 | *(added)* **The first of ten** Plan B tours, offered under "Geführtes Experiment", running the Plan B preset | a `Tour` with `door: 'experiments'` (`tours.ts:32-37`) + a `LayoutPreset` registered in `LAYOUT_PRESETS` (`layout-presets.ts:958`) | — | **neither** — this is the carrier that *holds* the `ui` block, not an item it hides | n/a |
| 7 | *(added)* Do not show the top-level Recommendation / Co-Learning (Demo) / Director tabs | the `.mode-tabs` strip, `app.component.html:45-85`, `@for (m of interactionModes)` over `INTERACTION_MODES`; does not render before a session | `control.modeTabs` *(new)* — one id for the strip, like `control.menuAreas` and `control.mapNavigation` | both | **No** — header chrome, outside `div.runtime-design` |
| 8 | *(added)* Which policies appear, which is the **default**, and not showing the dropdown at all (running the default) | the toolbar's `<select class="policy-select">`, fed by `selectablePolicies()` (`toolbar.component.ts:49-56`) | `policyAllowlist` — **no new key**, see below | both — requested as global | **No** — `app-toolbar` is shell-rendered (`app.component.html:116`) |
| 9 | *(added)* Hide the status line "Loaded scenario preset: … · 191 × 9 · 3 trains · running the premade plan" | the session-loaded lines of `store.message()` (`session.store.ts:1678`, `:1689`, `:1753`), rendered at `toolbar.component.html:87` | `control.sessionInfo` *(new)* — **not** the whole message channel, see below | both | **No** — inside the shell toolbar |
| 10 | *(added)* Do not show the "Bereiche" section (Layout Designer, Infrastructure Builder, galleries, Contribute) in the Menü | `config-shell.component.html:48-53`, `@if (areaLinks.length)` over `AREA_LINKS` (`config-shell.component.ts:23-31`) | `control.menuAreas` *(new)* | **global** — the menu is on the welcome screen and on every other surface, where no preset is ever active | **No** — app header, shared by every surface |

#### Notes on individual items

- **1a and 10 are global-only, and that matters for the study.** Both are
  reachable from the welcome screen before Start: the Session Settings dialog
  (hence the contrast radios) and the "Bereiche" links into the Layout
  Designer. Declaring them in the Plan B preset would restrict the run but
  leave the way in open beforehand, so they belong in the deployment file. This
  is the reason the global route is kept rather than deleted with
  `?uiConfig=`.
- **Item 2 keeps both verbs.** `widget.decision-log` is the one id declaring
  `supports: ['hidden', 'collapsedByDefault']` (§4.3), so a condition chooses:

  | Written as | On screen |
  |---|---|
  | `hidden: ['widget.decision-log']`, or the preset omits the panel | gone; the column reflows |
  | `collapsedByDefault: ['widget.decision-log']` (Plan B today) | header and live entry count visible, entries hidden, participant can expand |
  | preset panel with `expanded: false` | folded to the panel title bar; no count |

  A `hidden` id outranks a preset that places the panel anyway (§4.6), so the
  two routes cannot disagree.
- **Item 6 lands as one tour, written as the template for ten** — one per
  participant, across six scenarios that are not part of this PR. All ten name
  the same `layout: 'preset-plan-b'`, which is why the `ui` block sits on the
  preset rather than on the tour: one definition, so the ten runs cannot drift
  apart. The remaining nine are data only — a `Tour` entry plus `name`, German
  `tours.<id>.description` and a briefing each, no mechanism work.
- **Item 8 closes the plan's open policy question** (§6 and the PR review
  thread on item 5) **without a new config key.** All three parts fall out of
  `policyAllowlist` plus machinery that already exists:
  - *Which policies appear* — the existing filter in `selectablePolicies()`
    (§4.3c).
  - *Which is the default* — `SessionStore.defaultPolicy()`
    (`session.store.ts:479-483`) already resolves the backend's `is_default`
    flag with a first-policy fallback, and `_activePolicy` is seeded from it
    (`:504-508`). The only change: when the allowlist excludes that seed,
    re-seed from the first allowed policy.
  - *Not showing the dropdown* — a **one-entry** allowlist, with the existing
    `@if (selectablePolicies().length > 0)` (`toolbar.component.html:48`)
    relaxed to `> 1`. One entry means nothing to choose, so the control
    disappears and that entry is what runs. This is why the earlier draft's
    `policyDefault` key is dropped: the empty-list route was the only thing
    that left "what is the session running?" unanswered.

  An in-app control already exists for the *which* part (the "Szenarien /
  Policy" dialog, `app.component.html:940-975`), but it cannot go to zero
  (`[disabled]` once one policy is left) and is not persisted
  (`app.component.ts:1254-1255` resets it on every load).
- **Item 9 is scoped to the session-loaded lines, not the whole message
  channel.** `store.message()` is shared: it also carries "Episode finished.
  Use Reset to start again." (`session.store.ts:1397`, `:1788`), "Episode
  finished. Use Reset before Play." (`:1934`) and backend-supplied text
  (`:1810`). Hiding the rendered line would suppress run-state feedback the
  participant needs. `control.sessionInfo` therefore gates the three
  session-loaded `message.set(...)` calls (`:1678`, `:1689`, `:1753`) at the
  source, setting `null` — the value those sites already use elsewhere
  (`:1639`, `:1858`, `:1899`) — so no template change and no new "message
  kind" concept.

  Separately: those strings are hardcoded English in the store, against the
  no-inline-user-facing-text rule — a German session shows English today.
  Hiding them conceals that rather than fixing it; the i18n defect should get
  its own issue.
- **Item 10 complements a gate that already exists.** The Layout Designer is
  how a participant could undo the condition's layout; its palette already
  filters config-hidden widgets (`layout-designer.component.ts:173`, d17d910),
  and removing the menu entry closes the route in. `ConfigShellComponent`
  already has a `skipAreas` input, the natural seam for the new id.

#### Where Plan B declares what

| Route | Items | Why |
|---|---|---|
| deployment `ui-config.json` | 1a, 10 | on screen before a preset exists |
| Plan B preset `ui` block | 1b, 2, 3, 4, 5/8, 7, 9 | in-session, scoped to the condition |
| neither (data) | 6 | the tour and preset themselves |

Cost: three new ids (`control.modeTabs`, `control.sessionInfo`,
`control.menuAreas`) in `UI_CONFIG_ITEMS` (§4.3) and the schema enum, no new
config keys, and five new gate points in the same style as the
existing eleven. Item 6 is data, not mechanism.

---

## 2. Goal

Hand-written configuration, loaded at startup, that declares by a stable id
which UI items are **hidden** (not rendered at all) or **collapsed by default**
(rendered, but starts closed) — so a deployment or a study condition can offer
a restricted view (a public demo, an onboarding profile, a participant run)
without a code change per audience. §4.1 gives it two declaration sites, a
deployment-wide JSON file and a block on the layout preset a condition runs;
§1.1 says which items belong to which.

No item needs a third, "visible but non-interactive" (disabled) state: the one
candidate for it (the policy selector) turned out to need a content filter
instead (§4.3c), not a disabled-but-visible control — see §6. `hidden` and
`collapsedByDefault` cover every id-based item; a "disabled" state can still be
added later if a real need for it turns up.

**The issue's own config ships as real, checked-in configuration, not just a
doc example.** The issue carries the `plan b` label ("user studies FHNW &
SBB") — this is a real study condition, not a hypothetical. §5 encodes every
item in §1.1's table and both halves are committed: the deployment file
(`frontend/public/ui-config.json`) and the `ui` block on the Plan B preset in
`core/layout/layout-presets.ts`. What the tests exercise and what the study
runs are therefore the same declarations, not two files that quietly diverge.

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
  autocomplete, and a bad id in the deployment file is flagged before it is
  ever loaded. A preset's `ui` block is ordinary TypeScript reviewed in a PR,
  and both routes run through the same `resolveIds()` check at apply time
  (§4.5).

## 3. Non-goals (v1)

- No in-app config builder or export (per the issue comment — later step).
- No per-session runtime toggle UI for these items: someone running a
  restricted deployment or a study condition cannot turn a hidden item back on
  from inside the app. That is the point — this is configuration declared
  ahead of the run, not a user *preference*.
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

### 4.1 Delivery — a deployment file and a preset block

> Rewritten 2026-10-28. The original design read a `?uiConfig=` query
> parameter; see §1.1 for why it was dropped. The file format (§4.2), the id
> catalog (§4.3) and every gate point (§4.4) are unchanged.

**Route 1 — the deployment file.** Fetched once in the existing
`provideAppInitializer`, from a fixed path, before the first render, so a
hidden item never flashes on screen:

```ts
// app.config.ts
provideAppInitializer(() => {
  ...
  const uiConfig = inject(UiConfigService);
  return Promise.all([i18nReady, uiConfig.load('ui-config.json')]);
}),
```

No query parameter, no per-deployment code: the deployment decides by
**placing the file**. `angular.json`'s `assets: [{"input": "public"}]` copies
everything under `frontend/public/` flat into the build output, so
`public/ui-config.json` ships as `/ui-config.json`, and a deployment overwrites
it after staging:

```bash
# start-demo.sh, after `cp -R "$DIST/." "$BACKEND/static/"`
[ -n "${UI_CONFIG:-}" ] && cp "$UI_CONFIG" "$BACKEND/static/ui-config.json"
```

```bash
UI_CONFIG=path/to/plan-b.json ./start-demo.sh
```

An environment variable rather than a flag: the script's arguments are
positional (`PORT MODE REBUILD`), so a fourth would have to sit behind the
existing `"" --rebuild` slot.

Switching condition is one `cp` and a restart — no rebuild. Two consequences
worth stating, because both have bitten:

- **Ship `public/ui-config.json` containing `{}`.** The backend's SPA catch-all
  (`backend/app/main.py:46-54`) returns `index.html` for any path that is not
  an existing file, so a *missing* config arrives as **HTML with status 200**,
  not a 404 — `HttpClient` would then fail parsing and warn on every start of
  every unconfigured deployment. An always-present empty file makes the normal
  case silent and keeps "nothing hidden" the default.
- **Build-time baking was considered and rejected.** `fileReplacements` or the
  builder's `define` in a per-condition `angular.json` configuration would need
  a separate build per condition (minutes, and `start-demo.sh --rebuild`), and
  CI's single `ng build --configuration production` gate would no longer cover
  what ships. Its only advantage — the config cannot be swapped on a running
  server — is weak, since anyone who can replace `backend/static/ui-config.json`
  can replace the bundle beside it.

**Route 2 — the preset block.** A `ui` field on `LayoutPreset`, applied when
the layout is selected and cleared when the run ends:

```ts
// layout-presets.ts
export interface LayoutPreset {
  id: string; name: string; purpose: string;
  layout: { columns: LayoutPresetColumn[] };
  /** Items this condition removes, on top of whatever the layout places. */
  ui?: UiConfig;
}
```

`UiConfig` is not a new type: it is the interface `ui-config.service.ts`
already declares for the parsed file (`hidden?`, `collapsedByDefault?`,
`policyAllowlist?`), exported and renamed from `UiConfigFile` because it is no
longer only a file. One declaration, both routes.

```ts
// app.component.ts — startTour() / setRuntimeLayout(), beside the existing
// this.setRuntimeLayout(...) call at :633
this.uiConfig.apply(presetById(id)?.ui ?? {});
// and in leaveExperiment(), so a condition does not leak into the next run
this.uiConfig.apply({});
```

The service keeps its shape and gains one public method. `apply()` is the
single entry point — validation (§4.5) and merging happen there — and `load()`
becomes a thin fetch in front of it, so there is one code path rather than two
that can drift:

```ts
apply(config: UiConfig): void { /* validate ids, merge over the baseline */ }
async load(url: string): Promise<void> { this.apply(await this.fetch(url)); }
```

Ids stay plain `string`, validated by the existing `resolveIds()` warning path
(§4.5) for both routes. A compile-time `UiConfigId` union was considered for
preset blocks and dropped: its only benefit duplicates a check that already
exists, at the cost of a second source of truth to keep in step with
`UI_CONFIG_ITEMS`.

**Merge rule — one rule: the more restrictive wins.** For the two id arrays
that is the union, for `policyAllowlist` the intersection (`null` = "no
opinion", so one source alone decides). Nothing one route hides can be restored
by the other, whichever route declared it.

**Which route for which item** is not a free choice: a preset block does not
exist until a layout is selected, so anything on screen before that (the
welcome screen's header and menu, the dialogs opened from it, the other
full-page surfaces) can only be restricted globally. §1.1 works this through
per item and records the split for Plan B.

### 4.2 File format

The same three optional keys whether the config arrives as the deployment
file or as a preset's `ui` block (§4.1) — the deployment file adds `$schema`,
which an editor uses and the app ignores:

```jsonc
{
  "$schema": "/ui-config.schema.json",
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

Three keys, no more: two id-keyed arrays and one allowlist. Both arrays are
opt-out — everything not named in `"hidden"` stays visible, everything not
named in `"collapsedByDefault"` starts open — the same rule for every id in the
catalog, no exceptions and no per-id defaults to look up. `"policyAllowlist"`
is not id-keyed; it's a separate, narrower, **optional** mechanism for one
specific control (absent → every policy the session enabled stays offered,
i.e. today's behaviour) — see §4.3c for why it doesn't fit the
`hidden`/`collapsedByDefault` model, and why it needs no companion
"default policy" key.

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

**Hiding the control, and what then runs.** A **one-entry** allowlist means
there is nothing to choose, so the control should disappear and that one policy
should run. Both follow from machinery that exists:

- Relax the existing `@if (selectablePolicies().length > 0)`
  (`toolbar.component.html:48`) to `> 1`. One allowed policy renders no
  dropdown; two or more render it as today.
- `SessionStore.defaultPolicy()` (`session.store.ts:479-483`) already resolves
  the backend's `is_default` flag with a first-policy fallback, and
  `_activePolicy` is seeded from it (`:504-508`). The only addition: when the
  allowlist excludes that seed, re-seed from the first allowed policy.

So "which policies", "which is the default" and "don't show the selector" are
one key and one existing default-resolution path — **no `policyDefault`
companion key**. An earlier draft of this plan added one; it was needed only
because the *empty*-list route left "what is the session running?" unanswered.
An empty list still works and still collapses the control, but a one-entry list
is the form to write, because it names what runs.

An unknown policy id in the list is ignored with a console warning (§4.5), same
as an unknown catalog id.

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
- **Mode tabs** (§1.1 item 7). Guard the `.mode-tabs` strip
  (`app.component.html:45-85`) with `@if (!uiConfig.isHidden('control.modeTabs'))`
  — one id for the whole strip, the same grain as `control.mapNavigation`
  (two markup blocks) and `control.menuAreas`.
- **Session info line** (§1.1 item 9). Not a template guard: the three
  session-loaded `message.set(...)` calls (`session.store.ts:1678`, `:1689`,
  `:1753`) set `null` instead when
  `uiConfig.isHidden('control.sessionInfo')`. `null` is the value those sites
  already use elsewhere (`:1639`, `:1858`, `:1899`), so
  `toolbar.component.html:87` needs no change and the channel's run-state
  messages ("Episode finished…") keep working.
- **Menü "Bereiche"** (§1.1 item 10). Guard the block at
  `config-shell.component.html:48-53` with
  `!uiConfig.isHidden('control.menuAreas')`; `ConfigShellComponent`'s existing
  `skipAreas` input is the seam.

### 4.5 Validation and fail-safe behaviour

- **Fetch/parse failure** (404, malformed JSON): log a console warning, proceed
  with nothing hidden — a broken config must never block the app from loading.
- **Unknown id**: warn and ignore that one id, keep the rest of the file in
  effect (forward/backward compatible with a typo or a renamed widget type).
- **Id used with an unsupported verb** (e.g. `control.endShift`, a button,
  under `collapsedByDefault`): warn and ignore.
- A hand-maintained `ui-config.schema.json` (served from `frontend/public/`,
  referenced via the deployment file's own `$schema`) gives editor-time
  validation before any of the above run-time fallbacks are needed. A unit test
  (`ui-config-items.spec.ts`) keeps the schema's id `enum` and the
  `UI_CONFIG_ITEMS` registry from drifting apart.
- **Both routes validate identically.** `apply()` is the single entry point
  (§4.1), so a preset's `ui` block runs through the same `resolveIds()` checks
  as the fetched file — ids stay plain `string`, and a stale id in a preset
  warns and is ignored rather than failing the build. Only the fetch/parse
  failure above is specific to the deployment file.

### 4.6 Composes with, doesn't replace

- **Per-mode availability** (`panel-mode-availability.ts`) is untouched;
  config hiding is a second, independent gate. A widget hidden by mode in
  Director but shown in Recommendation is unaffected by a config that hides it
  everywhere, and vice versa.
- **Saved layouts** (`localStorage`, via the Layout Designer): a saved design
  naming a config-hidden widget type simply renders nothing for that panel slot
  (same "known gap, inherited" bypass pattern the presets file already
  documents for mode availability — not a new one).
- **A `LayoutPreset` wears two hats, and they do not collide.** As a *layout*
  it is in the same category as a saved design: the bullet above applies, so a
  preset placing a hidden widget renders nothing there. As a *config carrier*
  (§4.1) its `ui` block is one of the two inputs to `UiConfigService`, merged
  by "the more restrictive wins". The two never contradict each other, because
  a preset cannot un-hide: `ui` only subtracts, and the layout half is subject
  to whatever the merged config says — including its own block.

### 4.7 Added vs. modified — the complete file list

> This table describes the **shipped** implementation (§7.1), including the
> `app.config.ts` query-param step and `plan-b-ui-config.json`, both of which
> the 2026-10-28 revision changes. The files the revision adds, modifies and
> deletes are listed in §7.2; every gate point below survives it unchanged.

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

### 4.8 Considered, rejected, then partly adopted: `LayoutPreset`

> Rewritten 2026-10-28. This section previously recorded the `LayoutPreset`
> route as rejected outright. Review showed two of its four arguments were
> wrong, and the design in §1.1/§4.1 adopts the preset as one of two delivery
> routes. The history is kept because the two surviving arguments are the
> reason `UiConfigService` was not dissolved into `LayoutPreset` entirely.

**What was wrong in the original rejection:**

- *"Three of the five issue items aren't panels at all."* Too strong. The map
  overlay and the comparison axis sit **inside** panels the layout places, and
  `LayoutPresetPanel.settings` is an existing channel for exactly this grain —
  already used by this repo (`layout-presets.ts:635` `{tabs, minBodyHeight}`,
  read in `panel-plugin-host.component.html:104`, `:212`,
  `.component.ts:96`). What is genuinely out of reach is app-shell chrome, not
  "three of five": see the table in §1.1.
- *"Presets are picked manually, never auto-applied."* False. A tour pins its
  layout (`tours.ts:44` `layout: 'system' | string`, applied in `startTour()`
  at `app.component.ts:633`), a `StudyCondition` pins `layoutId`
  (`study-conditions.ts:39-44`, applied at `:971`), and both are already
  URL-addressable through `applyWelcomeDeepLink()` (`:802`) as
  `#/tour/<id>[/start]` and `#/experiment/<layoutId>[/<scenarioId>]`. The
  manual dropdown (`loadRuntimeLayoutOptions()`, `:1681`) is one of three entry
  points, and not the one a study uses. `layout-presets.ts`'s own header
  repeats the same mistaken claim and should be corrected with this change.

**What still holds, and is why the service stays:**

- **A preset replaces the layout; the config subtracts from one.** The
  hardcoded default (`three-col`) is deliberately not in `LAYOUT_PRESETS`,
  because only it carries the per-mode right column, the reflection slot and
  the Director surfaces. A restriction that needed a preset would force every
  layout a study might use to be forked and re-forked.
- **Shell chrome has no layout to live in.** The Session Settings dialog
  (`app.component.html:719-740`), `app-tour-guide` (`:129-131`), `app-toolbar`
  (`:116`) and the `config-shell` menu are siblings of `div.runtime-design`,
  not cells in it; `tour-guide` is not even in `WIDGET_CATALOG`. Items 1a, 4,
  5, 7, 8, 9 and 10 are only reachable through a service that sits above
  layouts.
- **Per-panel `settings` would scatter what the issue wants legible.** Reading
  "what is hidden" would mean walking a column/row tree instead of scanning two
  short arrays (§2). The adopted design keeps the flat arrays and only changes
  *where they are declared* — `ui?: UiConfig` is a sibling of `layout`,
  not something woven into it.

**The adopted split.** `LayoutPreset` stays a full positional layout and gains
one optional, flat `ui` block; `UiConfigService` stays the single reader for
every gate point. They compose rather than merge: the preset supplies the
arrangement *and* declares the condition's restrictions, the deployment file
covers what exists before any preset does. The one thing neither does is
per-participant variation — that is what the ten Plan B tours are for (§1.1,
item 6).

---

## 5. Plan B, encoded — where each restriction is declared

> Rewritten 2026-10-28. This section previously described one checked-in file,
> `frontend/public/assets/ui-configs/plan-b-ui-config.json`, loaded by
> `?uiConfig=`. Under §4.1 the restrictions are split across two declaration
> sites, and that file is **deleted**: keeping it alongside the preset block
> would mean two sources of truth for one condition, with nothing keeping them
> in step.

### 5.1 The deployment file — what exists before a preset does

`frontend/public/ui-config.json` is the one the app loads, and it ships empty
so an ordinary deployment hides nothing. The Plan B variant is checked in
beside it at `frontend/public/ui-configs/plan-b.json`, and an installation
points at it with `UI_CONFIG=frontend/public/ui-configs/plan-b.json
./start-demo.sh`. It carries the two items a preset cannot reach (§1.1):

```jsonc
{
  "$schema": "/ui-config.schema.json",
  "hidden": [
    "control.contrast",   // Session Settings → "Farben", openable from the welcome screen
    "control.menuAreas"   // Menü → "Bereiche" → Layout Designer, galleries, Contribute
  ]
}
```

Both are reachable before Start is pressed and on the other full-page surfaces,
so declaring them in the preset would restrict the run while leaving the way in
open beforehand.

### 5.2 The preset block — the condition itself

Declared on the Plan B `LayoutPreset`, which all ten participant tours name:

```ts
const PLAN_B_UI: UiConfig = {
  hidden: [
    'control.mapNavigation',                   // item 1b — pan/zoom overlay
    'control.endShift',                        // item 4  — "Schicht beenden"
    'widget.proposal-compare.axis.time',       // item 3  — "Zeit im Netz"
    'control.sessionInfo',                     // item 9  — "Loaded scenario preset: …"
    'control.modeTabs',                        // item 7  — the whole tab strip
  ],
  collapsedByDefault: ['widget.decision-log'], // item 2
  policyAllowlist: ['deadlock_avoidance'],          // items 5 + 8
};
```

The participant runs are experiment conditions (`STUDY_CONDITIONS`), not
tours, since #131: see [experiment-workflow.md](experiment-workflow.md) §7.4.

`widget.proposal-compare.axis.lateness` ("Verspätung gegenüber Fahrplan") is
simply absent from `hidden`, so it keeps rendering — the same rule as every
other id, nothing figure-specific about it.

`policyAllowlist` names exactly one policy, which is how issue item 5
("Policy not selectable") is met: with nothing to pick the dropdown does not
render, and that one policy is what the session runs (§4.3c). It is
`deadlock_avoidance` because that is the backend's own default (`is_default`)
— what these runs would have used anyway — whereas `plan` ("Scripted Plan") is
`show_in_ui: false` and only available on a scenario that ships a premade
timetable. **Which policy the study should run is still open** (§6); changing
it is one word in `PLAN_B_UI`. No separate "default" key either way: if the
allowlist excludes the backend's `is_default`, the first allowed policy is
seeded instead.

Item 2 is written as `collapsedByDefault`, not `hidden`: the participant keeps
seeing the panel header and its live entry count — "your decisions are being
recorded" — without a readback to reason from. §1.1 lists the three reachable
outcomes and how to switch between them.

### 5.3 Legibility

Both declarations are the same three keys and flat arrays of ids, read top to
bottom, and both are reviewed in a PR rather than living in one browser's
`localStorage`. They validate the same way too — `apply()` runs `resolveIds()`
over either (§4.5) — so there is one place to look up what an id means. The
schema (§4.3) adds editor-time checking for the deployment file, which is
hand-authored JSON; a preset block gets the same check when it is applied.

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
2. **Which policy Plan B should run.** §5.2 ships
   `["deadlock_avoidance"]` — one entry, so the selector is gone as item 5
   asks, and the backend's own default is what runs. Whether that is the right
   policy for the study, rather than the scenario's premade `plan`, needs
   confirming before the study runs; it is one word in `PLAN_B_UI`.

   **Resolved as part of this (2026-10-28):** "which policy runs when the
   selector is hidden", the question raised in the PR review of item 5, needs
   no new configuration. A one-entry allowlist hides the control and names what
   runs, and `SessionStore.defaultPolicy()` (`session.store.ts:479-483`)
   already resolves the backend's `is_default` otherwise (§4.3c). What is still
   open is only *which* policies to list.

## 7. Implementation checklist

New vs. modified for every file below: §4.7.

### 7.1 Shipped — the `?uiConfig=` implementation

Implemented in this order, one commit per item (`git log` on this branch).
Every gate point below survives the migration in §7.2 unchanged; only the way
the config reaches `UiConfigService` changes.

- [x] *(new)* `core/config/ui-config-items.ts` — the id registry (generated
      widget ids + hand-declared control ids + the two comparison-axis ids,
      §4.3b).
- [x] *(new)* `core/config/ui-config.service.ts` — load/hold/query the config
      (`isHidden`, `isCollapsedByDefault`, `policyAllowlist`).
- [x] *(new)* `frontend/public/ui-config.schema.json` + a drift test against
      the registry (`ui-config-items.spec.ts`).
- [x] *(modified)* `app.config.ts` — read the `uiConfig` query param in the
      existing `provideAppInitializer`; needs `ui-config.service.ts` to exist.
- [x] *(modified)* `panel-mode-availability.ts` — add `isPanelAvailable()`
      alongside the existing, untouched `isPanelAvailableInMode()`.
- [x] *(modified)* `app.component.ts` — `panelAvailable()`'s body calls the
      new `isPanelAvailable()`; needs the bullet above.
- [x] *(modified)* `app.component.html` — guard the Colours tab button + its
      content block with `!uiConfig.isHidden('control.contrast')`.
- [x] *(modified)* `decision-log-panel.component.ts` — seed `collapsed` from
      `uiConfig.isCollapsedByDefault('widget.decision-log')`.
- [x] *(modified)* `flatland-map.component.html` — guard `.map-nav-overlay`
      and `.map-zoom-overlay` with `!uiConfig.isHidden('control.mapNavigation')`.
- [x] *(modified)* `director-directive.component.html` and
      `tour-guide.component.html` — guard each end-shift button with
      `!uiConfig.isHidden('control.endShift')`.
- [x] *(modified)* `toolbar.component.ts` — add the `policyAllowlist` filter
      step to `selectablePolicies()` (§4.3c) — no template change needed.
- [x] *(modified)* `proposal-compare.component.ts` — filter `comparison()`'s
      axes against `uiConfig.isHidden('widget.proposal-compare.axis.…')`.
- [x] *(modified)* `panel-plugin-host.component.ts` and
      `layout-designer.component.ts` — gated on `uiConfig.isHidden('widget.…')`
      directly, **not** the combined `isPanelAvailable()` this bullet
      originally named: neither surface checks interaction mode today (no
      existing gate at all), so wiring in `isPanelAvailable()` would have
      silently added mode-restriction enforcement for saved layouts that
      doesn't exist yet — see the commit message for the full reasoning.
- [x] *(already committed, ahead of the rest of this plan)*
      `frontend/public/assets/ui-configs/plan-b-ui-config.json` — the real
      Plan B study config, exactly as given in §5.
- [x] Manual smoke test against the real file:
      `?uiConfig=assets/ui-configs/plan-b-ui-config.json` against `ng serve`
      + a live backend, driven headlessly. Confirmed live: the config loads
      with no console warnings, and `.map-nav-overlay`/`.map-zoom-overlay`
      are absent from the DOM while the unrelated `.map-opacity-overlay`
      still renders. The remaining gates (Colours tab, end-shift, Decision
      Log's default-collapsed state, the comparison axes, the policy
      allowlist) were not individually driven by hand in the browser in this
      pass — they're covered by the unit tests below plus direct code
      reading, not by an interactive click-through.
- [x] Tests: `ui-config.service.spec.ts` loads the real
      `plan-b-ui-config.json` over HTTP (served from `public/` by the Karma
      test runner, the same asset path production uses) rather than a
      synthetic fixture or a cross-directory TS import, for its success-path
      assertions, plus `HttpTestingController` cases for a failed fetch, an
      unknown id and an id used with an unsupported verb.
      `ui-config-items.spec.ts` is the schema/registry drift guard (§4.5).
      No per-component spec was added for the individual template gates
      (`app.component.html`, `flatland-map`, `director-directive`,
      `tour-guide`, `proposal-compare`, `panel-plugin-host`,
      `layout-designer`) — most of these components have no existing spec
      file to extend, and adding fresh TestBed scaffolding for each was out
      of scope for this pass. Flagged here rather than silently skipped.

### 7.2 Migration to the two delivery routes (§4.1) and the added requirements (§1.1)

Done except the last item, one commit per item in this order — the first
three are the mechanism, then delivery, then the new gates and the study data.

- [x] *(modified)* `core/config/ui-config.service.ts` — make `apply(config)`
      the single entry point (validate via the existing `resolveIds()`, then
      merge by "the more restrictive wins": union for the two id arrays,
      intersection for `policyAllowlist`), and reduce `load(url)` to a fetch in
      front of it. Export the existing `UiConfigFile` interface as `UiConfig`
      so the preset block and the deployment file share one type.
- [x] *(modified)* `core/config/ui-config-items.ts` — three new ids:
      `control.modeTabs`, `control.sessionInfo`, `control.menuAreas`. No new
      type: ids stay `string`, checked by `resolveIds()`.
- [x] *(new)* `frontend/public/ui-config.json` containing `{}`, plus
      *(modified)* `frontend/public/ui-config.schema.json` — the three new ids
      in the `hidden` enum. The drift test (`ui-config-items.spec.ts`) covers
      it without change.
- [x] *(modified)* `app.config.ts` — replace the `uiConfig` query-param read
      with the unconditional `uiConfig.load('ui-config.json')`.
- [x] *(modified)* `start-demo.sh` — read a `UI_CONFIG` environment variable
      and copy that file over `backend/static/ui-config.json` after staging.
      An env var rather than a fourth positional argument, which would sit
      behind the script's existing `"" --rebuild` slot.
- [x] *(modified)* `core/layout/layout-presets.ts` — `ui?: UiConfig` on
      `LayoutPreset`, and correct the header comment that still claims presets
      are never auto-applied (§4.8).
      *(modified)* `app.component.ts` — `uiConfig.apply()` beside
      `setRuntimeLayout()` in `startTour()` (`:633`) and the study-condition
      path (`:971`), and a reset in `leaveExperiment()` so a condition does not
      leak into the next run.
- [x] *(modified)* `app.component.html` — guard the whole `.mode-tabs` strip
      (`:45-85`) with `!uiConfig.isHidden('control.modeTabs')` (item 7).
- [x] *(modified)* `session.store.ts` — the three session-loaded
      `message.set(...)` calls (`:1678`, `:1689`, `:1753`) set `null` when
      `control.sessionInfo` is hidden (item 9). Gated at the source, not in
      `toolbar.component.html`, so the channel's run-state messages
      ("Episode finished…", `:1397`, `:1788`, `:1934`) keep working.
- [x] *(modified)* `config-shell.component.html` — guard the "Bereiche" block
      at `:48-53` with `!uiConfig.isHidden('control.menuAreas')`; the existing
      `skipAreas` input is the natural seam (item 10).
- [x] *(modified)* `toolbar.component.html` — relax
      `@if (selectablePolicies().length > 0)` (`:48`) to `> 1`, so a one-entry
      allowlist hides the control; *(modified)* `session.store.ts:504-508` —
      when the allowlist excludes the seeded policy, re-seed from the first
      allowed one (item 8, §4.3c). No new config key.
- [x] *(new)* the Plan B `LayoutPreset` with its `ui` block (§5.2), registered
      in `LAYOUT_PRESETS`; *(new)* the first Plan B `Tour` with
      `door: 'experiments'`, its briefing and its German
      `tours.<id>.description` (item 6).
- [x] *(deleted)* `frontend/public/assets/ui-configs/plan-b-ui-config.json` —
      its contents move to §5.1/§5.2. *(modified)*
      `ui-config.service.spec.ts` — repoint the HTTP success-path test at the
      shipped `ui-config.json`, and add `apply()` + merge cases.
- [x] *(modified)* `README.md` — replace the `?uiConfig=` section (URLs, the
      relative-vs-absolute note, the "when it is lost" table) with the two
      routes.
- [x] Keep the `pathname + search` spelling in `app.component.ts:863` and
      `:1318` (the `<base href>` trap), but rewrite both comments: they cite
      `?uiConfig=`, which no longer exists. The fix stays as a latent-bug
      guard for the next query parameter anyone adds.
- [x] Tests for the gates, outstanding from §7.1. With the config applied
      in-process, each gate is a two-line arrangement against the component's
      own fixture, which removed the TestBed-scaffolding objection: new specs
      for `panel-mode-availability` (the two gates compose, neither changes
      the other), `config-shell` (the Areas section, and that `skipAreas`
      still works alone), `toolbar` (the allowlist narrows but never adds; the
      selector goes at exactly one allowed policy), `decision-log-panel`
      (collapsed keeps the header and count, and is a default not a lock) and
      `tour-guide` (the end-shift button a Co-Learning condition actually
      renders), plus the same id asserted on `director-directive`'s own copy.
      Not unit-tested, covered end-to-end in the browser instead: the map
      overlay and the comparison axis, whose components are canvas- and
      session-heavy to stand up.

**Verified end to end** against a running server (production build, backend
serving `backend/static`), Plan B tour vs. the default tour as a control:

| | default tour | Plan B tour |
|---|---|---|
| map pan / zoom overlays | present | **gone** (the ungated opacity control still renders) |
| interaction mode tabs | present | **gone** |
| end-shift button (tour strip) | present | **gone** |
| scenario status line | "Loaded infrastructure scene: …" | **empty** |
| policy dropdown | 6 options | **gone** (one allowed policy, nothing left to pick) |
| Decision Log | panel open | panel present, **content collapsed** |
| comparison axes | "Verspätung gegenüber Fahrplan", "Zeit im Netz" | **only "Verspätung gegenüber Fahrplan"** |

and with `UI_CONFIG=frontend/public/ui-configs/plan-b.json` also on the
welcome screen, before any run: the menu's "Bereiche" section and its six
links are gone, and the Session Settings dialog offers only "Allgemein" and
"Erweitert". No `[uiConfig]` console warnings in any run.

The nine before/after pairs behind that table are in
[`configurable-ui-plan/`](configurable-ui-plan/), named `<n>-<surface>-` plus
`ohne-config` for the default deployment and `mit-plan-b` for the Plan B tour.

**Deferred to deployment, deliberately not built here:**

- **No `start-demo-plan-b.sh` wrapper.** It would be a third place encoding
  one condition — after the preset's `ui` block (seven items) and the
  deployment file (items 1a and 10) — while containing neither, only a path.
  It would also misdescribe the scope: the participant-facing unit is the
  *tour*, and there are ten of them over six scenarios, so a single "start
  Plan B" script implies one baked-in condition when the operator flow is one
  server plus ten `#/tour/<participant-n>/start` links.

  The two answers that fit the design instead, when a study install is set up:
  place the Plan B file once at deploy time, so plain `./start-demo.sh` *is*
  the restricted server and `UI_CONFIG=` is only the way back; and hand the
  facilitator the ten tour links rather than commands. If the env var still
  turns out to be friction after that, a two-line wrapper can be added then —
  against a config that exists.

**Filed separately, not part of this plan:**

- `runtimeLayoutActive()` (`app.component.ts:1953`) tests five properties that
  do not exist on the component and always returns `false`, so the shell
  toolbar renders under every preset and the panel path at
  `panel-plugin-host.component.html:43` is unreachable. Repairing it would
  remove the toolbar from all twelve existing presets, none of which places
  one.
- The session status messages are built as hardcoded English in
  `session.store.ts:1686-1694` (`Loaded scenario preset: …`, `Loaded
  infrastructure scene: …`, `Creating session from …`), against the
  no-inline-user-facing-text rule — a German session shows English today.
  Item 9 hides the line; it does not fix the defect.

## 8. Deferred: hidden stored settings keep their stored value

> [!CAUTION]
> **This assumes one machine for the whole study.** It is part of the
> experiment setup, not enforced in code. A hidden stored setting keeps what
> the browser has stored, so another machine, or the same one used with a
> different config between sessions, can run Plan B with other colours.
> Before the first participant, check the colours on the study machine or
> clear its `localStorage`.

**The issue.** Hiding a control removes the control, not the value behind it.
`control.contrast` hides the colour-preset radios, but
`SessionStore.visualEncoding` (`session.store.ts:589`) is still loaded from
`localStorage` (`flatland.visualEncoding.v1`) and still re-colours the app.
The other ids hide controls without a stored value, and a one-entry
`policyAllowlist` fixes the policy itself (§4.3c).

**Why it is not built** (decided 2026-10-30, PR #146 review thread):

- **One machine, one value.** The Plan B deployment file hides
  `control.contrast` on every screen, the welcome screen's Session Settings
  included. While that server runs, nobody can change the preset, so every
  participant on the machine gets the one stored when the study starts.
- **It would not make a condition machine-independent.** Theme and colour
  scheme are stored too, and screen size, zoom and the OS light/dark setting
  differ by machine anyway. Using the default while hidden would remove only
  one of these sources.
- **The value is logged.** #157 records the preset in effect in the session
  header (`uiRestrictions.values`, its Q29/Q34), read from
  `SessionStore.visualEncodingPreset()`, so a drift shows in the data.

**If it is needed later**, e.g. a study on several machines: while an id is
hidden, its setting uses a `default` declared on the item in
`ui-config-items.ts`; `SessionStore` adds a computed `effectiveVisualEncoding`
for the CSS-variable effect and leaves storage alone; `applySettings()`
(`app.component.ts:1500`) skips the preset while it is hidden. About 20 lines
plus two specs, no config-file change.
