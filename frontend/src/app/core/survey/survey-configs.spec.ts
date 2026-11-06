import { postSessionSurvey } from './survey-configs';

/** The questionnaire after a scenario says so; its id, the stored answers' key, stays
 *  (docs/plans/remove-shift-summary.md §4.5). */
describe('postSessionSurvey', () => {
  it('is the post-session survey by default', () => {
    const c = postSessionSurvey('co-learning');
    expect(c.id).toBe('post-session-co-learning');
    expect(c.title).toBe('Post-session survey — Co-Learning');
    expect(c.description).toBe('Please answer based on the run you just completed.');
  });

  it('after a scenario, is titled and worded for it, under the same id', () => {
    const c = postSessionSurvey('co-learning', ['nasa-tlx'], true);
    expect(c.id).toBe('post-session-co-learning');
    expect(c.title).toBe('Post-scenario survey — Co-Learning');
    expect(c.description).toBe('Please answer based on the scenario you just completed.');
    expect(c.sections.length).toBe(1);
  });
});
