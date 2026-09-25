# frontend/AGENTS.md

These rules apply on top of the root [`AGENTS.md`](../AGENTS.md) for anything
under `frontend/`. The full rules are in
[`docs/reference/frontend-lyne-conventions.md`](../docs/reference/frontend-lyne-conventions.md).

## Stack

- **Angular 22:** standalone components, signals, `computed()`. No NgModules.
- **SBB Lyne web components** (`@sbb-esta/lyne-elements`). Register new ones
  with a side-effect import in `src/main.ts`, and add `CUSTOM_ELEMENTS_SCHEMA`
  to the standalone component that uses them.
- **Component SCSS.** No Tailwind, no CSS Modules, no React.

## Commands

```bash
npm install
npm run start                                # :4200, expects the backend on :8000
npm run lint:styles                          # colour gate (CI)
npm run i18n:check                           # key gate (CI)
npm run i18n:coverage -- --missing           # which de/fr keys are still missing
npx ng build --configuration production      # CI build
```

## Rules that CI enforces

- **No hardcoded colours** (stylelint `color-no-hex`). Use `--sbb-color-*`,
  the `--app-*` / `--color-*` / `--layer-color-*` tokens from `src/styles.scss`,
  or `light-dark()`.
  - A new colour means a new token in `styles.scss`.
  - Never add files to `LEGACY_DEBT` in `.stylelintrc.cjs`. When you remove a
    file's hex values, remove the file from that list too.
- **Every literal translation key must exist in `public/i18n/en.json`.** That
  covers `'ns.key' | transloco` in templates and `.t('ns.key')` in TypeScript.

## Rules the reviewer checks

- **All user-facing text goes through i18n.** Add the key to `en.json` and,
  in the same change, to `de.json` (Swiss spelling, *du*) and `fr.json`
  (draft, flagged for native review).
- **Mode behaviour lives in one component.** It varies through a
  `modeBehavior = computed(() => switch (store.interactionMode()) …)`. Don't
  make three components and don't add parallel flags. For examples see
  `impact-panel` and `risk-uncertainty-panel`.
- **Registering a widget** touches six seams: the plugin host (`.ts` + `.html`),
  the layout-designer palette, `panel-mode-availability.ts`,
  `core/widgets/widget-catalog.ts` (the Widget Gallery reads it) and, only if
  it ships in the default layout, the app component. The skill
  [`.agents/skills/create-widget`](../.agents/skills/create-widget/SKILL.md)
  walks through all six.
- **Agent colours** come from `AgentColorService`, not from SCSS.
- **Leave these alone:** `session.store.ts _recordTrajectory` (trajectory
  compression), the scenario-refresh throttling in `scenario-panel`, and the
  `_recoverPolicyAndRetry*` fallbacks.
