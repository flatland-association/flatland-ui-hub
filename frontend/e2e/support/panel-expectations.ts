// Which mode-restricted panels a setup must show, and which it must not
// (plan §2.3, point 3; docs/reference/panel-mode-matrix.md).
//
// Availability comes from `PANEL_MODE_AVAILABILITY`, the file the matrix doc is
// generated from. A panel type missing from that map is offered in every mode,
// so only the listed types say anything about the mode.
import {
  LAYOUT_PRESETS,
  MODE_RESTRICTED_PANELS,
  isPanelAvailableInMode,
  type InteractionMode,
} from './app-data';

/** `'system'` = the hardcoded default layout; anything else is a `LAYOUT_PRESETS` id. */
export type LayoutRef = 'system' | string;

export const SYSTEM_LAYOUT = 'system';
/** The option value of the hardcoded default layout in the start-screen picker. */
export const SYSTEM_LAYOUT_OPTION = 'system-default-runtime-layout';

/**
 * The mode-restricted slots of the hardcoded default layout
 * (`app.component.html`), each gated by `panelAvailable()` or by the mode
 * branch that mirrors it. That template is markup, not data, so this list is
 * the one hand-kept piece: a new slot there needs an entry here.
 *
 * Left out on purpose: `strategy-reflection` and `co-learning-effect` render
 * an empty host until a strategy is committed, and `shift-review` only once the
 * shift ends, so "visible right after the start" is not their contract. They
 * are still checked for absence in the modes that exclude them.
 */
const SYSTEM_LAYOUT_SLOTS = [
  'agents',
  'recommendations',
  'scenario',
  'co-learning-reflection',
  'director-directive',
  'goal-achievement',
  'strategy-options',
  'strategy-forecast',
  'ai-activity',
  'director-weights',
];

/**
 * Chrome that a designed layout renders outside its panel grid
 * (`app.component.html`, the `useSavedRuntimeLayout()` branch).
 */
const PRESET_CHROME = ['director-directive'];

export interface PanelExpectation {
  /** Must be visible: the layout places them and the mode offers them. */
  visible: string[];
  /** Must not exist: the mode does not offer them. */
  absent: string[];
}

export function presetById(id: string) {
  const preset = LAYOUT_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Layout preset "${id}" not found in LAYOUT_PRESETS`);
  return preset;
}

/** Mode-restricted panel types a preset places. */
export function presetRestrictedPanels(id: string): string[] {
  const types = presetById(id).layout.columns.flatMap((c) => c.panels.map((p) => p.type));
  return [...new Set(types)].filter((t) => MODE_RESTRICTED_PANELS.includes(t));
}

export function expectedPanels(layout: LayoutRef, mode: InteractionMode): PanelExpectation {
  const placed = layout === SYSTEM_LAYOUT ? SYSTEM_LAYOUT_SLOTS : [...presetRestrictedPanels(layout), ...PRESET_CHROME];
  return {
    visible: [...new Set(placed)].filter((t) => isPanelAvailableInMode(t, mode)),
    absent: MODE_RESTRICTED_PANELS.filter((t) => !isPanelAvailableInMode(t, mode)),
  };
}
