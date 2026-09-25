import { InteractionMode } from '../events/event-types';

/**
 * Tours — the guided walks, as data.
 *
 * Until now a tour was hardcoded in three unconnected places: the mode sequence
 * in `SessionStore.demoSequence`, the intro copy in `MODE_INTROS`, and the
 * environment in `AppComponent.guidedDemoEnvOpts()`. The "Director Demo" button
 * was a fourth, degenerate copy of the same idea. Adding a layout variant meant
 * editing code in all of them.
 *
 * A tour pins everything: which modes, in which order, in which layout, on which
 * environment, with or without the survey. That is what makes it the simplest
 * entry point on the start screen — there is nothing left to configure, so the
 * person chooses one thing and presses start.
 *
 * This is the first slice of the `Tour` entity in
 * docs/plans/scenario-infrastructure-gallery.md §4.6. Deliberately *not* here
 * yet: the `setupId` reference (Setups do not exist), the per-mode event re-draw
 * (the event budget is unbuilt), and `Experiment` (§4.7 — a different entity,
 * not a flag on this one).
 */
export interface Tour {
  id: string;
  /** Shown in the picker. */
  name: string;
  /** One sentence: what this tour shows, and what it costs in minutes. */
  description: string;
  /** The modes, in order. One entry is a legitimate tour, not a special case. */
  modes: InteractionMode[];
  /**
   * Which layout the tour runs in. `'system'` is the hardcoded default layout;
   * anything else is a preset id. This is the field that makes "the same tour in
   * the old and in the new layout" a choice instead of a code change.
   */
  layout: 'system' | string;
  /** Which environment, by the id the Infrastructure picker uses. */
  infrastructureId: string;
  /** Whether each mode ends with the post-session survey. */
  surveyAfterEachMode: boolean;
  /** Rough wall-clock budget, so a facilitator can plan. */
  expectedMinutes: number;
  /** Scripted disturbances of the scenario to switch on, by id. */
  disturbanceIds?: string[];
  /**
   * Start the map on this column range (first, last). A property of the network,
   * not of the narrative: a 191-column corridor fitted to the panel width is a
   * hairline, and a tour that pins such a network has to say where to look. A
   * briefing's own `mapFocusCols` still wins, so the guided tours are unchanged.
   */
  mapFocusCols?: [number, number];
  /** Opening/closing pages around the modes (`core/demo/tour-briefings.ts`). */
  briefingId?: string;
}

export const TOURS: Tour[] = [
  {
    id: 'three-modes-original',
    name: 'Three modes · original layout',
    description:
      'The same conflict handled in all three modes — Recommendation, Co-Learning, Director — in the hardcoded default layout, with a short survey after each.',
    modes: ['recommendation', 'co-learning', 'director'],
    layout: 'system',
    infrastructureId: 'guided-demo',
    surveyAfterEachMode: true,
    expectedMinutes: 20,
  },
  {
    id: 'two-modes-guide-light',
    name: 'Two modes · Guide Mode Light',
    description:
      'Recommendation and Co-Learning in the three-zone layout: left reports, centre shows the network, right decides. Same environment as the original tour, so the layout is the only difference.',
    modes: ['recommendation', 'co-learning'],
    // Deliberately without Director — but not because a design *cannot* show
    // Director. Checked 2026-09-12: the strategy tiles, forecast, reflection,
    // AI-activity feed and goal-achievement are all panel types in
    // panel-plugin-host, the directive bar renders in both layout branches, and
    // the shift screen sits outside them. (An older claim in
    // layout-grid-model-plan.md §2b said otherwise; the code moved past it.)
    //
    // The reason is *this* layout: "Guide Mode · Light" is mode-neutral by
    // construction — it names only panels offered in all three modes — so a
    // Director leg would run in the Recommendation/Co-Learning decision column
    // and show none of Director's own surfaces. One design cannot swap its right
    // column per mode until the mode-scoped resolver lands
    // (docs/plans/mode-layouts-three-zones.md P1). Until then a Director tour
    // either uses the hardcoded layout, as the other two do, or waits for a
    // Director-shaped preset of its own.
    layout: 'preset-guide-mode-light',
    infrastructureId: 'guided-demo',
    surveyAfterEachMode: true,
    expectedMinutes: 14,
  },
  {
    id: 'co-learning-monte-carlo-interviews',
    name: 'Co-learning Monte Carlo Interviews',
    description:
      'Einführung ins Thema und Ziel der Befragung, dann die Störung am Walensee im Co-Learning-Modus mit markierten Modulen, zum Schluss alle Module mit Lerntheorie. Ohne Survey: die Fragen stellt das Interview.',
    modes: ['co-learning'],
    layout: 'preset-colearning-interview',
    infrastructureId: 'pf-ch-wn-wal-long-approach',
    disturbanceIds: ['interview-e1-breakdown-single-track'],
    surveyAfterEachMode: false,
    expectedMinutes: 15,
    briefingId: 'co-learning-cost-benefit',
  },
  {
    id: 'director-only',
    name: 'Director only',
    description:
      'Straight into the Director screen — strategy tiles, forecast, AI-activity feed — with no walk and no survey. For showing that screen on its own.',
    modes: ['director'],
    layout: 'system',
    // The PF-CH corridor rather than the generated demo network, because the
    // Director's map surfaces are built on a line and fall apart on a ring. On
    // the generated 36 x 24 network the deviating stretches of all three options
    // occupy the same columns (measured: 0..17 of 36 at every sampled step), so
    // the option bars would be three bars of equal length; on the corridor they
    // measure 40-45 of 191 and differ per option. The corridor also leaves the
    // vertical room the bars are drawn in — a 21:1 network in a wide panel makes
    // `viewBox()` stretch the height, a 1.5:1 one makes it stretch the width.
    // Needs the raised encoder caps (app/config.py); see there for what that is
    // and is not known to be safe.
    infrastructureId: 'pf-ch-wn-wal-long-approach',
    // Ziegelbrücke to Walenstadt, the same range the Co-Learning tour uses on
    // this network: both spawns, the shared track after Weesen, and the single
    // track between them where the conflict sits. Measured, the contention window
    // is columns 101..124 and the deviations run 80..124, so this range holds
    // everything the option bars point at.
    mapFocusCols: [69, 126],
    surveyAfterEachMode: false,
    expectedMinutes: 6,
  },
];

export function tourById(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === id);
}
