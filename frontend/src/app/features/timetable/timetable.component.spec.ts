import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AgentDTO, SessionState } from '../../core/models';
import { SessionStore } from '../../core/session.store';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { TimetableComponent } from './timetable.component';

/** The status column names its unit and says one step in the singular
 *  (docs/plans/plan-b-log-findings.md §4.5). */
describe('TimetableComponent — status', () => {
  afterEach(() => TestBed.resetTestingModule());

  function statuses(...agents: Partial<AgentDTO>[]): string[] {
    TestBed.configureTestingModule({
      imports: [TimetableComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(SessionStore).state.set({ agents: agents.map((a, handle) => ({ handle, ...a })) } as unknown as SessionState);
    return TestBed.createComponent(TimetableComponent).componentInstance.rows().map((r) => r.status);
  }

  it('names a breakdown and its unit', () => {
    expect(statuses(
      { is_malfunctioning: true, malfunction_remaining: 4, position: [1, 1] },
      { is_malfunctioning: true, malfunction_remaining: 1, position: [1, 2] },
    )).toEqual(['⚠ disruption, 4 steps left', '⚠ disruption, 1 step left']);
  });

  it('says one step in the singular', () => {
    expect(statuses(
      { eta_to_depart: 3 }, { eta_to_depart: 1 },
      { position: [1, 1], delay: 2 }, { position: [1, 2], delay: 1 },
    )).toEqual(['dep in 3 steps', 'dep in 1 step', '+2 steps late', '+1 step late']);
  });
});
