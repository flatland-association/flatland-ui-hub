import { REFLECTION_QUESTION_POOL, resolveReflectionQuestionOrder } from './reflection-questions';

describe('resolveReflectionQuestionOrder', () => {
  beforeEach(() => spyOn(console, 'warn'));

  it('gives the default order when nothing is configured', () => {
    expect(resolveReflectionQuestionOrder(undefined)).toEqual([...REFLECTION_QUESTION_POOL]);
    expect(resolveReflectionQuestionOrder(null)).toEqual([...REFLECTION_QUESTION_POOL]);
    expect(resolveReflectionQuestionOrder([])).toEqual([...REFLECTION_QUESTION_POOL]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('follows a full configured order', () => {
    expect(resolveReflectionQuestionOrder(['tradeoff', 'gut', 'missing'])).toEqual(['tradeoff', 'gut', 'missing']);
  });

  it('asks the questions not listed after the listed ones, in the default order', () => {
    expect(resolveReflectionQuestionOrder(['tradeoff'])).toEqual(['tradeoff', 'gut', 'missing']);
  });

  it('skips unknown and repeated ids, with a warning', () => {
    expect(resolveReflectionQuestionOrder(['missing', 'insight', 'missing', 3])).toEqual(['missing', 'gut', 'tradeoff']);
    expect(console.warn).toHaveBeenCalledTimes(3);
  });
});
