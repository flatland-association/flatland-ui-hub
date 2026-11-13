import { PLAN_B_FINAL_PART, PLAN_B_FINAL_SURVEY, postSessionSurvey } from './survey-configs';

/** The Plan B final questionnaire as the study document lays it out
 *  (261105_FragebogenFinal.docx; docs/plans/experiment-scenario-import.md §3.10). */
describe('Plan B final questionnaire', () => {
  const s = PLAN_B_FINAL_SURVEY;
  const questions = s.sections.flatMap((sec) => sec.questions);

  it('is what the Plan B survey part asks, instead of the building blocks', () => {
    expect(postSessionSurvey('co-learning', [PLAN_B_FINAL_PART])).toBe(s);
  });

  it('is paged, fully required and cannot be closed', () => {
    expect(s.paged).toBeTrue();
    expect(s.requireAll).toBeTrue();
    expect(s.closable).toBeFalse();
  });

  it('has items 1 … 37 in order, then the four demographics, each id once', () => {
    const ids = questions.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.slice(0, 37)).toEqual(Array.from({ length: 37 }, (_, i) => `pb_${i + 1}`));
    expect(ids.slice(37)).toEqual(['pb_ai_use', 'pb_age', 'pb_gender', 'pb_years']);
  });

  it('puts the items on the document\'s six pages', () => {
    const pageOf = (id: string) => s.sections.find((sec) => sec.questions.some((q) => q.id === id))!.page;
    const expected: [string, number][] = [
      ['pb_1', 1], ['pb_4', 1], ['pb_5', 2], ['pb_8', 2], ['pb_9', 3], ['pb_17', 3],
      ['pb_18', 4], ['pb_27', 4], ['pb_28', 5], ['pb_37', 5], ['pb_ai_use', 6], ['pb_years', 6],
    ];
    for (const [id, page] of expected) expect(pageOf(id)).withContext(id).toBe(page);
  });

  it('asks pages 2 and 3 on five points and the other agreement items on seven', () => {
    for (const sec of s.sections.filter((x) => x.scale)) {
      const points = sec.page === 2 || sec.page === 3 ? 5 : 7;
      expect(sec.scale!.length).withContext(sec.id).toBe(points);
      for (const q of sec.questions) {
        expect([q.type, q.min, q.max]).withContext(q.id).toEqual(['likert', 1, points]);
      }
    }
  });

  it('asks the share as a percent, age and years as numbers, the rest as radio lists', () => {
    const q = (id: string) => questions.find((x) => x.id === id)!;
    expect(q('pb_4').type).toBe('percent');
    expect(q('pb_age').type).toBe('number');
    expect(q('pb_years').type).toBe('number');
    expect(q('pb_ai_use').options!.length).toBe(6);
    expect(q('pb_gender').options).toEqual(['weiblich', 'männlich', 'divers']);
  });
});
