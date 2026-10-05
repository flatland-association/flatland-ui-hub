/**
 * Stylelint — colour gate only.
 *
 * Purpose: stop NEW hardcoded colours from entering the codebase. We deliberately
 * do NOT extend a full config (e.g. stylelint-config-standard-scss) — that would
 * flag hundreds of unrelated legacy style issues and drown the signal. This config
 * enforces exactly one thing: no raw hex / named colours.
 *
 * Rules & rationale: docs/reference/frontend-lyne-conventions.md (§1).
 * Use Lyne/app design tokens or light-dark() instead of literal colours.
 *
 * TWO allowlists below:
 *   1. TOKEN_LAYER  — files where literal colours are correct (token definitions).
 *                     Permanent. Do not migrate.
 *   2. LEGACY_DEBT  — debt register, empty since the colour-independence plan
 *                     step 4. Never add to it: every file outside TOKEN_LAYER is
 *                     guarded.
 */

// Literal colours are the intended content here (the token layer).
const TOKEN_LAYER = [
  'src/styles.scss',
];

// Pre-existing debt. Empty: keep it that way.
const LEGACY_DEBT = [];

const COLOUR_MESSAGE =
  'No hardcoded colours — use Lyne/app design tokens (--sbb-color-*, --app-*) ' +
  'or light-dark(). See docs/reference/frontend-lyne-conventions.md §1.';

module.exports = {
  customSyntax: 'postcss-scss',
  rules: {
    'color-no-hex': [true, { message: COLOUR_MESSAGE }],
    'color-named': ['never', { message: COLOUR_MESSAGE }],
    'function-disallowed-list': [['/^(rgb|rgba|hsl|hsla)$/'], { message: COLOUR_MESSAGE }],
  },
  overrides: [
    {
      files: [...TOKEN_LAYER, ...LEGACY_DEBT],
      rules: {
        'color-no-hex': null,
        'color-named': null,
        'function-disallowed-list': null,
      },
    },
  ],
};
