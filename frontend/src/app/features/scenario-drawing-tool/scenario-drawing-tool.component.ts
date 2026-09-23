import { CommonModule } from '@angular/common';
import { Component, CUSTOM_ELEMENTS_SCHEMA, EventEmitter, Output, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ConfigShellComponent } from '../config-shell/config-shell.component';
import { FlatlandScenarioJson, ImportedFlatlandScenario } from '../../core/scenario-import/flatland-scenario.model';
import { FlatlandScenarioStorageService } from '../../core/scenario-import/flatland-scenario-storage.service';

/** Iframes the vendored flatland-scenarios drawing tool (frontend/public/vendor/,
 *  see its SOURCE.md) rather than reimplementing a scenario editor. Phase 1:
 *  file-based JSON import only — the tool runs standalone; use its own
 *  "Export All (.json)" button, then import the file here. A live postMessage
 *  bridge is deferred to a later change. */
@Component({
  selector: 'app-scenario-drawing-tool',
  standalone: true,
  imports: [CommonModule, TranslocoPipe, ConfigShellComponent],
  templateUrl: './scenario-drawing-tool.component.html',
  styleUrl: './scenario-drawing-tool.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ScenarioDrawingToolComponent {
  private readonly storage = inject(FlatlandScenarioStorageService);
  readonly importError = signal<string | null>(null);

  @Output() openSettingsRequested = new EventEmitter<void>();
  @Output() newSessionRequested = new EventEmitter<ImportedFlatlandScenario>();

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.importError.set(null);
    const reader = new FileReader();
    reader.onload = () => this.handleFileContents(String(reader.result ?? ''), file.name);
    reader.onerror = () => this.importError.set(reader.error?.message ?? 'read failed');
    reader.readAsText(file);
    input.value = '';
  }

  private handleFileContents(json: string, fileName: string): void {
    let parsed: FlatlandScenarioJson;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      this.importError.set((error as Error).message);
      return;
    }

    if (!parsed?.gridDimensions || !Array.isArray(parsed.grid) || !parsed.flatlandLine || !parsed.flatlandTimetable) {
      this.importError.set('missing gridDimensions/grid/flatlandLine/flatlandTimetable');
      return;
    }

    const entry = this.storage.save(parsed, fileName.replace(/\.json$/i, ''));
    this.newSessionRequested.emit(entry);
  }
}
