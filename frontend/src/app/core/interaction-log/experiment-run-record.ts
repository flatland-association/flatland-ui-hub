import type { ShiftRecord } from '../demo/tour-context.service';
import type { SessionRecord } from './session-record';

/**
 * One file per execution of a guided condition (docs/plans/experiment-workflow.md
 * §6): the legs in run order, each with its session record, and the
 * questionnaires. One condition id is one execution by one expert, so the
 * record names the condition, not a participant.
 */
export const EXPERIMENT_RUN_RECORD_SCHEMA = 'flatland-experiment-run-record';
export const EXPERIMENT_RUN_RECORD_VERSION = 1;

export interface ExperimentQuestionnaire {
  /** The leg it followed; null for the final questionnaire. */
  afterLegId: string | null;
  surveyId: string;
  answers: Record<string, unknown>;
  scores: Record<string, Record<string, number | null>>;
  submittedAt: string;
  /** The UI language at submit (`en`, `de`, `fr`); absent in older files. */
  lang?: string;
}

export interface ExperimentRunRecord {
  schema: typeof EXPERIMENT_RUN_RECORD_SCHEMA;
  version: typeof EXPERIMENT_RUN_RECORD_VERSION;
  exportedAt: string;
  experimentRunId: string;
  conditionId: string;
  conditionLabel: string;
  startedAt: number;
  endedAt: number;
  /** 'aborted' when the experimenter left the run before its end. */
  status: 'completed' | 'aborted';
  /** When the run was resumed after a reload, one entry each. */
  resumedAt: number[];
  appVersion: string | null;
  backendVersion: string | null;
  legs: (ShiftRecord & { record: SessionRecord | null })[];
  questionnaires: ExperimentQuestionnaire[];
  /** Sessions of this run that no leg names: a leg cut off by a reload and then
   *  resumed on a new session (docs/plans/experiment-logging-frontend-and-replay.md Q1). */
  interrupted?: SessionRecord[];
}

export interface ExperimentRunInput {
  experimentRunId: string;
  conditionId: string;
  conditionLabel: string;
  startedAt: number;
  endedAt: number;
  status: 'completed' | 'aborted';
  resumedAt: number[];
  appVersion: string | null;
  backendVersion: string | null;
  legs: ShiftRecord[];
  questionnaires: ExperimentQuestionnaire[];
}

export function buildExperimentRunRecord(
  input: ExperimentRunInput,
  recordFor: (sessionId: string) => SessionRecord | null,
): ExperimentRunRecord {
  return {
    schema: EXPERIMENT_RUN_RECORD_SCHEMA,
    version: EXPERIMENT_RUN_RECORD_VERSION,
    exportedAt: new Date().toISOString(),
    ...input,
    legs: [...input.legs]
      .sort((a, b) => a.leg - b.leg)
      .map((leg) => ({ ...leg, record: leg.sessionId ? recordFor(leg.sessionId) : null })),
  };
}

function filePart(value: string, fallback: string): string {
  const cleaned = value.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

/** `flatland-<conditionId>-<runId>.json`. */
export function experimentRunRecordFileName(record: Pick<ExperimentRunRecord, 'conditionId' | 'experimentRunId'>): string {
  return `flatland-${filePart(record.conditionId, 'experiment')}-${filePart(record.experimentRunId, 'run')}.json`;
}
