import { EXPERIMENT_RUN_RECORD_SCHEMA, ExperimentRunRecord } from './experiment-run-record';
import { SESSION_RECORD_SCHEMA, SessionRecord } from './session-record';
import { recordsFromRunFile } from '../survey/survey-export';

/** What one import produced: the records found, and one message per file that had none. */
export interface ImportResult {
  records: SessionRecord[];
  failed: { file: string; reason: 'unreadable' | 'unknown' }[];
}

/**
 * Reads export files from other machines into session records, in memory
 * (docs/plans/experiment-logging-frontend-and-replay.md §5.6, step 22):
 *
 * - a session export (footer, "Sitzungsdaten exportieren"),
 * - a "Download data" bundle (`records: [...]`),
 * - a guided experiment's run file (#156), its legs and interrupted sessions,
 *   each with the questionnaires answered after it.
 *
 * `.json` or `.json.gz`; gzip is recognised by its first bytes, not the name.
 * The streams stay in the records, so an export of imported runs carries them.
 */
export async function importFiles(files: readonly File[]): Promise<ImportResult> {
  const result: ImportResult = { records: [], failed: [] };
  for (const file of files) {
    let data: unknown;
    try {
      data = JSON.parse(await readText(file));
    } catch {
      result.failed.push({ file: file.name, reason: 'unreadable' });
      continue;
    }
    const records = recordsFrom(data);
    if (records.length) result.records.push(...records);
    else result.failed.push({ file: file.name, reason: 'unknown' });
  }
  return result;
}

/** The session records in one parsed export file; empty if it is none of the three kinds. */
export function recordsFrom(data: unknown): SessionRecord[] {
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, unknown>;
  if (obj['schema'] === SESSION_RECORD_SCHEMA && isRecord(obj)) return [obj as unknown as SessionRecord];
  if (obj['schema'] === `${SESSION_RECORD_SCHEMA}-bundle` && Array.isArray(obj['records'])) {
    return (obj['records'] as unknown[]).filter(isRecord) as SessionRecord[];
  }
  if (obj['schema'] === EXPERIMENT_RUN_RECORD_SCHEMA && Array.isArray(obj['legs'])) {
    const run = obj as unknown as ExperimentRunRecord;
    return [...recordsFromRunFile(run), ...(run.interrupted ?? []).filter(isRecord)];
  }
  return [];
}

function isRecord(r: unknown): boolean {
  const header = (r as { header?: { sessionId?: unknown } } | null)?.header;
  return typeof header?.sessionId === 'string';
}

async function readText(file: Blob): Promise<string> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return file.text();
  const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}
