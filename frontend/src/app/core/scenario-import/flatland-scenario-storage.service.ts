import { Injectable } from '@angular/core';
import {
  FlatlandScenarioExport,
  FlatlandScenarioJson,
  FlatlandScenarioSummary,
  ImportedFlatlandScenario,
  isFlatlandScenarioJson,
} from './flatland-scenario.model';

const SCENARIOS_KEY = 'flatland.scenario.imports.v1';

/** localStorage-backed, mirroring InfrastructureSceneStorageService's shape
 *  but for flatland-scenarios JSON imports instead of InfrastructureScene. */
@Injectable({ providedIn: 'root' })
export class FlatlandScenarioStorageService {
  list(): ImportedFlatlandScenario[] {
    return this.readAll();
  }

  get(id: string): FlatlandScenarioJson | undefined {
    return this.readAll().find((entry) => entry.id === id)?.data;
  }

  save(data: FlatlandScenarioJson, name?: string): ImportedFlatlandScenario {
    const all = this.readAll();
    const entry: ImportedFlatlandScenario = {
      id: `scenario_${Date.now()}`,
      name: name?.trim() || `Imported scenario ${new Date().toLocaleString()}`,
      updatedAt: new Date().toISOString(),
      data,
    };
    all.push(entry);
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(all));
    return entry;
  }

  delete(id: string): void {
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(this.readAll().filter((entry) => entry.id !== id)));
  }

  /** Overwrites an existing entry's data (and optionally its name) in place,
   *  keeping its id — backs the scene toolbar's "Save changes". Returns
   *  undefined if `id` no longer exists (e.g. deleted in another tab). */
  update(id: string, data: FlatlandScenarioJson, name?: string): ImportedFlatlandScenario | undefined {
    const all = this.readAll();
    const index = all.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return undefined;
    }
    const entry: ImportedFlatlandScenario = {
      ...all[index],
      name: name?.trim() || all[index].name,
      updatedAt: new Date().toISOString(),
      data,
    };
    all[index] = entry;
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(all));
    return entry;
  }

  /** All locally-saved scenes as one downloadable file — backs "Export all
   *  scenes JSON". */
  exportAll(): FlatlandScenarioExport {
    return { version: 1, exportedAt: new Date().toISOString(), scenes: this.readAll() };
  }

  /** Imports a bulk export written by exportAll(), backing "Import all scenes
   *  JSON". Entries get fresh ids (avoids colliding with anything already
   *  stored); name/updatedAt are kept as exported. Throws on a malformed
   *  payload; silently drops individual entries whose `data` isn't a usable
   *  scenario (e.g. a foreign/legacy export mixed into the same file) rather
   *  than storing an unusable entry that would crash listSummaries() later. */
  importMany(payload: unknown): ImportedFlatlandScenario[] {
    const candidate = payload as Partial<FlatlandScenarioExport> | null | undefined;
    if (!candidate || !Array.isArray(candidate.scenes)) {
      throw new Error("JSON file must contain a 'scenes' array.");
    }

    const imported: ImportedFlatlandScenario[] = candidate.scenes
      .filter((scene) => isFlatlandScenarioJson(scene?.data))
      .map((scene, index) => ({
        id: `scenario_${Date.now()}_${index}`,
        name: scene?.name?.trim() || `Imported scenario ${index + 1}`,
        updatedAt: scene?.updatedAt ?? new Date().toISOString(),
        data: scene.data as FlatlandScenarioJson,
      }));

    if (!imported.length && candidate.scenes.length) {
      throw new Error('No valid scenes found in that file.');
    }

    const all = [...this.readAll(), ...imported];
    localStorage.setItem(SCENARIOS_KEY, JSON.stringify(all));
    return imported;
  }

  /** Deletes every locally-saved scene — backs "Clear All Scenes". */
  clearAll(): void {
    localStorage.removeItem(SCENARIOS_KEY);
  }

  listSummaries(): FlatlandScenarioSummary[] {
    return this.readAll().map((entry) => ({
      id: entry.id,
      name: entry.name,
      updatedAt: entry.updatedAt,
      gridWidth: entry.data?.gridDimensions?.cols ?? 0,
      gridHeight: entry.data?.gridDimensions?.rows ?? 0,
      agentCount: entry.data?.flatlandLine?.agent_positions?.length ?? 0,
    }));
  }

  private readAll(): ImportedFlatlandScenario[] {
    try {
      const raw = localStorage.getItem(SCENARIOS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
