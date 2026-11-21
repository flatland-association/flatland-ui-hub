import type { ExperimentRunRecord } from '../interaction-log/experiment-run-record';
import type { SessionRecord } from '../interaction-log/session-record';
import { CODEBOOK_COLUMNS, LONG_COLUMNS, codebook, recordsFromRunFile, toCsv, toLongRows, toWideRows } from './survey-export';

function record(sessionId: string, legIndex: number, surveys: SessionRecord['surveys']): SessionRecord {
  return {
    schema: 'flatland-session-record',
    version: 3,
    header: {
      sessionId, participantId: null, conditionId: 'plan-b-p03', conditionLabel: 'Plan B', runIndex: 1,
      startedAt: Date.UTC(2026, 9, 29, 8, legIndex * 15), endedAt: null, mode: 'co-learning',
      experimentRunId: 'run-a', legId: `leg-${legIndex}`, legIndex,
    },
    decisions: [], decisionsDropped: 0, context: [], contextDropped: 0, surveys,
    reflection: null, learning: [], outcome: null,
  } as unknown as SessionRecord;
}

const LEG = { surveyId: 'post-session-co-learning', submittedAt: Date.UTC(2026, 9, 29, 8, 14), lang: 'de', afterLegId: 'leg-0' };
const FINAL = { surveyId: 'post-session-co-learning', submittedAt: Date.UTC(2026, 9, 29, 8, 40), lang: 'de', afterLegId: null };

describe('survey-export', () => {
  const records = [
    record('s1', 0, [{ ...LEG, answers: { und_1: 6, und_2: 2, open_best: 'the map, "mostly"' } }]),
    record('s2', 1, [{ ...FINAL, answers: { und_1: 5, und_2: 3 } }]),
  ];

  it('long: one row per answer with ids, reversed score, subscale and the free-text flag', () => {
    const rows = toLongRows(records);
    expect(rows.length).toBe(5);
    const und2 = rows.find((r) => r.session_id === 's1' && r.item_id === 'und_2')!;
    expect(und2).toEqual(jasmine.objectContaining({
      condition_id: 'plan-b-p03', experiment_run_id: 'run-a', leg_index: 0, after: 'leg', answer: 2, scored_value: 6,
      subscale: 'perceived', reverse: true, free_text: false, lang: 'de', run_started_at: '2026-10-29T08:00:00.000Z',
    }));
    expect(rows.find((r) => r.item_id === 'open_best')!.free_text).toBeTrue();
    expect(rows.filter((r) => r.session_id === 's2').every((r) => r.after === 'final')).toBeTrue();
  });

  it('wide: one row per questionnaire with the items and the scores, no free text', () => {
    const { columns, rows } = toWideRows(records);
    expect(rows.length).toBe(2);
    expect(columns).toContain('und_1');
    expect(columns).not.toContain('open_best');
    expect(columns).toContain('understanding.perceived');
    expect(rows[0]['understanding.perceived']).toBe(6);
  });

  it('codebook: every item once, with scale, reverse flag and hmisurveys source', () => {
    const rows = codebook();
    const ids = rows.map((r) => r.item_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows.find((r) => r.item_id === 'und_2')).toEqual(jasmine.objectContaining({
      survey_part: 'understanding', min: 1, max: 7, reverse: true, source: 'understanding/understanding.html #2',
    }));
    expect(Object.keys(rows[0])).toEqual([...CODEBOOK_COLUMNS]);
  });

  /** docs/plans/plan-b-small-changes.md, item 9: the Plan B questionnaire. */
  describe('Plan B final questionnaire', () => {
    const PB = { surveyId: 'plan-b-final', submittedAt: Date.UTC(2026, 9, 29, 9, 0), lang: 'de', afterLegId: null };
    const pbRecords = [record('s3', 2, [{ ...PB, answers: { pb_1: 6, pb_5: 70, pb_ai_use: 'nie', pb_age: 34 } }])];

    it('codebook: its items with their survey, page, scale labels and options', () => {
      const rows = codebook();
      expect(rows.find((r) => r.item_id === 'pb_1')).toEqual(jasmine.objectContaining({
        survey_id: 'plan-b-final', survey_part: 'pb-responsibility', page: 1, type: 'likert', min: 1, max: 7,
      }));
      expect(rows.find((r) => r.item_id === 'pb_1')!.options).toMatch(/^1=stimme überhaupt nicht zu; .*7=stimme voll und ganz zu$/);
      expect(rows.find((r) => r.item_id === 'pb_ai_use')!.options).toContain('nie | seltener als einmal pro Monat');
      expect(rows.find((r) => r.item_id === 'pb_age')).toEqual(jasmine.objectContaining({ type: 'number', unit: 'Jahre', min: 15, max: 99 }));
      // The building blocks stay, listing every questionnaire that asks them.
      expect(rows.find((r) => r.item_id === 'und_2')!.survey_id).toBe('post-session-recommendation, post-session-co-learning, post-session-director');
    });

    it('long and wide: its answers come with their question and item columns', () => {
      const long = toLongRows(pbRecords);
      expect(long.map((r) => r.item_id)).toEqual(['pb_1', 'pb_5', 'pb_ai_use', 'pb_age']);
      expect(long[0].question).toBe('Ich hatte das Gefühl, dass ich für das Ergebnis der Aufgabe verantwortlich war.');
      expect(long[0].subscale).toBe('pb-responsibility');
      const { columns, rows } = toWideRows(pbRecords);
      expect(columns).toContain('pb_38');
      expect(rows[0]['pb_5']).toBe(70);
    });
  });

  it('csv quotes commas, quotes and line breaks', () => {
    const csv = toCsv(LONG_COLUMNS, toLongRows(records));
    expect(csv.split('\n')[0]).toBe(LONG_COLUMNS.join(','));
    expect(csv).toContain('"the map, ""mostly"""');
  });

  it('a run file puts each questionnaire on its leg, the final one on the last', () => {
    const run = {
      legs: [
        { leg: 0, legId: 'leg-0', sessionId: 's1', record: record('s1', 0, []) },
        { leg: 1, legId: 'leg-1', sessionId: 's2', record: record('s2', 1, []) },
      ],
      questionnaires: [
        { ...LEG, answers: { und_1: 6 }, scores: {}, submittedAt: '2026-10-29T08:14:00.000Z' },
        { ...FINAL, answers: { und_1: 5 }, scores: {}, submittedAt: '2026-10-29T08:40:00.000Z' },
      ],
    } as unknown as ExperimentRunRecord;
    const [first, second] = recordsFromRunFile(run);
    expect(first.surveys.map((s) => s.afterLegId)).toEqual(['leg-0']);
    expect(second.surveys.map((s) => s.afterLegId)).toEqual([null]);
    expect(toLongRows([first, second]).map((r) => r.after)).toEqual(['leg', 'final']);
  });
});
