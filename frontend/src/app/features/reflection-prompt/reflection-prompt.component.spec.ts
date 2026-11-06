import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LanguageService } from '../../core/i18n/language.service';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { pickQuestions, reflectionAnswers, ReflectionPromptComponent, REFLECTION_QUESTION_POOL } from './reflection-prompt.component';

describe('reflection-prompt: question selection', () => {
  it('draws the same questions for the same decision', () => {
    for (const seed of [0, 1, 1726000000000, 1726000123456.7]) {
      expect(pickQuestions(seed, 2)).toEqual(pickQuestions(seed, 2));
    }
  });

  it('respects the limit and never repeats a question', () => {
    for (const n of [0, 1, 2, 3]) {
      const picked = pickQuestions(1726000000000, n);
      expect(picked.length).toBe(n);
      expect(new Set(picked).size).toBe(n);
      picked.forEach((q) => expect(REFLECTION_QUESTION_POOL).toContain(q));
    }
  });

  it('clamps limits outside the pool size', () => {
    expect(pickQuestions(42, -1)).toEqual([]);
    expect(pickQuestions(42, 99).length).toBe(REFLECTION_QUESTION_POOL.length);
  });

  it('a smaller limit is a prefix of a larger one, so "more questions" only appends', () => {
    const seed = 1726000999999;
    expect(pickQuestions(seed, 3).slice(0, 2)).toEqual(pickQuestions(seed, 2));
  });

  it('varies across decisions', () => {
    const firsts = new Set(Array.from({ length: 50 }, (_, i) => pickQuestions(1726000000000 + i * 7919, 1)[0]));
    expect(firsts.size).toBeGreaterThan(1);
  });
});

describe('reflection-prompt: serialised answers', () => {
  it('omits every unanswered question', () => {
    expect(reflectionAnswers(null, new Set(), '   ')).toEqual({});
  });

  it('stores chip answers as ids and the trade-off trimmed', () => {
    expect(reflectionAnswers('against', new Set(['duration', 'otherTrains']), '  later arrival  ')).toEqual({
      gut: 'against',
      missing: 'duration,otherTrains',
      tradeoff: 'later arrival',
    });
  });

  it('keeps a partial answer partial', () => {
    expect(reflectionAnswers(null, new Set(['nothing']), '')).toEqual({ missing: 'nothing' });
  });
});

/** A choice in the decision panel stores a placeholder action; the prompt
 *  names the logged choice (docs/plans/reflection-inline.md D8). */
describe('reflection-prompt: the decision it names', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reads «Plan behalten» as proceeding, not as rerouting', () => {
    TestBed.configureTestingModule({
      imports: [ReflectionPromptComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    const store = TestBed.inject(SessionStore);
    const i18n = TestBed.inject(LanguageService);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.recordProposalChoice(0, 'proceed');
    const prompt = TestBed.createComponent(ReflectionPromptComponent).componentInstance;
    expect(prompt.strategyLabel()).toBe(i18n.t('proposals.option.proceed', undefined, 'Proceed'));
    expect(prompt.strategyLabel()).not.toBe(i18n.t('proposals.option.reroute', undefined, 'Reroute'));
  });
});
