import { Injectable } from '@angular/core';
import { FlatlandScenarioJson, FlatlandScenarioSummary, ImportedFlatlandScenario } from './flatland-scenario.model';

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

  listSummaries(): FlatlandScenarioSummary[] {
    return this.readAll().map((entry) => ({
      id: entry.id,
      name: entry.name,
      updatedAt: entry.updatedAt,
      gridWidth: entry.data.gridDimensions?.cols ?? 0,
      gridHeight: entry.data.gridDimensions?.rows ?? 0,
      agentCount: entry.data.flatlandLine?.agent_positions?.length ?? 0,
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
