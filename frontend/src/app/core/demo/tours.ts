import { InteractionMode } from '../events/event-types';
import { Lang } from '../i18n/language.service';

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
  /** Opening/closing pages around the modes (`core/demo/tour-briefings.ts`). */
  briefingId?: string;
  /**
   * The same briefing written per language, picked by the app language (English
   * when the language has none). Wins over `briefingId`. A tour's pages are
   * authored text, not keys, so a tour shown in two languages carries two
   * briefings — but it is one tour, not two entries in the picker.
   */
  briefingIds?: Partial<Record<Lang, string>>;
}

/** The briefing a tour opens with in `lang`. */
export function tourBriefingId(tour: Tour, lang: Lang): string | undefined {
  return tour.briefingIds?.[lang] ?? tour.briefingIds?.en ?? tour.briefingId;
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
    // The Co-Learning interview (CAS thesis): the German briefing is the
    // interview instrument, the English one is for showing it. Old links
    // (`co-learning-monte-carlo-interviews`, `-en`) resolve here with their
    // language — see TOUR_ALIASES.
    id: 'colearning-interview',
    name: 'Co-learning Monte Carlo Interviews',
    description:
      'Introduction to the topic and aim of the interview, then the Walensee disruption in Co-Learning mode with the modules marked, and finally all modules with learning theory. No survey: the interview asks the questions.',
    modes: ['co-learning'],
    layout: 'preset-colearning-interview',
    infrastructureId: 'pf-ch-wn-wal-long-approach',
    disturbanceIds: ['interview-e1-breakdown-single-track'],
    surveyAfterEachMode: false,
    expectedMinutes: 15,
    briefingIds: { de: 'co-learning-cost-benefit', en: 'co-learning-cost-benefit-en' },
  },
  {
    // Exploring the Zug-Weg-Diagramm on a real node: track map, diagram and
    // timetable open side by side, recommendation and train control on the
    // right.
    id: 'olten-zug-weg',
    name: 'Olten: explore the Zug-Weg-Diagramm',
    description:
      'Recommendation mode on a busy Olten (the hour’s timetable compressed threefold, ~9 trains at once): track map, Zug-Weg-Diagramm and timetable open at once; once trains get in each other’s way, Combined Actions simulates keep course, a strategy switch and a PP re-plan. The diagram opens on towards Bern → towards Basel. No survey.',
    modes: ['recommendation'],
    layout: 'preset-olten-zug-weg',
    infrastructureId: 'olten-dense',
    surveyAfterEachMode: false,
    expectedMinutes: 10,
    briefingIds: { en: 'olten-zug-weg-en', de: 'olten-zug-weg-de' },
  },
  {
    // The corridor twin of Olten: where the simulated strategies actually differ.
    id: 'walensee-zug-weg',
    name: 'Walensee: strategies on the Zug-Weg-Diagramm',
    description:
      'Recommendation mode on the Walensee corridor: the train due first through the single-track section breaks down in Weesen. Combined Actions compares keep course, a strategy switch and a PP re-plan, each simulated — the re-plan saves about half the delay, a strategy switch deadlocks the section. No survey.',
    modes: ['recommendation'],
    layout: 'preset-zug-weg-corridor',
    infrastructureId: 'pf-ch-wn-wal-long-approach',
    disturbanceIds: ['strategy-e1-breakdown-weesen'],
    surveyAfterEachMode: false,
    expectedMinutes: 10,
    briefingIds: { en: 'walensee-zug-weg-en', de: 'walensee-zug-weg-de' },
  },
  {
    id: 'director-only',
    name: 'Director only',
    description:
      'Straight into the Director screen — strategy tiles, forecast, AI-activity feed — with no walk and no survey. For showing that screen on its own.',
    modes: ['director'],
    layout: 'system',
    infrastructureId: 'guided-demo',
    surveyAfterEachMode: false,
    expectedMinutes: 6,
  },
];

/**
 * Ids of tours that used to be one entry per language. A link to one opens the
 * merged tour in that language, so links already handed out (interview
 * invitations, slides) keep showing what they showed.
 */
export const TOUR_ALIASES: Readonly<Record<string, { id: string; lang: Lang }>> = {
  'co-learning-monte-carlo-interviews': { id: 'colearning-interview', lang: 'de' },
  'co-learning-monte-carlo-interviews-en': { id: 'colearning-interview', lang: 'en' },
  'olten-zug-weg-en': { id: 'olten-zug-weg', lang: 'en' },
  'olten-zug-weg-de': { id: 'olten-zug-weg', lang: 'de' },
  'walensee-zug-weg-en': { id: 'walensee-zug-weg', lang: 'en' },
  'walensee-zug-weg-de': { id: 'walensee-zug-weg', lang: 'de' },
};

export function tourById(id: string): Tour | undefined {
  return TOURS.find((t) => t.id === (TOUR_ALIASES[id]?.id ?? id));
}
