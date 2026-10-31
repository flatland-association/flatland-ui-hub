import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideTranslocoTesting } from '../../testing/transloco-testing';
import { InteractionLogService } from '../../core/interaction-log/interaction-log.service';
import type { SessionRecord } from '../../core/interaction-log/session-record';
import { SavedRunsListComponent } from './saved-runs-list.component';

function rec(sessionId: string, startedAt: number, runId?: string): SessionRecord {
  return {
    header: { sessionId, startedAt, endedAt: startedAt + 60_000, mode: 'co-learning', conditionId: 'plan-b-p03', conditionLabel: 'Plan B', experimentRunId: runId, legIndex: 0 },
    surveys: [],
  } as unknown as SessionRecord;
}

describe('SavedRunsListComponent', () => {
  let log: { savedRecords: ReturnType<typeof signal<unknown[]>>; loadSavedRecords: jasmine.Spy; exportRecords: jasmine.Spy; deleteSaved: jasmine.Spy };

  beforeEach(() => {
    const records = [rec('a', 1, 'run-x'), rec('b', 2, 'run-x'), rec('f', 3)];
    log = {
      savedRecords: signal<unknown[]>(records),
      loadSavedRecords: jasmine.createSpy('loadSavedRecords').and.returnValue(records),
      exportRecords: jasmine.createSpy('exportRecords').and.resolveTo(),
      deleteSaved: jasmine.createSpy('deleteSaved'),
    };
    TestBed.configureTestingModule({
      imports: [SavedRunsListComponent],
      providers: [provideTranslocoTesting(), { provide: InteractionLogService, useValue: log }],
    });
  });

  it('lists the runs and acts on the selected one only', async () => {
    const fixture = TestBed.createComponent(SavedRunsListComponent);
    fixture.detectChanges();
    const list = fixture.componentInstance;
    expect(list.runs().length).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.saved-runs__run').length).toBe(2);

    list.toggle(list.runs().find((r) => r.key === 'run-x')!, true);
    expect(list.selectedSessions()).toBe(2);
    await list.download();
    expect(log.exportRecords.calls.mostRecent().args[0].map((r: SessionRecord) => r.header.sessionId)).toEqual(['a', 'b']);

    spyOn(window, 'confirm').and.returnValue(true);
    list.deleteSelected();
    expect(log.deleteSaved).toHaveBeenCalledWith(['a', 'b']);
    expect(list.selected().size).toBe(0);
  });

  it('select all selects every run', () => {
    const fixture = TestBed.createComponent(SavedRunsListComponent);
    fixture.detectChanges();
    fixture.componentInstance.toggleAll(true);
    expect(fixture.componentInstance.allSelected()).toBeTrue();
  });
});
