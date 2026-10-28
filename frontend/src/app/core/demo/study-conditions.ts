import { InteractionMode } from '../events/event-types';
import { Lang } from '../i18n/language.service';
import { ModeIntro } from './mode-intro-configs';
import { briefingById } from './tour-briefings';
import { DEFAULT_SURVEY_PARTS } from '../survey/survey-configs';

/**
 * Experiment conditions — the Experiments door of the start screen.
 *
 * A condition pins the layout and the mode it was designed for; Study 3 also
 * pins the scenario, its disturbance and where the map looks, so every
 * participant meets the same situation. Each ends in the same questionnaire
 * (`surveyParts`), built from the validated AI4REALNET/hmisurveys instruments
 * (docs/plans/tours-experiments-cleanup.md §3).
 *
 * A condition with `legs` is a guided condition (docs/plans/experiment-workflow.md):
 * a briefing, then one scenario after the other, the Schichtbilanz over all of
 * them, the questionnaire, and one saved record. One condition id is one
 * execution by one expert; the order of the scenarios is authored per
 * condition, not computed.
 */
export interface StudyCondition {
  layoutId: string;
  mode: InteractionMode;
  /** Shown in the picker; experiment names stay English, like the questionnaires. */
  label: string;
  /** Fixed scenario (preset id). Without one the Experiments door offers every scenario with a plan. */
  scenarioId?: string;
  /** Disturbances switched on with the fixed scenario. */
  disturbanceIds?: string[];
  /** Map column range to open on (a 191-column corridor is a hairline otherwise). */
  mapFocusCols?: [number, number];
  /** Questionnaire parts, fixed per condition so every run answers the same items.
   *  For a guided condition: the final questionnaire, after the Schichtbilanz. */
  surveyParts: readonly string[];
  /** Needed once several conditions share a layout; records and deep links use `conditionId()`. */
  id?: string;
  /** i18n key of the name participants see (footer, picker); `label` stays the English fallback. */
  labelKey?: string;
  /** The briefing per language: opening pages, intro cards, guide, Schichtbilanz. Required with `legs`. */
  briefingIds?: Partial<Record<Lang, string>>;
  /** A guided condition: its scenarios in run order. One leg is valid ("⟨name⟩ (1/1)"). */
  legs?: ExperimentLeg[];
  /** Questionnaire after each leg; absent = none. */
  legSurveyParts?: readonly string[];
}

/** One leg of a guided condition: one "Szenario" the participant works through.
 *  Layout and mode are the condition's, so every leg shares them. */
export interface ExperimentLeg {
  /** Stable, logged, never the displayed label. */
  id: string;
  /** i18n key (`experimentLegs.*`): shown as "⟨name⟩ (k/N)", kept in records. */
  nameKey: string;
  /** scenario_presets.py id, as on the condition. */
  scenarioId: string;
  /** One per leg (one Betrieb round per scenario). */
  disturbanceIds: string[];
  /** Pinned: what makes the leg reproducible. */
  seed: number;
  /** Own intro card per UI language, English as the fallback; otherwise the
   *  briefing's `modeIntros[mode]`. Carried by the leg, not by position, so a
   *  shared leg keeps it at any position. */
  intro?: Partial<Record<Lang, ModeIntro>>;
  /** Wins over the briefing's. */
  mapFocusCols?: [number, number];
  /** Time-distance section; wins over the briefing's. */
  zugWegRoute?: { from: string; to: string };
  playSpeedLevel?: number;
  openAtStep?: number;
}

/** The id records, deep links and the picker use: the four study conditions keep their layout id. */
export function conditionId(c: StudyCondition): string {
  return c.id ?? c.layoutId;
}

/** A condition with legs runs guided (briefing, intro cards, guide, Schichtbilanz). */
export function isGuidedCondition(c: StudyCondition | null | undefined): boolean {
  return !!c?.legs?.length;
}

/** The preset a condition starts on: its fixed scenario, or its first leg's. */
export function conditionScenarioId(c: StudyCondition): string | undefined {
  return c.legs?.[0]?.scenarioId ?? c.scenarioId;
}

/** TLX, Jian trust and perceived understanding, plus open feedback. */
const STUDY_SURVEY = ['nasa-tlx', 'trust', 'understanding', 'open'] as const;

/** The Walensee case where the strategies clearly differ (PP beats the plan). */
const WALENSEE = {
  scenarioId: 'pf-ch-wn-wal-long-approach',
  disturbanceIds: ['strategy-e1-breakdown-weesen'],
  mapFocusCols: [69, 126] as [number, number],
};

// ── Shared legs ────────────────────────────────────────────────────────────
// Written once, referenced by every condition that runs them, so `legId`
// names the same scenario across conditions. Placeholders until the six
// study networks exist (docs/plans/experiment-workflow.md §2b, Q13).

/** Walensee, a train stops in the single-track section (today's guided experiment). */
export const WAL_SINGLE_TRACK: ExperimentLeg = {
  id: 'wal-single-track',
  nameKey: 'experimentLegs.walSingleTrack',
  scenarioId: 'pf-ch-wn-wal-long-approach',
  disturbanceIds: ['interview-e1-breakdown-single-track'],
  seed: 42,
};

/** The guided experiment's own card, with this leg's situation. The briefing
 *  runs in German (`TourBriefing.language`), so German is the one language. */
const WAL_FOLLOWER_INTRO_DE: ModeIntro = {
  ...briefingById('colearning-experiment')!.modeIntros!['co-learning']!,
  title: 'Ein Zug steht, der nächste läuft auf',
  whatHappens:
    'Dieselbe Strecke am Walensee, eine neue Lage. Ein Zug bleibt im Einspurabschnitt stehen, und der Zug dahinter läuft auf ihn auf. Wie es weitergeht, entscheidest du.',
};

/** Walensee, the second shift of the advanced tour: a follower runs up on the stopped train. */
export const WAL_FOLLOWER: ExperimentLeg = {
  id: 'wal-follower',
  nameKey: 'experimentLegs.walFollower',
  scenarioId: 'pf-ch-wn-wal-long-approach',
  disturbanceIds: ['advanced-shift2-e1-breakdown-follower'],
  seed: 42,
  intro: { de: WAL_FOLLOWER_INTRO_DE },
};

export const STUDY_CONDITIONS: readonly StudyCondition[] = [
  { layoutId: 'preset-recommendation-study2', mode: 'recommendation', label: 'Recommendation · User Study 2', surveyParts: STUDY_SURVEY },
  { layoutId: 'preset-colearning-study2', mode: 'co-learning', label: 'Co-Learning · User Study 2', surveyParts: STUDY_SURVEY },
  { layoutId: 'preset-recommendation-study3', mode: 'recommendation', label: 'Recommendation · User Study 3', ...WALENSEE, surveyParts: STUDY_SURVEY },
  { layoutId: 'preset-colearning-study3', mode: 'co-learning', label: 'Co-Learning · User Study 3', ...WALENSEE, surveyParts: STUDY_SURVEY },
  {
    // The guided experiment, as one leg (docs/plans/experiment-workflow.md §2a):
    // the Walensee disruption in Co-Learning mode, straight to the situation,
    // through the shift to the Schichtbilanz, then the questionnaire. It was
    // the tour of the same id; `#/tour/colearning-experiment` still opens it.
    id: 'colearning-experiment',
    layoutId: 'preset-colearning-interview',
    mode: 'co-learning',
    label: 'Co-Learning experiment (with survey)',
    labelKey: 'tours.colearning-experiment.name',
    briefingIds: { de: 'colearning-experiment', en: 'colearning-experiment' },
    // Pinned: the default of the Settings selection the tour used to read.
    surveyParts: DEFAULT_SURVEY_PARTS,
    legs: [WAL_SINGLE_TRACK],
  },
  {
    // Plan B — the user-study condition (issue #145, "user studies FHNW &
    // SBB"). Same run as `colearning-experiment`; what differs is the layout,
    // `preset-plan-b`, whose `ui` block is the restriction the study is about
    // (docs/plans/configurable-ui-plan.md §5.2).
    //
    // The first of ten: one condition per participant, so each run is
    // identifiable in the interaction log without a participant-id concept
    // existing yet. The other nine follow with their own scenarios; all of
    // them name this same layout, so the restriction is declared once and
    // cannot drift between them. It was a tour (#146);
    // `#/tour/plan-b-p01` still opens it.
    //
    // Briefing reused from `colearning-experiment` on purpose: the framing a
    // participant reads is identical, only the UI is reduced.
    id: 'plan-b-p01',
    layoutId: 'preset-plan-b',
    mode: 'co-learning',
    label: 'Plan B · participant 01',
    labelKey: 'tours.plan-b-p01.name',
    briefingIds: { de: 'colearning-experiment', en: 'colearning-experiment' },
    surveyParts: DEFAULT_SURVEY_PARTS,
    legs: [WAL_SINGLE_TRACK],
  },
  {
    // The mechanics of #131 on what exists today: two scenarios on the one
    // study-ready network, a short questionnaire after each, the full one at
    // the end. The real conditions run four of six networks each.
    id: 'colearning-experiment-2x',
    layoutId: 'preset-colearning-interview',
    mode: 'co-learning',
    label: 'Co-Learning experiment, two scenarios (with survey)',
    labelKey: 'experimentConditions.colearning-experiment-2x.name',
    briefingIds: { de: 'colearning-experiment-2x', en: 'colearning-experiment-2x' },
    legSurveyParts: ['nasa-tlx'],
    surveyParts: ['mode', 'trust', 'ueq-s', 'open'],
    legs: [WAL_SINGLE_TRACK, WAL_FOLLOWER],
  },
];
