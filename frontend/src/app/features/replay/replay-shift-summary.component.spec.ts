import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { ReplayService } from '../../core/replay/replay.service';
import type { SessionRecord } from '../../core/interaction-log/session-record';
import { ReplayShiftSummaryComponent } from './replay-shift-summary.component';

/** A recorded session with one decision on a train; `legId` set for an experiment's leg. */
function record(legId: string | null, scenarioId = 'leg-a'): SessionRecord {
  return {
    header: { sessionId: `s-${legId}`, startedAt: 1, legId, scenarioId },
    decisions: [{ seq: 1, t: 0, simStep: 12, mode: 'co-learning', handle: 0, accountableOwner: 'human', action: 'hold', aiSuggestion: null, decisionTimeMs: 1 }],
    states: [],
  } as unknown as SessionRecord;
}

/** The replay's Schichtbilanz (docs/plans/plan-b-control-group.md §4.5, F-7). */
describe('ReplayShiftSummaryComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [ReplayShiftSummaryComponent],
      providers: [...provideTranslocoTesting(), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  const render = (records: SessionRecord[]) => {
    TestBed.inject(ReplayService).legs.set(records);
    const fixture = TestBed.createComponent(ReplayShiftSummaryComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('shows the reflection overview in the replay of an experiment', () => {
    const el = render([record('leg-a'), record('leg-b', 'leg-b')]);
    const rows = el.querySelectorAll('app-reflection-overview tbody tr');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('Step 12');
  });

  it('shows none in the replay of a tour, as live', () => {
    const el = render([record(null)]);
    expect(el.querySelector('.replay-summary__table')).not.toBeNull();
    expect(el.querySelector('app-reflection-overview')).toBeNull();
  });
});
