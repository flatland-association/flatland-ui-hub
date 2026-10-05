import { InteractionMode } from '../events/event-types';
import { SurveyConfig, SurveySection } from './survey.types';

/**
 * Post-session survey building blocks. The standard instruments are the
 * validated versions from AI4REALNET/hmisurveys (Borst 2025,
 * doi:10.5281/zenodo.17495928), re-authored here item for item: the wording,
 * scale range and anchors follow that repository, which asks that they not be
 * modified. Only the items are taken over, not its GPL-3 code (this repo is
 * Apache-2.0; docs/plans/tours-experiments-cleanup.md §3, option a).
 * Scoring lives in survey-scoring.ts.
 */

const HMIS = 'via AI4REALNET/hmisurveys';

// NASA-TLX, one-part (raw TLX: the six scales, no pairwise weighting).
// hmisurveys html/workload/tlx_simple.html — 5..100 in steps of 5.
function tlxScale(id: string, name: string, def: string, left = 'Low', right = 'High') {
  return { id, text: `${name} — ${def}`, type: 'scale' as const, min: 5, max: 100, step: 5, minLabel: left, maxLabel: right };
}
const NASA_TLX: SurveySection = {
  id: 'nasa-tlx',
  title: 'Workload',
  instrument: `NASA-TLX, raw (Hart & Staveland 1988) · ${HMIS}`,
  questions: [
    tlxScale('tlx_mental', 'Mental Demand', 'How much mental and perceptual activity was required (e.g. thinking, deciding, calculating, remembering, looking, searching, etc)? Was the task easy or demanding, simple or complex, exacting or forgiving?'),
    tlxScale('tlx_physical', 'Physical Demand', 'How much physical activity was required (e.g. pushing, pulling, turning, controlling, activating, etc)? Was the task easy or demanding, slow or brisk, slack or strenuous, restful or laborious?'),
    tlxScale('tlx_temporal', 'Temporal Demand', 'How much time pressure did you feel due to the rate of pace at which the tasks or task elements occurred? Was the pace slow and leisurely or rapid and frantic?'),
    tlxScale('tlx_performance', 'Performance', 'How successful do you think you were in accomplishing the goals of the task set by the experimenter (or yourself)? How satisfied were you with your performance in accomplishing these goals?', 'Good', 'Poor'),
    tlxScale('tlx_effort', 'Effort', 'How hard did you have to work (mentally and physically) to accomplish your level of performance?'),
    tlxScale('tlx_frustration', 'Frustration', 'How insecure, discouraged, irritated, stressed and annoyed versus secure, gratified, content, relaxed and complacent did you feel during the task?'),
  ],
};

// Trust in Automation, Jian, Bisantz & Drury (2000): 12 items, 1..7; items
// 7-10 form the distrust subscale and are scored reversed.
// hmisurveys html/trust/trust.html
function jian(n: number, text: string, distrust = false) {
  return {
    id: `trust_${n}`, text, type: 'likert' as const, min: 1, max: 7,
    minLabel: 'Strongly disagree', maxLabel: 'Strongly agree',
    subscale: distrust ? 'distrust' : 'trust', reverse: distrust,
  };
}
const TRUST: SurveySection = {
  id: 'trust',
  title: 'Trust in the system',
  instrument: `Trust in Automation (Jian et al. 2000) · ${HMIS}`,
  questions: [
    jian(1, 'The system is dependable.'),
    jian(2, 'The system behaves in a consistent manner.'),
    jian(3, 'I can trust the system.'),
    jian(4, 'The system is reliable.'),
    jian(5, 'I am confident in the system.'),
    jian(6, 'The system performs efficiently.'),
    jian(7, 'The system is deceptive.', true),
    jian(8, 'The system behaves unexpectedly.', true),
    jian(9, 'The system’s actions are misleading.', true),
    jian(10, 'I am suspicious of the system’s output.', true),
    jian(11, 'The system acts in my best interest.'),
    jian(12, 'The system has integrity.'),
  ],
};

// Understanding — the perceived-understanding subscale only. hmisurveys pairs
// it with factual and conceptual probes, but those are domain-specific (its
// template asks about nautical miles) and have to be written for this system
// before they can be used. html/understanding/understanding.html
const UNDERSTANDING: SurveySection = {
  id: 'understanding',
  title: 'Understanding',
  instrument: `Understanding, perceived (Borst 2025) · ${HMIS}`,
  questions: [
    { id: 'und_1', text: 'I understood what the system was doing.', type: 'likert', min: 1, max: 7, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree', subscale: 'perceived' },
    { id: 'und_2', text: 'The system’s predictions were confusing or unpredictable.', type: 'likert', min: 1, max: 7, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree', subscale: 'perceived', reverse: true },
  ],
};

// UEQ-S, Schrepp et al. (2017): 8 bipolar pairs, 1..7; 1-4 pragmatic,
// 5-8 hedonic. html/experience/ueq_short.html
function ueq(n: number, left: string, right: string, subscale: 'pragmatic' | 'hedonic') {
  return { id: `ueq_${n}`, text: `${left} — ${right}`, type: 'likert' as const, min: 1, max: 7, minLabel: left, maxLabel: right, subscale };
}
const UEQ_S: SurveySection = {
  id: 'ueq-s',
  title: 'User experience',
  description: 'Overall, the interface was…',
  instrument: `UEQ-S (Schrepp et al. 2017) · ${HMIS}`,
  questions: [
    ueq(1, 'obstructive', 'supportive', 'pragmatic'),
    ueq(2, 'complicated', 'easy', 'pragmatic'),
    ueq(3, 'inefficient', 'efficient', 'pragmatic'),
    ueq(4, 'confusing', 'clear', 'pragmatic'),
    ueq(5, 'boring', 'exciting', 'hedonic'),
    ueq(6, 'not interesting', 'interesting', 'hedonic'),
    ueq(7, 'conventional', 'inventive', 'hedonic'),
    ueq(8, 'usual', 'leading edge', 'hedonic'),
  ],
};

const OPEN: SurveySection = {
  id: 'open',
  title: 'Open feedback',
  questions: [
    { id: 'open_best', text: 'What worked best in this mode?', type: 'text' },
    { id: 'open_worst', text: 'What was hardest or most frustrating?', type: 'text' },
  ],
};

// Mode-specific extra section.
function modeSection(mode: InteractionMode): SurveySection {
  switch (mode) {
    case 'recommendation':
      return {
        id: 'mode-rec',
        title: 'Recommendations',
        questions: [
          { id: 'rec_useful', text: 'The AI recommendations were useful.', type: 'likert', min: 1, max: 7, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree' },
          { id: 'rec_followed', text: 'I tended to follow the AI recommendation.', type: 'likert', min: 1, max: 7, minLabel: 'Never', maxLabel: 'Always' },
        ],
      };
    case 'co-learning':
      return {
        id: 'mode-col',
        title: 'Co-Learning',
        questions: [
          { id: 'col_learned', text: 'Working with the AI helped me understand the situation better.', type: 'likert', min: 1, max: 7, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree' },
          { id: 'col_reflect', text: 'The reflection prompts were valuable.', type: 'likert', min: 1, max: 7, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree' },
        ],
      };
    case 'director':
      return {
        id: 'mode-dir',
        title: 'Director',
        questions: [
          { id: 'dir_control', text: 'I felt in control even though the AI ran autonomously.', type: 'likert', min: 1, max: 7, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree' },
          { id: 'dir_aware', text: 'I always knew what the system was doing and why.', type: 'likert', min: 1, max: 7, minLabel: 'Strongly disagree', maxLabel: 'Strongly agree' },
        ],
      };
  }
}

const MODE_LABEL: Record<InteractionMode, string> = {
  recommendation: 'Recommendation',
  'co-learning': 'Co-Learning',
  director: 'Director',
};

/**
 * Toggleable survey building blocks, selectable in Settings. The order here is
 * the order they appear in the questionnaire.
 */
export interface SurveyPart {
  id: string;
  label: string;
}
export const SURVEY_PARTS: SurveyPart[] = [
  { id: 'mode', label: 'Mode-specific questions' },
  { id: 'nasa-tlx', label: 'Workload (NASA-TLX, raw)' },
  { id: 'trust', label: 'Trust in the system (Jian)' },
  { id: 'understanding', label: 'Understanding (perceived)' },
  { id: 'ueq-s', label: 'User experience (UEQ-S)' },
  { id: 'open', label: 'Open feedback' },
];
export const DEFAULT_SURVEY_PARTS = SURVEY_PARTS.map((p) => p.id);

/**
 * Post-session survey for a given interaction mode, including only the survey
 * parts enabled in Settings (defaults to all).
 */
export function postSessionSurvey(
  mode: InteractionMode,
  enabledParts: string[] = DEFAULT_SURVEY_PARTS,
): SurveyConfig {
  const byPart: { part: string; section: SurveySection }[] = [
    { part: 'mode', section: modeSection(mode) },
    { part: 'nasa-tlx', section: NASA_TLX },
    { part: 'trust', section: TRUST },
    { part: 'understanding', section: UNDERSTANDING },
    { part: 'ueq-s', section: UEQ_S },
    { part: 'open', section: OPEN },
  ];
  return {
    id: `post-session-${mode}`,
    title: `Post-session survey — ${MODE_LABEL[mode]}`,
    description: 'Please answer based on the run you just completed.',
    sections: byPart.filter((x) => enabledParts.includes(x.part)).map((x) => x.section),
  };
}
