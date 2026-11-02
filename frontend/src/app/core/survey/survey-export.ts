import type { InteractionMode } from '../events/event-types';
import type { ExperimentRunRecord } from '../interaction-log/experiment-run-record';
import type { SessionRecord, SurveySubmission } from '../interaction-log/session-record';
import { DEFAULT_SURVEY_PARTS, postSessionSurvey } from './survey-configs';
import { scoreSurvey } from './survey-scoring';
import type { SurveyAnswers, SurveyConfig, SurveyQuestion } from './survey.types';

/**
 * Questionnaire answers as tables (docs/plans/experiment-logging-frontend-and-replay.md
 * §5.5): long (one row per answer), wide (one row per submitted questionnaire)
 * and a codebook. Built in the browser from session records, so one
 * implementation serves the saved-runs list and imported files. Scores are
 * computed here with `survey-scoring.ts`, never copied.
 */

export const LONG_COLUMNS = [
  'condition_id', 'experiment_run_id', 'run_started_at', 'leg_index', 'leg_id', 'session_id', 'mode',
  'survey_id', 'after', 'item_id', 'question', 'answer', 'scored_value', 'subscale', 'reverse',
  'free_text', 'lang', 'submitted_at', 'participant_id',
] as const;
export type LongRow = Record<(typeof LONG_COLUMNS)[number], string | number | boolean | null>;

export const ID_COLUMNS = [
  'condition_id', 'experiment_run_id', 'run_started_at', 'leg_index', 'leg_id', 'session_id', 'mode',
  'survey_id', 'after', 'lang', 'submitted_at', 'participant_id',
] as const;

export const CODEBOOK_COLUMNS = [
  'survey_part', 'item_id', 'question', 'type', 'min', 'max', 'reverse', 'subscale', 'instrument', 'source',
] as const;
export type CodebookRow = Record<(typeof CODEBOOK_COLUMNS)[number], string | number | boolean | null>;

export type TableRow = Record<string, string | number | boolean | null>;

const MODES: InteractionMode[] = ['recommendation', 'co-learning', 'director'];

/** The `hmisurveys` file each re-authored part comes from (Q19); items are in its order. */
const HMIS_FILES: Record<string, string> = {
  'nasa-tlx': 'workload/tlx_simple.html',
  trust: 'trust/trust.html',
  understanding: 'understanding/understanding.html',
  'ueq-s': 'experience/ueq_short.html',
};

/** Every questionnaire the app can show, by id (`post-session-<mode>`), with all parts. */
function configs(): Map<string, SurveyConfig> {
  return new Map(MODES.map((mode) => {
    const config = postSessionSurvey(mode, DEFAULT_SURVEY_PARTS);
    return [config.id, config] as const;
  }));
}

function questionsOf(config: SurveyConfig | undefined): SurveyQuestion[] {
  return config?.sections.flatMap((s) => s.questions) ?? [];
}

function scored(q: SurveyQuestion | undefined, raw: unknown): number | null {
  if (!q || typeof raw !== 'number') return null;
  return q.reverse ? (q.max ?? 7) + (q.min ?? 1) - raw : raw;
}

function iso(t: number | string | null | undefined): string | null {
  if (t == null) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function ids(record: SessionRecord, survey: SurveySubmission, runStartedAt: number | null): TableRow {
  const h = record.header;
  const guided = !!h.experimentRunId && !h.tourId;
  return {
    condition_id: h.conditionId ?? (h.tourId ? `tour-${h.tourId}` : null),
    experiment_run_id: h.experimentRunId ?? null,
    run_started_at: iso(runStartedAt),
    leg_index: h.legIndex ?? null,
    leg_id: h.legId ?? null,
    session_id: h.sessionId,
    mode: h.mode,
    survey_id: survey.surveyId,
    after: survey.afterLegId !== undefined ? (survey.afterLegId === null ? 'final' : 'leg') : guided ? 'leg' : null,
    lang: survey.lang ?? null,
    submitted_at: iso(survey.submittedAt),
    participant_id: h.participantId ?? null,
  };
}

/** The earliest start per run, for `run_started_at`. */
function runStarts(records: SessionRecord[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of records) {
    const run = r.header.experimentRunId;
    if (!run) continue;
    out.set(run, Math.min(out.get(run) ?? Infinity, r.header.startedAt));
  }
  return out;
}

function runStart(starts: Map<string, number>, record: SessionRecord): number | null {
  const run = record.header.experimentRunId;
  return run ? starts.get(run) ?? null : record.header.startedAt;
}

/** One row per answered item, in run, leg and submission order. */
export function toLongRows(records: SessionRecord[]): LongRow[] {
  const byId = configs();
  const starts = runStarts(records);
  const rows: LongRow[] = [];
  for (const record of sortRecords(records)) {
    for (const survey of record.surveys ?? []) {
      const config = byId.get(survey.surveyId);
      const questions = questionsOf(config);
      const sectionOf = new Map(config?.sections.flatMap((s) => s.questions.map((q) => [q.id, s.id] as const)) ?? []);
      const answered = Object.keys(survey.answers ?? {});
      const order = [...questions.map((q) => q.id).filter((id) => answered.includes(id)), ...answered.filter((id) => !questions.some((q) => q.id === id))];
      for (const itemId of order) {
        const q = questions.find((x) => x.id === itemId);
        const raw = (survey.answers as SurveyAnswers)[itemId];
        rows.push({
          ...(ids(record, survey, runStart(starts, record)) as Omit<LongRow, 'item_id'>),
          item_id: itemId,
          question: q?.text ?? null,
          answer: typeof raw === 'number' || typeof raw === 'string' ? raw : raw == null ? null : JSON.stringify(raw),
          scored_value: scored(q, raw),
          subscale: q?.subscale ?? sectionOf.get(itemId) ?? null,
          reverse: !!q?.reverse,
          free_text: q?.type === 'text',
        } as LongRow);
      }
    }
  }
  return rows;
}

/**
 * One row per submitted questionnaire: the id columns, one column per item
 * (raw answer; free text left out, it is in the long table only) and the
 * scores (`<section>.<score>`, e.g. `trust.distrust`).
 */
export function toWideRows(records: SessionRecord[]): { columns: string[]; rows: TableRow[] } {
  const byId = configs();
  const starts = runStarts(records);
  const itemColumns: string[] = [];
  const scoreColumns: string[] = [];
  const rows: TableRow[] = [];
  const add = (list: string[], col: string) => {
    if (!list.includes(col)) list.push(col);
  };
  for (const record of sortRecords(records)) {
    for (const survey of record.surveys ?? []) {
      const config = byId.get(survey.surveyId);
      const row: TableRow = ids(record, survey, runStart(starts, record));
      for (const q of questionsOf(config)) {
        if (q.type === 'text') continue;
        add(itemColumns, q.id);
        const raw = (survey.answers as SurveyAnswers)?.[q.id];
        row[q.id] = typeof raw === 'number' || typeof raw === 'string' ? raw : null;
      }
      if (config) {
        for (const [section, scores] of Object.entries(scoreSurvey(config, (survey.answers ?? {}) as SurveyAnswers))) {
          for (const [name, value] of Object.entries(scores)) {
            add(scoreColumns, `${section}.${name}`);
            row[`${section}.${name}`] = value;
          }
        }
      }
      rows.push(row);
    }
  }
  return { columns: [...ID_COLUMNS, ...itemColumns, ...scoreColumns], rows };
}

/** Every item of every questionnaire, once (items shared between modes appear once). */
export function codebook(): CodebookRow[] {
  const seen = new Set<string>();
  const rows: CodebookRow[] = [];
  for (const config of configs().values()) {
    for (const section of config.sections) {
      section.questions.forEach((q, i) => {
        if (seen.has(q.id)) return;
        seen.add(q.id);
        rows.push({
          survey_part: section.id,
          item_id: q.id,
          question: q.text,
          type: q.type,
          min: q.min ?? (q.type === 'likert' ? 1 : null),
          max: q.max ?? (q.type === 'likert' ? 7 : null),
          reverse: !!q.reverse,
          subscale: q.subscale ?? null,
          instrument: section.instrument ?? null,
          source: HMIS_FILES[section.id] ? `${HMIS_FILES[section.id]} #${i + 1}` : null,
        });
      });
    }
  }
  return rows;
}

/**
 * The session records of a #156 run file, with the run's questionnaires as
 * their surveys: each after the leg it followed, the final one on the last
 * leg. The run file is the authority here: its questionnaires keep the leg
 * and the final questionnaire apart, which records saved before they were
 * noted separately do not.
 */
export function recordsFromRunFile(run: ExperimentRunRecord): SessionRecord[] {
  const legs = run.legs.filter((l) => l.record);
  const last = legs[legs.length - 1];
  return legs.map((leg) => ({
    ...leg.record!,
    surveys: run.questionnaires
      .filter((q) => q.afterLegId === leg.legId || (q.afterLegId === null && leg === last))
      .map((q) => ({
        surveyId: q.surveyId,
        answers: q.answers,
        submittedAt: Date.parse(q.submittedAt) || null,
        afterLegId: q.afterLegId,
        ...(q.lang ? { lang: q.lang } : {}),
      })),
  }));
}

/** CSV with a header row; quotes where needed. */
export function toCsv(columns: readonly string[], rows: TableRow[]): string {
  const cell = (v: unknown): string => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
}

function sortRecords(records: SessionRecord[]): SessionRecord[] {
  return [...records].sort((a, b) => a.header.startedAt - b.header.startedAt);
}

/** One `.xlsx` with the sheets long, wide and codebook. */
async function workbook(records: SessionRecord[]): Promise<Uint8Array> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheet = (columns: readonly string[], rows: TableRow[]) => [
    columns.map((c) => c as string),
    ...rows.map((r) => columns.map((c) => r[c] ?? null)),
  ];
  const wide = toWideRows(records);
  const blob = await writeXlsxFile([
    { sheet: 'long', data: sheet(LONG_COLUMNS, toLongRows(records)) },
    { sheet: 'wide', data: sheet(wide.columns, wide.rows) },
    { sheet: 'codebook', data: sheet(CODEBOOK_COLUMNS, codebook()) },
  ]).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * The questionnaire export of the saved-runs list (§5.6): a zip with one
 * `<run>.xlsx` per run, `all-runs.xlsx` over all of them and
 * `all-runs_long.csv` for scripts. The xlsx and zip libraries are loaded
 * only here (Q33).
 */
export async function questionnaireZip(runs: { stem: string; records: SessionRecord[] }[]): Promise<Blob> {
  const { zipSync, strToU8 } = await import('fflate');
  const all = runs.flatMap((r) => r.records);
  const files: Record<string, Uint8Array> = {};
  for (const run of runs) files[`${run.stem}.xlsx`] = await workbook(run.records);
  files['all-runs.xlsx'] = await workbook(all);
  files['all-runs_long.csv'] = strToU8(toCsv(LONG_COLUMNS, toLongRows(all)));
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
