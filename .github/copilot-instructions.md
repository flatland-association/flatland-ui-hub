# GitHub Copilot instructions

The project instructions for every AI tool live in [`AGENTS.md`](../AGENTS.md),
plus [`frontend/AGENTS.md`](../frontend/AGENTS.md) and
[`backend/AGENTS.md`](../backend/AGENTS.md). Copilot reads those too. This
file only repeats the rules that code review must never miss:

- **No hardcoded colours.** No raw hex, `rgb()` or `rgba()` in SCSS or
  templates. Use Lyne tokens (`--sbb-color-*`), the app tokens in
  `frontend/src/styles.scss` (`--app-*`, `--color-*`, `--layer-color-*`) or
  `light-dark(a, b)`. CI enforces this with `npm run lint:styles`.
- **No inline user-facing text.** Every string is a key in
  `frontend/public/i18n/{en,de,fr}.json` (`| transloco` in templates,
  `LanguageService.t()` in TypeScript). Never branch on a displayed label. CI
  checks the keys with `npm run i18n:check`.
- **Stack.** Angular (standalone + signals) + Lyne web components
  (`@sbb-esta/lyne-elements`) + component SCSS. Not React, `lyne-react`, CSS
  Modules or Tailwind.
- **Modes.** Mode semantics stay in the `InteractionMode` union, with no
  parallel flags.
- **PRs** target `explore_db` ([`CONTRIBUTING.md`](../CONTRIBUTING.md)).
