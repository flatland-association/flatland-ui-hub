import { SurveyAnswers, SurveyConfig, SurveyQuestion } from './survey.types';

/**
 * Scores for the standard instruments, computed as AI4REALNET/hmisurveys does
 * so our results line up with theirs:
 *
 * - NASA-TLX (raw): mean of the six scales, 5..100.
 * - Trust (Jian): per-subscale means on 1..7 with the distrust items reversed
 *   (8 − x), and the overall mean over all twelve reversed-where-needed items.
 * - UEQ-S: items shifted to −3..+3; pragmatic, hedonic and overall means.
 * - Understanding: mean of the perceived items, reversed where needed.
 *
 * A subscale with an unanswered item has no score (null) rather than a mean
 * over fewer items — a partial mean is not the instrument's score.
 */
export type SurveyScores = Record<string, Record<string, number | null>>;

function value(q: SurveyQuestion, answers: SurveyAnswers): number | null {
  const raw = answers[q.id];
  if (typeof raw !== 'number') return null;
  return q.reverse ? (q.max ?? 7) + (q.min ?? 1) - raw : raw;
}

function mean(values: Array<number | null>): number | null {
  if (!values.length || values.some((v) => v === null)) return null;
  return (values as number[]).reduce((a, b) => a + b, 0) / values.length;
}

export function scoreSurvey(config: SurveyConfig, answers: SurveyAnswers): SurveyScores {
  const out: SurveyScores = {};
  for (const section of config.sections) {
    const qs = section.questions;
    switch (section.id) {
      case 'nasa-tlx':
        out[section.id] = { raw: mean(qs.map((q) => value(q, answers))) };
        break;
      case 'trust': {
        const sub = (name: string) => mean(qs.filter((q) => q.subscale === name).map((q) => value(q, answers)));
        out[section.id] = { trust: sub('trust'), distrust: sub('distrust'), overall: mean(qs.map((q) => value(q, answers))) };
        break;
      }
      case 'ueq-s': {
        const shifted = (name: string) =>
          mean(qs.filter((q) => q.subscale === name).map((q) => {
            const v = value(q, answers);
            return v === null ? null : v - 4;
          }));
        const pragmatic = shifted('pragmatic');
        const hedonic = shifted('hedonic');
        out[section.id] = {
          pragmatic,
          hedonic,
          overall: pragmatic === null || hedonic === null ? null : (pragmatic + hedonic) / 2,
        };
        break;
      }
      case 'understanding':
        out[section.id] = { perceived: mean(qs.map((q) => value(q, answers))) };
        break;
    }
  }
  return out;
}

/** Where the answers came from — what an analysis needs to tell runs apart. */
export interface SurveyContext {
  sessionId: string | null;
  mode: string;
  /** Experiment condition (layout id) and its label, when run as one. */
  conditionId?: string | null;
  conditionLabel?: string | null;
  tourId?: string | null;
  scenarioId?: string | null;
  disturbanceIds?: string[];
  elapsedSteps?: number | null;
}

/** The record a participant's submission is saved as (downloaded as JSON). */
export function surveyRecord(
  config: SurveyConfig,
  answers: SurveyAnswers,
  context: SurveyContext,
  submittedAt: Date = new Date(),
) {
  return {
    schema: 'flatland-survey/1',
    surveyId: config.id,
    submittedAt: submittedAt.toISOString(),
    context,
    instruments: config.sections.map((s) => ({ id: s.id, instrument: s.instrument ?? null })),
    answers,
    scores: scoreSurvey(config, answers),
  };
}
