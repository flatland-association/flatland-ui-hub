import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { LanguageService } from '../../core/i18n/language.service';
import { SessionInfo } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { UiConfigService } from '../../core/config/ui-config.service';
import { REFLECTION_QUESTION_POOL } from '../../core/reflection-questions';
import { reflectionAnswers, ReflectionPromptComponent } from './reflection-prompt.component';

/** The same order after every decision, not one drawn per decision
 *  (docs/plans/reflection-question-order.md). */
describe('reflection-prompt: question order', () => {
  afterEach(() => {
    jasmine.clock().uninstall();
    TestBed.resetTestingModule();
  });

  it('asks the questions in the same order for decisions taken at different times', () => {
    TestBed.configureTestingModule({
      imports: [ReflectionPromptComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    const store = TestBed.inject(SessionStore);
    const i18n = TestBed.inject(LanguageService);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(true);
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(1726000000000));
    store.recordProposalChoice(0, 'proceed');
    jasmine.clock().mockDate(new Date(1726000123457));
    store.recordProposalChoice(1, 'proceed');
    const [first, second] = store.openReflections().map((r) => r.decisionSeq);
    expect(store.openReflections()[0].timestamp).not.toBe(store.openReflections()[1].timestamp);

    const fixture = TestBed.createComponent(ReflectionPromptComponent);
    const el: HTMLElement = fixture.nativeElement;
    const labels = () => [...el.querySelectorAll('.rp-q > .rp-q-label')].slice(1).map((l) => l.textContent?.trim());
    for (const seq of [first, second]) {
      store.reopenRationale(seq);
      fixture.detectChanges();
      expect(fixture.componentInstance.shown()).withContext(`decision ${seq}`).toEqual([...REFLECTION_QUESTION_POOL]);
      expect(labels()).toEqual(REFLECTION_QUESTION_POOL.map((q) => i18n.t(`reflectionPrompt.q.${q}`)));
    }
  });

  it('asks them in the order the deployment sets', () => {
    TestBed.configureTestingModule({
      imports: [ReflectionPromptComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    const store = TestBed.inject(SessionStore);
    const config = TestBed.inject(UiConfigService);
    spyOn(config, 'reflectionQuestionOrder').and.returnValue(['tradeoff', 'gut', 'missing']);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.recordProposalChoice(0, 'proceed');
    const fixture = TestBed.createComponent(ReflectionPromptComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.shown()).toEqual(['tradeoff', 'gut', 'missing']);
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

/** Every question shows at once; a "more questions" link was overlooked
 *  (docs/plans/reflection-inline.md D18). */
describe('reflection-prompt: the questions it shows', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the reason chips and every question of the pool, with no link for more', () => {
    TestBed.configureTestingModule({
      imports: [ReflectionPromptComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    const store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.setReflectionQuestionLimit(1);
    store.recordProposalChoice(0, 'proceed');
    const fixture = TestBed.createComponent(ReflectionPromptComponent);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(fixture.componentInstance.shown().length).toBe(REFLECTION_QUESTION_POOL.length);
    expect(el.querySelectorAll('.rp-q').length).toBe(1 + REFLECTION_QUESTION_POOL.length);
    expect(el.querySelector('.rp-more')).toBeNull();
  });
});

/** What is typed and not sent is kept per decision, so showing another one,
 *  or the panel going away, loses nothing (docs/plans/reflection-inline.md D30). */
describe('reflection-prompt: unsent answers', () => {
  let store: SessionStore;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReflectionPromptComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(SessionStore);
    store.session.set({ id: 'sess-1' } as SessionInfo);
    store.interactionMode.set('co-learning');
    store.queueReflections.set(true);
    store.recordProposalChoice(0, 'proceed');
    store.recordProposalChoice(1, 'proceed');
  });

  afterEach(() => TestBed.resetTestingModule());

  function type(fixture: ReturnType<typeof TestBed.createComponent<ReflectionPromptComponent>>) {
    const prompt = fixture.componentInstance;
    prompt.toggleFactor('delay');
    prompt.setGut('fit');
    prompt.toggleMissing('duration');
    prompt.tradeoff.set('Folgezug wartet');
    fixture.detectChanges();
  }

  function expectTyped(prompt: ReflectionPromptComponent) {
    expect([...prompt.selectedFactors()]).toEqual(['delay']);
    expect(prompt.gut()).toBe('fit');
    expect([...prompt.missing()]).toEqual(['duration']);
    expect(prompt.tradeoff()).toBe('Folgezug wartet');
  }

  it('starts from them when its decision is shown again', () => {
    const [first, second] = store.openReflections().map((r) => r.decisionSeq);
    const fixture = TestBed.createComponent(ReflectionPromptComponent);
    fixture.detectChanges();
    type(fixture);
    store.reopenRationale(second);
    fixture.detectChanges();
    const prompt = fixture.componentInstance;
    expect(prompt.selectedFactors().size).withContext('the other decision starts empty').toBe(0);
    expect(prompt.tradeoff()).toBe('');
    store.reopenRationale(first);
    fixture.detectChanges();
    expectTyped(prompt);
  });

  it('keeps them when the prompt goes away and comes back', () => {
    const fixture = TestBed.createComponent(ReflectionPromptComponent);
    fixture.detectChanges();
    type(fixture);
    fixture.destroy();
    const again = TestBed.createComponent(ReflectionPromptComponent);
    again.detectChanges();
    expectTyped(again.componentInstance);
  });

  /** docs/plans/plan-b-small-changes.md, item 7: no "Nur diesmal", and fixed
   *  click ids so the log doesn't read the buttons by position. */
  it('offers "as a rule" and "no" only, each with its click id', () => {
    const fixture = TestBed.createComponent(ReflectionPromptComponent);
    fixture.detectChanges();
    const ids = [...fixture.nativeElement.querySelectorAll('.rp-actions button')]
      .map((b: HTMLElement) => b.getAttribute('data-log'));
    expect(ids).toEqual(['rationale.yes', 'rationale.no']);
  });

  it('drops them once sent', () => {
    const first = store.openReflections()[0].decisionSeq;
    const fixture = TestBed.createComponent(ReflectionPromptComponent);
    fixture.detectChanges();
    type(fixture);
    fixture.componentInstance.submit('yes');
    fixture.detectChanges();
    expect(store.reflectionDraft(first)).toBeNull();
    expect(fixture.componentInstance.selectedFactors().size).withContext('the next decision starts empty').toBe(0);
  });
});
