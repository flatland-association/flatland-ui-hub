import { postSessionSurvey } from './survey-configs';
import { scoreSurvey, surveyRecord } from './survey-scoring';

describe('survey scoring (hmisurveys conventions)', () => {
  const config = postSessionSurvey('recommendation', ['nasa-tlx', 'trust', 'understanding', 'ueq-s']);

  it('carries the hmisurveys item sets', () => {
    const n = (id: string) => config.sections.find((s) => s.id === id)!.questions.length;
    expect(n('nasa-tlx')).toBe(6);
    expect(n('trust')).toBe(12);
    expect(n('ueq-s')).toBe(8);
    expect(n('understanding')).toBe(2);
  });

  it('reverses the distrust items and shifts UEQ-S to −3..+3', () => {
    const answers: Record<string, number> = {};
    for (let i = 1; i <= 12; i++) answers[`trust_${i}`] = i >= 7 && i <= 10 ? 1 : 7;
    for (let i = 1; i <= 8; i++) answers[`ueq_${i}`] = i <= 4 ? 7 : 4;
    ['tlx_mental', 'tlx_physical', 'tlx_temporal', 'tlx_performance', 'tlx_effort', 'tlx_frustration']
      .forEach((id, i) => (answers[id] = 10 * (i + 1)));
    answers['und_1'] = 6;
    answers['und_2'] = 2;

    const s = scoreSurvey(config, answers);
    expect(s['trust']).toEqual({ trust: 7, distrust: 7, overall: 7 });
    expect(s['ueq-s']).toEqual({ pragmatic: 3, hedonic: 0, overall: 1.5 });
    expect(s['nasa-tlx']['raw']).toBe(35);
    expect(s['understanding']['perceived']).toBe(6);
  });

  it('gives no score for a subscale with a gap, rather than a partial mean', () => {
    const s = scoreSurvey(config, { trust_1: 7 });
    expect(s['trust']['trust']).toBeNull();
    expect(s['nasa-tlx']['raw']).toBeNull();
  });

  it('records context, instruments and scores together', () => {
    const r = surveyRecord(config, {}, { sessionId: 's1', mode: 'recommendation', conditionId: 'c' }, new Date(0));
    expect(r.schema).toBe('flatland-survey/1');
    expect(r.submittedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(r.context.conditionId).toBe('c');
    expect(r.instruments.map((i) => i.id)).toEqual(['nasa-tlx', 'trust', 'understanding', 'ueq-s']);
  });
});
