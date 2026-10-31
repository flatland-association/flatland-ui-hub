import { importFiles, recordsFrom } from './record-import';
import { gzipJson } from './stream-store';

const record = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  schema: 'flatland-session-record',
  version: 3,
  header: { sessionId, startedAt: 1, endedAt: 2, mode: 'co-learning', conditionId: null, conditionLabel: null },
  decisions: [],
  context: [],
  surveys: [],
  ...extra,
});

describe('record import', () => {
  it('reads a session export, a "Download data" bundle and a run file', () => {
    expect(recordsFrom(record('a')).map((r) => r.header.sessionId)).toEqual(['a']);
    expect(recordsFrom({ schema: 'flatland-session-record-bundle', records: [record('b'), record('c'), { nope: 1 }] }).map((r) => r.header.sessionId)).toEqual(['b', 'c']);
    const run = {
      schema: 'flatland-experiment-run-record',
      legs: [{ legId: 'l1', record: record('d') }, { legId: 'l2', record: null }],
      questionnaires: [{ surveyId: 'mode', afterLegId: 'l1', answers: { q1: 3 }, submittedAt: '2026-10-29T08:00:00Z' }],
      interrupted: [record('e')],
    };
    const fromRun = recordsFrom(run);
    expect(fromRun.map((r) => r.header.sessionId)).toEqual(['d', 'e']);
    expect(fromRun[0].surveys[0].answers).toEqual({ q1: 3 });
    expect(recordsFrom({ schema: 'something-else' })).toEqual([]);
  });

  it('reads plain and gzipped files and names the ones it cannot use', async () => {
    const plain = new File([JSON.stringify(record('a', { clicks: [{ seq: 1 }] }))], 'a.json');
    const gz = new File([(await gzipJson(record('b'))).blob], 'b.json.gz');
    const junk = new File(['not json'], 'notes.txt');
    const other = new File([JSON.stringify({ hello: 1 })], 'other.json');
    const result = await importFiles([plain, gz, junk, other]);
    expect(result.records.map((r) => r.header.sessionId)).toEqual(['a', 'b']);
    expect(result.records[0].clicks).toEqual([{ seq: 1 }]);
    expect(result.failed).toEqual([{ file: 'notes.txt', reason: 'unreadable' }, { file: 'other.json', reason: 'unknown' }]);
  });
});
