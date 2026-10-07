# Colour independence — Lyne theme switch now, own palette and dark mode later

> Dated plan, 2026-09-26. Direction B of
> [`design-system.md`](../reference/design-system.md) §4 ("complete the adapter
> layer"), taken one step at a time and starting with the colours. Builds on the
> inventory in [`colour-usage-audit.md`](../reference/colour-usage-audit.md) and
> the gate in `frontend/.stylelintrc.cjs`.

## Goal

The app's colours should not depend on SBB's brand. Every colour the app draws
goes through an **app token** (`--app-*`) with a clear meaning. Lyne is one
adapter behind those tokens. Switching theme, adding dark mode or later
replacing Lyne then only changes the token layer in `styles.scss`, not 35
component files.

## Step 1 — Lyne theme switch, off-brand by default (done in this change)

Lyne 4.x ships `standard`, `off-brand` and `safety`. Diffed against
`standard-theme.css` the other two change **only** these tokens:

| Theme | `--sbb-color-primary*` | `--sbb-color-brand` |
|---|---|---|
| `standard` | red | red |
| `off-brand` | royal | red |
| `safety` | royal | metal |

- **Switching.** `styles.scss` keeps the one `standard-theme.css` import and
  overrides those tokens under `:root[data-brand-theme='…']`. That avoids
  three 150 KB imports. `BrandThemeService` (`core/theme/`) sets the attribute
  and remembers the choice in `localStorage`, like the language. `index.html`
  carries the default so the first paint is already right. The switch lives
  in the shared shell menu under the language.
- **Default `off-brand`.** A neutral accent keeps red for what it means.
- **`--app-accent` was split off red.** Before this change the app never used
  `--sbb-color-primary`: 49 places used `--sbb-color-red` directly, and about
  40 more used raw `#eb0000` or `rgba(235, 0, 0, …)`. Red therefore meant both
  "active or selected" and "error". Each use is now one of two kinds:
  - **Accent** → `--app-accent` (= `--sbb-color-primary`, follows the theme).
    This covers the active tab, focus ring, primary button, selection, slider
    thumb and spinner. Migrated in `app`, `help-about`, `toolbar`,
    `left-sidebar`, `scenario-panel`, `co-learning-reflection`,
    `director-weights`, `contribute`, `infrastructure-builder` and
    `layout-designer`. The last had `--designer-red` for both roles and now
    has `--designer-accent` beside it.
  - **Meaning** stays red: error, malfunction, conflict, override, danger
    action, the `.pill.bad` in scenarios and the disconnected dot. It will move
    onto `--app-severity-error` in step 2.

**Watch:** royal (`--sbb-color-royal`, dark navy) is now the accent, and
`--sbb-color-blue` (lighter) already means *Recommendation mode*,
*decision-support* and *severity info*. The two read as distinct, but nothing
new should use royal for meaning.

## Step 2 — every red with a meaning goes through a semantic token (done 2026-09-29)

Replace the remaining direct `--sbb-color-red`, `#eb0000` and
`rgba(235, 0, 0, …)` with the existing `--app-severity-error`, or with a new
token when the meaning is different (e.g. `--app-override` for a human
override, if it should stay distinct from error). Candidates are left-sidebar
`.action-btn.override`, map and Marey override pills, `agents-panel` and
`marey-chart` malfunction dots, `status-bar` and `app` WebSocket dots,
`notifications-panel`, `scenario-panel .pill.bad`, builder validation and
`goal-achievement .target-dot`. The same goes for the TS/HTML reds in
`visual-encoding.ts` and `flatland-map.component.html`.

**Done when** `grep -rE 'sbb-color-red|#eb0000|235, ?0, ?0' src/app` only
finds `agent-randomization.service.ts`, whose agent colours belong to the
agent palette.

## Step 3 — alias the structural greys (the 77 %) (done 2026-09-29 for SCSS)

Four greys and white carry 77 % of all Lyne token use (`design-system.md`
§2b). Add role tokens and move consumers file by file:

| App token | Today |
|---|---|
| `--app-text` | `--sbb-color-charcoal` |
| `--app-text-muted` | `--sbb-color-granite` |
| `--app-border` | `--sbb-color-cloud` |
| `--app-surface-muted` | `--sbb-color-milk` |
| `--app-surface` | `--sbb-color-white` |

Also retire the dead `--color-*` block and fold `--app-hover-*` and
`--app-select-*` (raw hex today) onto Lyne-backed values or `light-dark()`.

## Step 4 — pay down `LEGACY_DEBT`, file by file (done 2026-09-29)

There are about 1250 literal colours in 35 SCSS files, plus about 97 in
TS/HTML (map, charts, SVG). Order by visibility: shell (`app`, `toolbar`,
`status-bar`) → panels (`left-sidebar`, `agents-panel`, `scenario-panel`,
`notifications-panel`) → map and Marey → internal tools (`layout-designer`,
`layout-sandbox`). Each file that reaches zero leaves `LEGACY_DEBT` in
`.stylelintrc.cjs`, so the gate guards it from then on. For TS colours (canvas
and SVG), read the token at runtime via `getComputedStyle` rather than
duplicating hex.

## Step 5 — dark mode (done 2026-09-29, light stays the default)

Only when steps 2–4 cover the shell, panels and map:

- drop `color-scheme: light only` (`styles.scss` ×2, `index.html`)
- put Lyne's `sbb-light` / `sbb-dark` / `sbb-light-dark` on `<html>`
- add a second switch in the shell menu next to the theme, with the same
  service pattern
- give the remaining raw app tokens `light-dark()` values

Lyne's own tokens already carry `light-dark()` pairs (including royal), so the
accent and theme switch carry over unchanged.

## Out of scope

- Replacing Lyne or wrapping its components (design-system.md option D and the
  component half of B).
- Agent colours (`AgentColorService`). They are a separate palette on purpose.
- The Visual Encoding presets in Session Settings. They colour meaning
  (severity, authorship), not brand, and stay independent of the theme.

## Status 2026-09-29

- **Step 2 done.** Remaining `sbb-color-red` / `#eb0000` only in
  `agent-randomization.service.ts` (agent palette) and the Visual Encoding
  preset in `visual-encoding.ts` (both out of scope, see above).
- **Step 3 done for SCSS.** `--app-text`, `--app-text-muted`, `--app-border`,
  `--app-surface-muted` and `--app-surface` exist in `styles.scss` and replace
  the Lyne greys by property: `color` (charcoal, granite), `background`
  (milk, white, cloud) and `border*` / `outline*` (cloud). Left on purpose,
  for the dark-mode pass: charcoal as fill or border, white as text on a
  coloured fill (needs an `--app-on-accent`), and `fill` / `stroke` in SVG.
  Still open from step 3: retire the `--color-*` block and turn
  `--app-hover-*` / `--app-select-*` into Lyne-backed values or `light-dark()`.

### Step 4 result

- `LEGACY_DEBT` in `.stylelintrc.cjs` is empty. Only `src/styles.scss` (the token
  layer) may hold literals. The gate now also forbids `rgb()`, `rgba()`,
  `hsl()` and `hsla()`, which it did not before.
- Literals were mapped to existing tokens by meaning (see table in the commit):
  greys to Lyne greys, blue/orange/green/red to `--app-severity-*` and
  `--app-positive`, tints to `color-mix()` on those, selection and hover to
  `--app-select-*` / `--app-hover-*`, shadows and overlays to `color-mix()` on
  `--sbb-color-black` / `--sbb-color-white`. New tokens: `--app-on-fill`,
  `--app-grid-line`.
- **Visible shift:** hexes that only approximated a token now take its exact
  value (e.g. `#00973b` → `--app-positive`, which is Lyne green `#008233`).
  Shades differ by a few percent; hue and meaning are unchanged.
- TS/HTML: selection magenta (`var(--app-select-color)`), SVG text and grid,
  the deadline badge in `left-sidebar` now use tokens. Left as is on purpose:
  `agent-color.types.ts` and the palette fallbacks in map and Marey (agent
  colours), and `visual-encoding.ts` presets (see Out of scope).
- Not done yet for step 5: `styles.scss` token values themselves (`--app-select-*`,
  `--app-hover-*`, `--layer-color-*`, `--color-*`) still need `light-dark()`.

### Step 5 result

- `ColorSchemeService` (`core/theme/`) with `light` (default), `dark` and
  `auto`, stored in `localStorage` (`flatland.colorScheme`), set as Lyne's
  `sbb-light` / `sbb-dark` / `sbb-light-dark` class on `<html>`. Switch in the
  shell menu under "Appearance". `color-scheme: light only` is gone from
  `styles.scss` and `index.html`.
- `styles.scss` role tokens and `--app-select-*`, `--app-hover-*`, some
  `--layer-color-*` and `--app-kind-*` carry `light-dark()` pairs. New
  `--app-text-secondary`. Text uses `--app-text*`, backgrounds
  `--app-surface*`, so Lyne's own pairs and the app agree.
- The navy logo sits on a light chip in dark mode (`light-dark()` background).
- Checked in the browser on the start page and the working screen (map, ZWL,
  panels) in dark, light and auto. Not walked through yet: every tour step,
  and the agent colours on a dark map (unchanged on purpose).
- **Review pass 2026-09-29:** walked start page, Recommendation, Co-Learning
  and Director workspaces, briefing, survey, debrief, widget gallery, layout
  designer and infrastructure builder in dark, with a script for light
  backgrounds and low contrast. Fixed: Lyne blue (no dark pair) via
  `--app-blue`, tinted text via `--app-shade`, text on blue via
  `--app-on-blue`, dark text on orange and light-grey chips, designer tokens,
  the builder's white empty-cell tile, and invalid nested `var()` from step 4.
  Not walked: every tour stop, `#/contribute`, `#/strategies`, agent colours.
