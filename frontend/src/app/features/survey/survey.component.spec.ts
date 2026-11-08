import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PLAN_B_FINAL_PART } from '../../core/survey/survey-configs';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { SurveyComponent } from './survey.component';

/** A paged, fully required questionnaire (docs/plans/experiment-scenario-import.md §3.10). */
describe('SurveyComponent — paged and required', () => {
  let fixture: ComponentFixture<SurveyComponent>;
  let c: SurveyComponent;
  let submitted: number;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SurveyComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    fixture = TestBed.createComponent(SurveyComponent);
    fixture.componentRef.setInput('parts', [PLAN_B_FINAL_PART]);
    fixture.componentRef.setInput('embedded', true);
    c = fixture.componentInstance;
    submitted = 0;
    c.submitted.subscribe(() => submitted++);
    fixture.detectChanges();
  });

  const el = (sel: string) => fixture.nativeElement.querySelector(sel) as HTMLElement | null;
  const answerPage = () => {
    for (const sec of c.pageSections()) {
      for (const q of sec.questions) {
        c.setAnswer(q.id, q.type === 'radio' ? q.options![0] : q.type === 'number' ? (q.min ?? 0) + 1 : q.type === 'percent' ? 0 : 1);
      }
    }
  };

  it('shows page 1 of 6 without close or cancel, and no way back', () => {
    expect(c.pages().length).toBe(6);
    expect(el('.survey-progress')!.textContent).toContain('Page 1 of 6');
    expect(el('.survey-close')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Cancel');
    expect(fixture.nativeElement.textContent).not.toContain('Back');
  });

  it('does not go on while an item is open, and marks it until answered', () => {
    c.setAnswer('pb_1', 4);
    c.next();
    fixture.detectChanges();
    expect(c.pageIndex()).toBe(0);
    expect([...c.missing()]).toEqual(['pb_2', 'pb_3', 'pb_4']);
    expect(el('.survey-missing')).not.toBeNull();
    c.setAnswer('pb_2', 2);
    expect(c.missing().has('pb_2')).toBeFalse();
  });

  it('counts the share only once set: 0 % is an answer, not a default', () => {
    expect(c.isAnswered(c.config().sections[1].questions[0])).toBeFalse();
    c.setPercent('pb_4', '0');
    expect(c.answers()['pb_4']).toBe(0);
    expect(c.isAnswered(c.config().sections[1].questions[0])).toBeTrue();
    c.setPercent('pb_4', '140');
    expect(c.answers()['pb_4']).toBe(100);
  });

  it('goes forward and back, keeping the answers', () => {
    answerPage();
    c.next();
    expect(c.pageIndex()).toBe(1);
    c.back();
    expect(c.pageIndex()).toBe(0);
    expect(c.answers()['pb_1']).toBe(1);
  });

  it('takes a number only within its range', () => {
    const age = c.config().sections.flatMap((s) => s.questions).find((q) => q.id === 'pb_age')!;
    c.setNumber('pb_age', '7');
    expect(c.isAnswered(age)).toBeFalse();
    c.setNumber('pb_age', '42');
    expect(c.isAnswered(age)).toBeTrue();
    c.setNumber('pb_age', '');
    expect(c.isAnswered(age)).toBeFalse();
  });

  it('submits only with every page answered, and offers submit on the last page', () => {
    for (let i = 0; i < 5; i++) {
      answerPage();
      c.next();
    }
    fixture.detectChanges();
    expect(c.isLastPage()).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('Submit');
    c.submit();
    expect(submitted).toBe(0);
    answerPage();
    c.submit();
    expect(submitted).toBe(1);
  });

  it('renders the agreement items as a matrix of radio inputs', () => {
    const rows = fixture.nativeElement.querySelectorAll('.q-matrix tbody tr');
    expect(rows.length).toBe(3);
    expect(rows[0].querySelectorAll('input[type=radio]').length).toBe(7);
  });
});
