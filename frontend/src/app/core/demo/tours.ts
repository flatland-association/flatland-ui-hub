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
  /**
   * Which start-screen door offers this tour. Omitted (or 'tour') means the
   * "Introduction" door's tour picker; 'experiments' moves it into the
   * Experiments door instead — for a tour whose point is its survey, that is
   * where a facilitator looks for it, alongside the study conditions.
   */
  door?: 'tour' | 'experiments';
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
  /**
   * Play tempo the tour opens on, as a level of the shared 1–5 scale
   * (`core/play-speed.ts`). Omitted means the default, level 2 at 0.5 steps/s
   * (one minute every two seconds) — which every tour uses today.
   *
   * A tour whose point is that the operator decides something needs the run to be
   * slower than the deciding. Measured on the corridor: the episode is 180 steps,
   * so the old default of 3 steps/s was 60 seconds end to end, while one set of
   * A/B/C plans takes 25–45 s to compute — pressing play meant arriving at the
   * shift review having set the goal zero times.
   *
   * Only where it starts; the tempo control still belongs to the operator.
   */
  playSpeedLevel?: number;
  /**
   * Elapsed step the tour opens on. The session steps there by itself before
   * handing over (`SessionStore` → `_autoAdvanceToOpeningState`); omitted means
   * the usual start, as soon as the first train moves.
   *
   * A Director tour needs this because its strategy options are a *re-plan* of a
   * plan already running: planned fresh, all three options are the plan the
   * Director just committed, so all three tiles read "changes nothing". Which
   * step is far enough is a property of the scenario, measured per tour.
   */
  openAtStep?: number;
  /** Opening/closing pages around the modes (`core/demo/tour-briefings.ts`). */
  briefingId?: string;
  /**
   * The same briefing written per language, picked by the app language (English
   * when the language has none). Wins over `briefingId`. A tour's pages are
   * authored text, not keys, so a tour shown in two languages carries two
   * briefings — but it is one tour, not two entries in the picker.
   */
  briefingIds?: Partial<Record<Lang, string>>;
  /**
   * The tour's **live** variant, when it has one: random breakdowns instead of
   * the scripted disturbance, reproducible by seed
   * (docs/plans/live-tours-shift-rounds.md §2). The rate is per train and step,
   * tuned per scenario to about one or two breakdowns in a run.
   */
  live?: TourLive;
}

export interface TourLive {
  malfunctionRate: number;
  minDuration: number;
  maxDuration: number;
  /** Briefings for the live variant: the situation, not the scripted plot. */
  briefingIds: Partial<Record<Lang, string>>;
}

export type TourVariant = 'scripted' | 'live';

/** The briefing a tour opens with in `lang`, for the scripted or the live run. */
export function tourBriefingId(tour: Tour, lang: Lang, variant: TourVariant = 'scripted'): string | undefined {
  if (variant === 'live' && tour.live) {
    return tour.live.briefingIds[lang] ?? tour.live.briefingIds.en;
  }
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
    // Survey-based sibling of the interview tour: same scenario and layout,
    // but a real questionnaire instead of an interview, and a shorter run —
    // no Event-Simulation sandbox, no AI-lernt card, straight from the shift
    // summary into the survey.
    id: 'colearning-experiment',
    door: 'experiments',
    name: 'Co-Learning experiment (with survey)',
    description:
      'The Walensee disruption in Co-Learning mode, no interview framing — straight to the situation, through the shift, to the shift summary, then the post-session survey.',
    modes: ['co-learning'],
    layout: 'preset-colearning-interview',
    infrastructureId: 'pf-ch-wn-wal-long-approach',
    disturbanceIds: ['interview-e1-breakdown-single-track'],
    surveyAfterEachMode: true,
    expectedMinutes: 12,
    briefingIds: { de: 'colearning-experiment', en: 'colearning-experiment' },
  },
  {
    // Exploring the Zug-Weg-Diagramm on a real node: track map, diagram and
    // timetable open side by side, recommendation and train control on the
    // right.
    id: 'olten-zug-weg',
    name: 'Olten: explore the time-distance diagram',
    description:
      'Recommendation mode on a busy Olten (the hour’s timetable compressed threefold, ~9 trains at once): track map, time-distance diagram and timetable open at once; once trains get in each other’s way, Combined Actions simulates keep course, a strategy switch and a PP re-plan. The diagram opens on towards Bern → towards Basel. No survey.',
    modes: ['recommendation'],
    layout: 'preset-olten-zug-weg',
    infrastructureId: 'olten-dense',
    surveyAfterEachMode: false,
    expectedMinutes: 10,
    briefingIds: { en: 'olten-zug-weg-en', de: 'olten-zug-weg-de' },
    // ~52 trains, about nine on the map at once: ~2 breakdowns per 100 steps.
    live: { malfunctionRate: 0.0005, minDuration: 10, maxDuration: 30, briefingIds: { en: 'olten-zug-weg-live-en', de: 'olten-zug-weg-live-de' } },
  },
  {
    // The corridor twin of Olten: where the simulated strategies actually differ.
    id: 'walensee-zug-weg',
    name: 'Walensee: strategies on the time-distance diagram',
    description:
      'Recommendation mode on the Walensee corridor: the train due first through the single-track section breaks down in Weesen. Combined Actions compares keep course, a strategy switch and a PP re-plan, each simulated — the re-plan saves about half the delay, a strategy switch deadlocks the section. No survey.',
    modes: ['recommendation'],
    layout: 'preset-zug-weg-corridor',
    infrastructureId: 'pf-ch-wn-wal-long-approach',
    disturbanceIds: ['strategy-e1-breakdown-weesen'],
    surveyAfterEachMode: false,
    expectedMinutes: 10,
    briefingIds: { en: 'walensee-zug-weg-en', de: 'walensee-zug-weg-de' },
    // Three trains that are through in about 60 steps: 0.003 often gave none.
    live: { malfunctionRate: 0.01, minDuration: 10, maxDuration: 30, briefingIds: { en: 'walensee-zug-weg-live-en', de: 'walensee-zug-weg-live-de' } },
  },
  {
    // Director on the PF-CH corridor with stops (16 trains): the one scenario
    // where the three focuses plan differently. Walensee was tried first — with
    // three trains and no stops all three give the same plan
    // (docs/plans/tours-experiments-cleanup.md §1). Needs encoder_max_trains 16.
    id: 'corridor-director',
    name: 'PF–CH corridor: the AI dispatches (Director)',
    description:
      'Director mode on the Pfäffikon SZ–Chur corridor with sixteen trains that stop on the way: the AI dispatches every train and re-plans on its own; you choose the objective (delay, connections, stability), preview it on the map and take it over. Planning takes about a minute. No survey.',
    modes: ['director'],
    // Three zones: what the system does | overview | the choice.
    layout: 'preset-director-three-zones',
    infrastructureId: 'pf-ch-corridor-stops',
    surveyAfterEachMode: false,
    expectedMinutes: 12,
    briefingIds: { en: 'corridor-director-en', de: 'corridor-director-de' },
    // Sixteen trains over ~210 steps.
    live: { malfunctionRate: 0.0007, minDuration: 10, maxDuration: 30, briefingIds: { en: 'corridor-director-live-en', de: 'corridor-director-live-de' } },
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
    //
    // The long-approach variant, because this tour is about the choice between
    // the three objectives, and this is the scenario measured where the three
    // options are actually three plans. Sampled every few steps under
    // `goal_directed` from step 1, with `e1-late-into-the-section` on:
    //
    //   steps 1-6    A differs, B and C are the running plan or equal to it
    //   step 8 on    all three plans differ pairwise
    //   step 20 on   all three differ *and* none of them is empty
    //
    // `pf-ch-wn-wal-conflict`, which this tour used before, gives one plan under
    // all three objectives at every step sampled (1 to 50) — three identical
    // tiles, which is what the screen then reports. It was chosen for a different
    // reason: it is the scenario where the Director's planning beats the default
    // heuristic after a disruption (82 steps against 66). That comparison is not
    // what this tour shows, and here it is the other way round — undisturbed,
    // `deadlock_avoidance` gets the three trains home in 78 steps against the
    // Director's 90. The tour claims the choice, not the win.
    //
    // Same 191 x 9 network either way, so the column focus below still holds.
    infrastructureId: 'pf-ch-wn-wal-long-approach',
    disturbanceIds: ['e1-late-into-the-section'],
    // Ziegelbrücke to Walenstadt, the same range the Co-Learning tour uses on
    // this network: both spawns, the shared track after Weesen, and the single
    // track between them where the conflict sits. Measured, the contention window
    // is columns 101..124 and the deviations run 80..124, so this range holds
    // everything the option bars point at.
    mapFocusCols: [69, 126],
    // Open where the three options are three plans and none of them empty — the
    // first such step measured on this scenario (see the table above). Before it
    // the screen is correct and useless: it says the objective changes nothing,
    // because at that point it does not.
    openAtStep: 20,
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
