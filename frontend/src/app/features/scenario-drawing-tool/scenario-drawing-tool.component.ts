import { CommonModule } from '@angular/common';
import { AfterViewInit, Component, CUSTOM_ELEMENTS_SCHEMA, ElementRef, EventEmitter, OnInit, Output, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { ConfigShellComponent } from '../config-shell/config-shell.component';
import { ApiService } from '../../core/api.service';
import { LanguageService } from '../../core/i18n/language.service';
import {
  FlatlandScenarioJson,
  FlatlandScenarioSummary,
  ImportedFlatlandScenario,
  isFlatlandScenarioJson,
} from '../../core/scenario-import/flatland-scenario.model';
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
  imports: [CommonModule, FormsModule, TranslocoPipe, ConfigShellComponent],
  templateUrl: './scenario-drawing-tool.component.html',
  styleUrl: './scenario-drawing-tool.component.scss',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
})
export class ScenarioDrawingToolComponent implements OnInit, AfterViewInit {
  private readonly storage = inject(FlatlandScenarioStorageService);
  private readonly api = inject(ApiService);
  private readonly i18n = inject(LanguageService);
  readonly docsOpen = signal(false);
  readonly pklError = signal<string | null>(null);

  readonly scenes = signal<FlatlandScenarioSummary[]>([]);
  readonly activeSceneId = signal<string | null>(null);
  readonly sceneBusy = signal(false);
  readonly sceneMessage = signal<string | null>(null);
  readonly sceneError = signal<string | null>(null);

  @ViewChild('drawingFrame') private frameRef?: ElementRef<HTMLIFrameElement>;

  @Output() openSettingsRequested = new EventEmitter<void>();
  @Output() newSessionRequested = new EventEmitter<ImportedFlatlandScenario>();

  ngOnInit(): void {
    this.refreshScenes();
  }

  ngAfterViewInit(): void {
    this.frameRef?.nativeElement.addEventListener('load', () => this.injectPklButton());
  }

  openDocs(): void {
    this.docsOpen.set(true);
  }

  closeDocs(): void {
    this.docsOpen.set(false);
  }

  private isValidScenario(parsed: unknown): parsed is FlatlandScenarioJson {
    return isFlatlandScenarioJson(parsed);
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

    button.addEventListener('click', () => this.onInjectedPklClick(button));
  }

  private onInjectedPklClick(button: HTMLButtonElement): void {
    if (button.disabled) {
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

    this.captureCurrentScenario()
      .then((parsed) => this.requestPkl(parsed, 'drawn_environment'))
      .catch((error) => this.pklError.set((error as Error).message))
      .finally(restoreButton);
  }

  /** Triggers the tool's own "Export All" button to get the current in-memory
   *  scenario (reusing its real construction logic, not a reimplementation),
   *  but intercepts the Blob it would have saved instead of letting that
   *  save-as happen. Shared by the injected "Download .pkl" button and the
   *  scene toolbar's Save/Save As — both need "what's on the canvas right
   *  now" without a manual export/import round trip. Both monkey-patches are
   *  scoped to this one synchronous click and restored in a `finally` —
   *  exportAllToJson() has no async step in between. */
  private captureCurrentScenario(): Promise<FlatlandScenarioJson> {
    const win = this.frameRef?.nativeElement.contentWindow;
    const doc = this.frameRef?.nativeElement.contentDocument;
    const exportButton = doc?.getElementById('exportAllJsonButton') as HTMLButtonElement | null;
    if (!win || !exportButton) {
      return Promise.reject(new Error(this.i18n.t('scenarioDrawingTool.scenes.captureError', undefined, 'Could not read the current network from the drawing tool.')));
    }

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
      return Promise.reject(new Error(this.i18n.t('scenarioDrawingTool.scenes.captureError', undefined, 'Could not read the current network from the drawing tool.')));
    }

    return (capturedBlob as Blob).text().then((text) => {
      const parsed = JSON.parse(text);
      if (!this.isValidScenario(parsed)) {
        throw new Error('missing gridDimensions/grid/flatlandLine/flatlandTimetable');
      }
      return parsed;
    });
  }

  // --- Scene manager toolbar (New/Save/Save As/Delete/Export/Import/Clear) ---
  // Mirrors the deleted builder-scene-manager component's behaviour, backed by
  // FlatlandScenarioStorageService instead of InfrastructureSceneStorageService.
  // Deliberately no dirty-state tracking: unlike the old builder, the live
  // scene lives entirely inside the iframe, not mirrored into an Angular
  // store, so Save/Save As always just capture-and-persist current state.

  private refreshScenes(): void {
    this.scenes.set(this.storage.listSummaries());
  }

  private flashMessage(message: string): void {
    this.sceneMessage.set(message);
    setTimeout(() => {
      if (this.sceneMessage() === message) {
        this.sceneMessage.set(null);
      }
    }, 3000);
  }

  /** Resets the iframe's own grid via its own "Clear Grid" button (reusing
   *  its native confirm dialog, intercepted only to learn whether the user
   *  actually confirmed) and forgets which scene is active, so the next Save
   *  creates a new entry rather than overwriting the one just cleared. */
  newScene(): void {
    const doc = this.frameRef?.nativeElement.contentDocument;
    const win = this.frameRef?.nativeElement.contentWindow;
    const button = doc?.getElementById('clearGridButton') as HTMLButtonElement | null;
    if (!win || !button) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- foreign realm
    const frameWin = win as any;
    const originalConfirm = frameWin.confirm;
    let confirmed = false;
    frameWin.confirm = (message?: string): boolean => {
      confirmed = originalConfirm.call(frameWin, message);
      return confirmed;
    };

    try {
      button.click();
    } finally {
      frameWin.confirm = originalConfirm;
    }

    if (confirmed) {
      this.activeSceneId.set(null);
    }
  }

  saveChanges(): void {
    this.sceneBusy.set(true);
    this.sceneError.set(null);
    this.captureCurrentScenario()
      .then((data) => {
        const id = this.activeSceneId();
        const updated = id ? this.storage.update(id, data) : undefined;
        const saved = updated ?? this.promptAndSave(data);
        if (saved) {
          this.activeSceneId.set(saved.id);
          this.refreshScenes();
          this.flashMessage(this.i18n.t('scenarioDrawingTool.scenes.saved', { name: saved.name }, `Saved "${saved.name}".`));
        }
      })
      .catch((error) => this.sceneError.set((error as Error).message))
      .finally(() => this.sceneBusy.set(false));
  }

  saveAs(): void {
    this.sceneBusy.set(true);
    this.sceneError.set(null);
    this.captureCurrentScenario()
      .then((data) => {
        const saved = this.promptAndSave(data);
        if (saved) {
          this.activeSceneId.set(saved.id);
          this.refreshScenes();
          this.flashMessage(this.i18n.t('scenarioDrawingTool.scenes.saved', { name: saved.name }, `Saved "${saved.name}".`));
        }
      })
      .catch((error) => this.sceneError.set((error as Error).message))
      .finally(() => this.sceneBusy.set(false));
  }

  private promptAndSave(data: FlatlandScenarioJson): ImportedFlatlandScenario | undefined {
    const name = window.prompt(this.i18n.t('scenarioDrawingTool.scenes.namePrompt', undefined, 'Name this scene:'), '');
    if (name === null) {
      return undefined; // cancelled
    }
    return this.storage.save(data, name);
  }

  deleteScene(): void {
    const id = this.activeSceneId();
    if (!id) {
      return;
    }
    const name = this.scenes().find((scene) => scene.id === id)?.name ?? '';
    if (!window.confirm(this.i18n.t('scenarioDrawingTool.scenes.deleteConfirm', { name }, `Delete "${name}"? This cannot be undone.`))) {
      return;
    }
    this.storage.delete(id);
    this.activeSceneId.set(null);
    this.refreshScenes();
  }

  /** Pushes a previously-saved scene back into the live tool via its own
   *  importAllFromJson() — a plain top-level function in the vendored file,
   *  reachable on the iframe's window since it's same-origin, so no manual
   *  file round trip is needed. */
  loadScene(id: string | null): void {
    if (!id) {
      this.activeSceneId.set(null);
      return;
    }
    const data = this.storage.get(id);
    const win = this.frameRef?.nativeElement.contentWindow;
    if (!data || !win) {
      this.sceneError.set(this.i18n.t('scenarioDrawingTool.scenes.loadError', undefined, 'Could not load that scene.'));
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- foreign realm
    (win as any).importAllFromJson?.(JSON.stringify(data));
    this.activeSceneId.set(id);
  }

  exportAllScenes(): void {
    const payload = this.storage.exportAll();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flatland-scenario-scenes.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  onImportScenesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.sceneError.set(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(String(reader.result ?? ''));
        const imported = this.storage.importMany(payload);
        this.refreshScenes();
        if (imported.length) {
          this.loadScene(imported[imported.length - 1].id);
        }
        this.flashMessage(this.i18n.t('scenarioDrawingTool.scenes.imported', { count: imported.length }, `Imported ${imported.length} scene(s).`));
      } catch (error) {
        this.sceneError.set((error as Error).message);
      }
    };
    reader.onerror = () => this.sceneError.set(reader.error?.message ?? 'read failed');
    reader.readAsText(file);
    input.value = '';
  }

  clearAllScenes(): void {
    if (!window.confirm(this.i18n.t('scenarioDrawingTool.scenes.clearAllConfirm', undefined, 'Delete all locally-saved scenes? This cannot be undone.'))) {
      return;
    }
    this.storage.clearAll();
    this.activeSceneId.set(null);
    this.refreshScenes();
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
