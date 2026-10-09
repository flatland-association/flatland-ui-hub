// The setup matrix, generated from the app's sources of truth.
// The spec files iterate these lists; coverage.spec.ts checks them against
// TOURS, STUDY_CONDITIONS, InteractionMode, LAYOUT_PRESETS and the backend
// presets, so nothing the app offers can drop out of the suite unnoticed.
import {
  EXPERIMENT_TOURS,
  INTRO_TOURS,
  LAYOUT_PRESETS,
  MODES,
  STUDY_CONDITIONS,
  TOURS,
  isPanelAvailableInMode,
  scenarioPresets,
  type InteractionMode,
  type StudyCondition,
  type Tour,
} from './app-data';
import { presetRestrictedPanels } from './panel-expectations';

/** Director plans before its first step (about a minute): such tests are `@slow`. */
export const isSlowMode = (mode: InteractionMode): boolean => mode === 'director';

// ── Tours ───────────────────────────────────────────────────────────────────
/** Fixed seed for the live variant, so its breakdowns replay identically. */
export const LIVE_SEED = 4242;

export interface TourCase {
  name: string;
  tour: Tour;
  variant: 'scripted' | 'live';
}

export const INTRO_TOUR_CASES: TourCase[] = [
  ...INTRO_TOURS.map((tour) => ({ name: `tour ${tour.id} · scripted`, tour, variant: 'scripted' as const })),
  // One live variant: the first Introduction tour that has one.
  ...INTRO_TOURS.filter((t) => t.live)
    .slice(0, 1)
    .map((tour) => ({ name: `tour ${tour.id} · live · seed ${LIVE_SEED}`, tour, variant: 'live' as const })),
];

export const EXPERIMENT_TOUR_CASES: TourCase[] = EXPERIMENT_TOURS.map((tour) => ({
  name: `experiments · tour ${tour.id}`,
  tour,
  variant: 'scripted' as const,
}));

// ── Study conditions ────────────────────────────────────────────────────────
export interface ConditionCase {
  name: string;
  condition: StudyCondition;
  scenarioId: string;
  /** Ticked on the start screen. */
  tick: string[];
  /** Sent with `POST /session`. */
  expected: string[];
}

/**
 * A condition with a fixed scenario runs it with its own disturbances (not a
 * choice there). One without runs on every preset with a plan, once with no
 * disturbances and once with all of them ticked.
 */
export const CONDITION_CASES: ConditionCase[] = STUDY_CONDITIONS.flatMap((condition) => {
  if (condition.scenarioId) {
    return [
      {
        name: `experiment ${condition.layoutId} · ${condition.scenarioId} · fixed disturbances`,
        condition,
        scenarioId: condition.scenarioId,
        tick: [],
        expected: condition.disturbanceIds ?? [],
      },
    ];
  }
  return scenarioPresets()
    .filter((p) => p.has_plan)
    .flatMap((preset) => [
      {
        name: `experiment ${condition.layoutId} · ${preset.id} · no disturbances`,
        condition,
        scenarioId: preset.id,
        tick: [],
        expected: [],
      },
      ...(preset.disturbanceIds.length
        ? [
            {
              name: `experiment ${condition.layoutId} · ${preset.id} · all disturbances`,
              condition,
              scenarioId: preset.id,
              tick: preset.disturbanceIds,
              expected: preset.disturbanceIds,
            },
          ]
        : []),
    ]);
});

// ── Build door ──────────────────────────────────────────────────────────────
export const BUILD_NETWORKS = ['guided-demo', 'random', ...scenarioPresets().map((p) => p.id)];

export interface BuildCase {
  name: string;
  mode: InteractionMode;
  network: string;
  /** `'system'` or a LAYOUT_PRESETS id. */
  layout: string;
}

export const BUILD_CASES: BuildCase[] = MODES.flatMap((mode) =>
  BUILD_NETWORKS.map((network) => ({
    name: `build · ${mode} · ${network} · default layout`,
    mode,
    network,
    layout: 'system',
  })),
);

/**
 * The mode a layout preset is meant for. A preset's name carries its mode and
 * nothing enforces it, so it is read from the
 * setups that use the preset — a study condition or a tour — and else is the
 * first mode that offers every mode-restricted panel the preset places.
 */
export function presetMode(id: string): InteractionMode {
  const condition = STUDY_CONDITIONS.find((c) => c.layoutId === id);
  if (condition) return condition.mode;
  const tour = TOURS.find((t) => t.layout === id);
  if (tour) return tour.modes[0];
  const restricted = presetRestrictedPanels(id);
  return MODES.find((m) => restricted.every((t) => isPanelAvailableInMode(t, m))) ?? MODES[0];
}

export const LAYOUT_CASES: BuildCase[] = LAYOUT_PRESETS.map((preset) => {
  const mode = presetMode(preset.id);
  return { name: `build · layout ${preset.id} · ${mode} · guided-demo`, mode, network: 'guided-demo', layout: preset.id };
});
