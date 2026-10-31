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
  let log: {
    savedRecords: ReturnType<typeof signal<unknown[]>>;
    importedRecords: ReturnType<typeof signal<SessionRecord[]>>;
    loadSavedRecords: jasmine.Spy;
    exportRecords: jasmine.Spy;
    deleteSaved: jasmine.Spy;
    addImported: jasmine.Spy;
  };

  beforeEach(() => {
    const records = [rec('a', 1, 'run-x'), rec('b', 2, 'run-x'), rec('f', 3)];
    log = {
      savedRecords: signal<unknown[]>(records),
      importedRecords: signal<SessionRecord[]>([]),
      loadSavedRecords: jasmine.createSpy('loadSavedRecords').and.callFake(() => [...records, ...log.importedRecords()]),
      exportRecords: jasmine.createSpy('exportRecords').and.resolveTo(),
      deleteSaved: jasmine.createSpy('deleteSaved'),
      addImported: jasmine.createSpy('addImported').and.callFake((rs: SessionRecord[]) => {
        log.importedRecords.update((l) => [...l, ...rs]);
        return rs.length;
      }),
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

  it('imports files into the list, marked as imported', async () => {
    const fixture = TestBed.createComponent(SavedRunsListComponent);
    fixture.detectChanges();
    const input = document.createElement('input');
    input.type = 'file';
    const dt = new DataTransfer();
    dt.items.add(new File([JSON.stringify({ ...rec('m', 9, 'run-m'), schema: 'flatland-session-record' })], 'm.json'));
    dt.items.add(new File(['x'], 'bad.json'));
    input.files = dt.files;
    await fixture.componentInstance.importChosen(input);
    fixture.detectChanges();
    expect(fixture.componentInstance.importNote()).toEqual({ added: 1, failed: ['bad.json'] });
    const run = fixture.componentInstance.runs().find((r) => r.key === 'run-m')!;
    expect(fixture.componentInstance.imported(run)).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('.saved-runs__badge').length).toBe(1);
  });
});
