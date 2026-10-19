import { InteractionMode } from '../events/event-types';

/**
 * Experiment conditions — the Experiments door of the start screen.
 *
 * A condition pins the layout and the mode it was designed for; Study 3 also
 * pins the scenario, its disturbance and where the map looks, so every
 * participant meets the same situation. Each ends in the same questionnaire
 * (`surveyParts`), built from the validated AI4REALNET/hmisurveys instruments
 * (docs/plans/tours-experiments-cleanup.md §3).
 *
 * Still a first cut of the Experiment entity (scenario-infrastructure-gallery
 * plan §4.7): no participant id and no counterbalanced order yet.
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
  /** Questionnaire parts, fixed per condition so every run answers the same items. */
  surveyParts: readonly string[];
}

/** TLX, Jian trust and perceived understanding, plus open feedback. */
const STUDY_SURVEY = ['nasa-tlx', 'trust', 'understanding', 'open'] as const;

/** The Walensee case where the strategies clearly differ (PP beats the plan). */
const WALENSEE = {
  scenarioId: 'pf-ch-wn-wal-long-approach',
  disturbanceIds: ['strategy-e1-breakdown-weesen'],
  mapFocusCols: [69, 126] as [number, number],
};

export const STUDY_CONDITIONS: readonly StudyCondition[] = [
  { layoutId: 'preset-recommendation-study2', mode: 'recommendation', label: 'Recommendation · User Study 2', surveyParts: STUDY_SURVEY },
  { layoutId: 'preset-colearning-study2', mode: 'co-learning', label: 'Co-Learning · User Study 2', surveyParts: STUDY_SURVEY },
  { layoutId: 'preset-recommendation-study3', mode: 'recommendation', label: 'Recommendation · User Study 3', ...WALENSEE, surveyParts: STUDY_SURVEY },
  { layoutId: 'preset-colearning-study3', mode: 'co-learning', label: 'Co-Learning · User Study 3', ...WALENSEE, surveyParts: STUDY_SURVEY },
];
