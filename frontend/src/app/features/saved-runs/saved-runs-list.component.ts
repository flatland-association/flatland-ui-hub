import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { LanguageService } from '../../core/i18n/language.service';
import { InteractionLogService } from '../../core/interaction-log/interaction-log.service';
import { importFiles } from '../../core/interaction-log/record-import';
import { SavedRun, groupRuns, runFileStem, utcStamp } from '../../core/interaction-log/saved-runs';
import type { SessionRecord } from '../../core/interaction-log/session-record';
import { questionnaireZip } from '../../core/survey/survey-export';

/**
 * The sessions saved in this browser, grouped into runs, with a selection
 * (docs/plans/experiment-logging-frontend-and-replay.md §5.6): download the
 * data, export the questionnaires as xlsx, delete; and import other
 * machines' export files, in memory, to combine them (step 22). Lives on the
 * start screen in place of the "N saved sessions" line.
 */
@Component({
  selector: 'app-saved-runs-list',
  standalone: true,
  imports: [TranslocoPipe],
  templateUrl: './saved-runs-list.component.html',
  styleUrl: './saved-runs-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SavedRunsListComponent {
  private readonly log = inject(InteractionLogService);
  private readonly i18n = inject(LanguageService);

  /** The records, re-read when the saved index or the imports change (a session saved, a delete, an import). */
  private readonly records = computed<SessionRecord[]>(() => {
    this.log.savedRecords();
    this.log.importedRecords();
    return this.log.loadSavedRecords();
  });
  private readonly importedIds = computed(() => new Set(this.log.importedRecords().map((r) => r.header.sessionId)));
  readonly runs = computed<SavedRun[]>(() => groupRuns(this.records()));
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly selectedRuns = computed(() => this.runs().filter((r) => this.selected().has(r.key)));
  readonly selectedSessions = computed(() => this.selectedRuns().reduce((n, r) => n + r.legs.length, 0));
  readonly allSelected = computed(() => this.runs().length > 0 && this.selectedRuns().length === this.runs().length);
  readonly busy = signal(false);
  /** The outcome of the last import, shown under the buttons. */
  readonly importNote = signal<{ added: number; failed: string[] } | null>(null);

  imported(run: SavedRun): boolean {
    return run.legs.every((l) => this.importedIds().has(l.header.sessionId));
  }

  async importChosen(input: HTMLInputElement): Promise<void> {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const { records, failed } = await importFiles(files);
    this.importNote.set({ added: this.log.addImported(records), failed: failed.map((f) => f.file) });
  }

  toggle(run: SavedRun, on: boolean): void {
    const next = new Set(this.selected());
    if (on) next.add(run.key);
    else next.delete(run.key);
    this.selected.set(next);
  }

  toggleAll(on: boolean): void {
    this.selected.set(new Set(on ? this.runs().map((r) => r.key) : []));
  }

  title(run: SavedRun): string {
    if (run.kind === 'condition') return run.label ? `${run.label} (${run.what})` : run.what;
    if (run.kind === 'tour') return `${this.i18n.t('savedRuns.kind.tour')} ${run.what.slice('tour-'.length)}`;
    return this.i18n.t('savedRuns.kind.free');
  }

  time(t: number): string {
    return new Date(t).toLocaleString(this.i18n.lang(), { dateStyle: 'short', timeStyle: 'short' });
  }

  minutes(from: number, to: number | null): number | null {
    return to == null ? null : Math.max(0, Math.round((to - from) / 60000));
  }

  async download(): Promise<void> {
    await this.log.exportRecords(this.selectedRuns().flatMap((r) => r.legs));
  }

  async questionnaires(): Promise<void> {
    const runs = this.selectedRuns();
    if (!runs.length) return;
    this.busy.set(true);
    try {
      const blob = await questionnaireZip(runs.map((r) => ({ stem: runFileStem(r), records: r.legs })));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${utcStamp(Date.now())}_questionnaires.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } finally {
      this.busy.set(false);
    }
  }

  deleteSelected(): void {
    const ids = this.selectedRuns().flatMap((r) => r.legs.map((l) => l.header.sessionId));
    if (!ids.length || !window.confirm(this.i18n.t('savedRuns.confirmDelete', { count: ids.length }))) return;
    this.log.deleteSaved(ids);
    this.selected.set(new Set());
  }
}
