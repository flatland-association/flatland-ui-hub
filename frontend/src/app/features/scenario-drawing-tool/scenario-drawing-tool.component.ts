import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, EventEmitter, Output, ViewChild, inject, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { ConfigShellComponent } from '../config-shell/config-shell.component';
import { ApiService } from '../../core/api.service';
import { LanguageService } from '../../core/i18n/language.service';
import { FlatlandScenarioJson, ImportedFlatlandScenario } from '../../core/scenario-import/flatland-scenario.model';
import { FlatlandScenarioStorageService } from '../../core/scenario-import/flatland-scenario-storage.service';

/** Static filename the vendored tool's exportAllToJson() gives its download
 *  (flatland-drawing-tool.html) — used to recognise (and suppress) exactly
 *  that one save-as when we intercept it below. */
const EXPORT_ALL_JSON_FILENAME = 'drawn_environment_export.json';
const HOST_PKL_BUTTON_ID = 'hostPklDownloadButton';

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
export class ScenarioDrawingToolComponent implements AfterViewInit {
  private readonly storage = inject(FlatlandScenarioStorageService);
  private readonly api = inject(ApiService);
  private readonly i18n = inject(LanguageService);
  readonly importError = signal<string | null>(null);
  readonly docsOpen = signal(false);
  readonly pklError = signal<string | null>(null);

  @ViewChild('drawingFrame') private frameRef?: ElementRef<HTMLIFrameElement>;

  @Output() openSettingsRequested = new EventEmitter<void>();
  @Output() newSessionRequested = new EventEmitter<ImportedFlatlandScenario>();

  ngAfterViewInit(): void {
    this.frameRef?.nativeElement.addEventListener('load', () => this.injectPklButton());
  }

  openDocs(): void {
    this.docsOpen.set(true);
  }

  closeDocs(): void {
    this.docsOpen.set(false);
  }

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

    if (!this.isValidScenario(parsed)) {
      this.importError.set('missing gridDimensions/grid/flatlandLine/flatlandTimetable');
      return;
    }

    const entry = this.storage.save(parsed, fileName.replace(/\.json$/i, ''));
    this.newSessionRequested.emit(entry);
  }

  private isValidScenario(parsed: unknown): parsed is FlatlandScenarioJson {
    const candidate = parsed as Partial<FlatlandScenarioJson> | null | undefined;
    return !!(candidate?.gridDimensions && Array.isArray(candidate.grid) && candidate.flatlandLine && candidate.flatlandTimetable);
  }

  /** Inserts a "Download .pkl" button into the same-origin iframe, right next
   *  to the vendored tool's own "Flatland Download" button. Depends on that
   *  file's `#flatlandDownloadButton` / `#exportAllJsonButton` ids and the
   *  static "drawn_environment_export.json" export filename (both in
   *  frontend/public/vendor/flatland-drawing-tool.html) — if a future
   *  re-vendor changes either, this silently no-ops (the button just isn't
   *  inserted) rather than breaking the page. Re-check this method whenever
   *  that file is re-vendored. */
  private injectPklButton(): void {
    const frame = this.frameRef?.nativeElement;
    let doc: Document | null | undefined;
    try {
      doc = frame?.contentDocument;
    } catch {
      return; // not same-origin — shouldn't happen for our own vendored asset
    }
    if (!doc || doc.getElementById(HOST_PKL_BUTTON_ID)) {
      return;
    }

    const flatlandButton = doc.getElementById('flatlandDownloadButton');
    const exportButton = doc.getElementById('exportAllJsonButton') as HTMLButtonElement | null;
    if (!flatlandButton || !exportButton) {
      return;
    }

    const button = doc.createElement('button');
    button.id = HOST_PKL_BUTTON_ID;
    button.type = 'button';
    button.className = flatlandButton.className;
    button.textContent = this.i18n.t('scenarioDrawingTool.pkl.injectedLabel', undefined, 'Download .pkl');
    button.title = this.i18n.t(
      'scenarioDrawingTool.pkl.injectedTitle',
      undefined,
      'Build a Flatland RailEnv .pkl from the current network and download it.',
    );
    flatlandButton.insertAdjacentElement('afterend', button);

    button.addEventListener('click', () => this.onInjectedPklClick(button, exportButton));
  }

  /** Triggers the tool's own "Export All" button to get the current in-memory
   *  scenario (reusing its real construction logic, not a reimplementation),
   *  but intercepts the Blob it would have saved instead of letting that
   *  save-as happen, then posts that JSON to our .pkl endpoint. Both
   *  monkey-patches are scoped to this one synchronous click and restored in
   *  a `finally` — exportAllToJson() has no async step in between. */
  private onInjectedPklClick(button: HTMLButtonElement, exportButton: HTMLButtonElement): void {
    const win = this.frameRef?.nativeElement.contentWindow;
    if (!win || button.disabled) {
      return;
    }

    const originalLabel = button.textContent;
    const restoreButton = () => {
      button.disabled = false;
      button.textContent = originalLabel;
    };

    button.disabled = true;
    button.textContent = this.i18n.t('scenarioDrawingTool.pkl.downloading', undefined, 'Building .pkl…');
    this.pklError.set(null);

    let capturedBlob: Blob | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- foreign realm (iframe window), not our own DOM lib types
    const frameWin = win as any;
    const originalCreateObjectURL = frameWin.URL.createObjectURL.bind(frameWin.URL);
    const originalAnchorClick = frameWin.HTMLAnchorElement.prototype.click;

    frameWin.URL.createObjectURL = (obj: unknown): string => {
      // The Blob passed here was constructed inside the iframe's own realm,
      // so it is an instance of *that* window's Blob, not this file's — a
      // plain `obj instanceof Blob` (host realm) silently never matches.
      if (obj instanceof frameWin.Blob) {
        capturedBlob = obj as Blob;
      }
      return originalCreateObjectURL(obj);
    };
    frameWin.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
      if (this.download === EXPORT_ALL_JSON_FILENAME) {
        return; // suppress only this one known save-as; anything else behaves normally
      }
      originalAnchorClick.call(this);
    };

    try {
      exportButton.click();
    } finally {
      frameWin.URL.createObjectURL = originalCreateObjectURL;
      frameWin.HTMLAnchorElement.prototype.click = originalAnchorClick;
    }

    if (!capturedBlob) {
      this.pklError.set(this.i18n.t('scenarioDrawingTool.pkl.captureError', undefined, 'Could not read the current network from the drawing tool.'));
      restoreButton();
      return;
    }

    (capturedBlob as Blob)
      .text()
      .then((text) => {
        const parsed = JSON.parse(text);
        if (!this.isValidScenario(parsed)) {
          throw new Error('missing gridDimensions/grid/flatlandLine/flatlandTimetable');
        }
        return this.requestPkl(parsed, 'drawn_environment');
      })
      .catch((error) => this.pklError.set((error as Error).message))
      .finally(restoreButton);
  }

  /** Same end result as the drawing tool's own "Flatland Download" button +
   *  running that script locally (a RailEnvPersister .pkl) — built
   *  server-side from the JSON instead, see ApiService.flatlandScenarioToPkl. */
  private requestPkl(json: FlatlandScenarioJson, filename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.api.flatlandScenarioToPkl(json, filename).subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${filename}.pkl`;
          a.click();
          URL.revokeObjectURL(url);
          resolve();
        },
        error: (err) => this.extractErrorDetail(err).then((detail) => reject(new Error(detail))),
      });
    });
  }

  /** With `responseType: 'blob'`, HttpClient hands an error body back as a
   *  Blob too — read it as text to surface FastAPI's {"detail": "..."}. */
  private async extractErrorDetail(err: unknown): Promise<string> {
    const httpError = err as { error?: unknown; message?: string };
    if (httpError?.error instanceof Blob) {
      try {
        const text = await httpError.error.text();
        return (JSON.parse(text) as { detail?: string })?.detail ?? text;
      } catch {
        // fall through to the generic message below
      }
    }
    return httpError?.message ?? 'download failed';
  }
}
