import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TourContextService } from '../../core/demo/tour-context.service';
import { OverviewLeg } from '../../core/shift-review';
import { ReflectionOverviewComponent } from './reflection-overview.component';

/** The overview Szenario | Ereignisse | Entscheidungen | Reflexion
 *  (docs/plans/plan-b-control-group.md §4.5, D-21). */
describe('ReflectionOverviewComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReflectionOverviewComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(TourContextService).scenarioPresets.set([
      { id: 'leg-a', name: 'A', width: 30, height: 30, agents: 2, train_names: ['A-0', 'A-1'] },
    ]);
  });

  const render = (legs: OverviewLeg[]) => {
    const fixture = TestBed.createComponent(ReflectionOverviewComponent);
    fixture.componentRef.setInput('legs', legs);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return [...el.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent!.replace(/\s+/g, ' ').trim()));
  };

  it('words each event as the TMS panel does, with the scenario\'s train names', () => {
    const [row] = render([{
      label: 'Scenario 1/2', scenarioId: 'leg-a',
      decisions: [{ step: 31, handle: 1, action: 'hold', reason: 'Vermeide Deadlock', reflection: { gut: 'fit' }, proposal: null,
        events: [{ code: 'train.malfunction', title: 'Malfunction', message: 'Train 0 …', params: { train: 0, steps: 8 } }] }],
    }]);
    expect(row[0]).toBe('Scenario 1/2');
    expect(row[1]).toContain('Step 31');
    expect(row[1]).toContain('A-0 is malfunctioning (8 steps remaining).');
    expect(row[2]).toContain('A-1');
    expect(row[3]).toContain('Vermeide Deadlock');
  });

  it('names the scenario once over its decisions, with "–" where nothing was open or said', () => {
    const decision = { step: 5, handle: 0, action: 'proceed' as const, reason: null, reflection: null, events: [], proposal: null };
    const rows = render([
      { label: 'Scenario 1/2', scenarioId: 'leg-a', decisions: [decision, { ...decision, step: 9 }] },
      { label: 'Scenario 2/2', scenarioId: 'leg-a', decisions: [] },
    ]);
    expect(rows.length).toBe(3);
    expect(rows[0].length).withContext('the scenario cell spans both decisions').toBe(4);
    expect(rows[1].length).toBe(3);
    expect(rows[1][0]).toBe('Step 9–'); // two block spans: the step, then "–"
    expect(rows[1][2]).toBe('–');
    expect(rows[2]).toEqual(['Scenario 2/2', '–', 'No interventions', '–']);
  });

  // "Plan behalten" logs as `proceed`, like the human's own "Weiterfahren".
  it('names a course taken in the Handlungsoptionen as its button does', () => {
    const decision = { step: 5, handle: 0, action: 'proceed' as const, reason: null, reflection: null, events: [], proposal: null };
    const rows = render([{
      label: 'Scenario 1/1', scenarioId: 'leg-a',
      decisions: [
        { ...decision, proposal: 'plan' },
        { ...decision, action: 'accept', proposal: 'ai' },
        decision,
      ],
    }]);
    // "Plan behalten" reads "Nicht eingreifen" since round 2 (plan-b-round2-general.md).
    expect(rows[0][2]).toBe('A-0 · Don’t intervene');
    expect(rows[1][1]).toBe('A-0 · Take the AI plan');
    expect(rows[2][1]).toBe('A-0 · Proceed');
  });

  // docs/plans/plan-b-control-group.md D-22
  it('leaves out the column "Reflexion" where the run asks for no reflection', () => {
    const fixture = TestBed.createComponent(ReflectionOverviewComponent);
    fixture.componentRef.setInput('legs', [{ label: 'Scenario 1/1', scenarioId: 'leg-a', decisions: [
      { step: 5, handle: 0, action: 'hold', reason: 'Vermeide Deadlock', reflection: null, events: [], proposal: null },
    ] }, { label: 'Scenario 2/2', scenarioId: 'leg-a', decisions: [] }]);
    fixture.componentRef.setInput('showReflection', false);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('thead th').length).toBe(3);
    expect(el.querySelector('.ro__title')!.textContent).toBe('Your decisions');
    expect(el.textContent).not.toContain('Vermeide Deadlock');
    expect([...el.querySelectorAll('tbody tr')].map((tr) => tr.children.length)).toEqual([3, 3]);
  });
});
