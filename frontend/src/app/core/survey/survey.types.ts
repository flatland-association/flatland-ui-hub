/**
 * Config-driven survey model. Questionnaires are defined as data (see
 * survey-configs.ts) so they can be swapped/adjusted per interaction mode or
 * study iteration without touching the renderer.
 */
export type SurveyQuestionType = 'likert' | 'scale' | 'radio' | 'text' | 'number' | 'percent';

export interface SurveyQuestion {
  id: string;
  text: string;
  type: SurveyQuestionType;
  /** radio: choice labels. */
  options?: string[];
  /** radio: `list` = one radio input per line; default = chips. */
  layout?: 'chips' | 'list';
  /** likert/scale: numeric range (defaults likert 1..7). */
  min?: number;
  max?: number;
  /** likert/scale: anchor labels for the two ends. */
  minLabel?: string;
  maxLabel?: string;
  /** scale: slider step (default 5); number: input step (default 1). */
  step?: number;
  /** number: unit shown after the field, e.g. "Jahre". */
  unit?: string;
  /** Scored reversed (max + min − value), e.g. Jian's distrust items. */
  reverse?: boolean;
  /** Subscale the item belongs to, for scoring (e.g. `trust` / `distrust`). */
  subscale?: string;
}

export interface SurveySection {
  id: string;
  title?: string;
  description?: string;
  /** Standard instrument this section is based on, shown as a subtle tag. */
  instrument?: string;
  /** Column labels of a matrix: the section's `likert` items render as rows,
   *  one radio per label, valued `min` … `min + scale.length - 1`. */
  scale?: string[];
  /** 1-based page of a paged survey (`SurveyConfig.paged`). */
  page?: number;
  questions: SurveyQuestion[];
}

export interface SurveyConfig {
  id: string;
  title: string;
  description?: string;
  sections: SurveySection[];
  /** Shown page by page (sections by `page`), with back and forward. */
  paged?: boolean;
  /** Every item must be answered before going on and before submitting. */
  requireAll?: boolean;
  /** `false`: no close and no cancel, the questionnaire is finished by submitting. */
  closable?: boolean;
}

export type SurveyAnswers = Record<string, string | number>;
