import { TestBed } from '@angular/core/testing';
import { FlatlandScenarioJson } from './flatland-scenario.model';
import { FlatlandScenarioStorageService } from './flatland-scenario-storage.service';

function scenarioFixture(agentCount = 1): FlatlandScenarioJson {
  return {
    gridDimensions: { rows: 2, cols: 2 },
    grid: [
      [0, 0],
      [0, 0],
    ],
    flatlandLine: {
      agent_positions: Array.from({ length: agentCount }, () => [[[0, 0]]]),
      agent_directions: Array.from({ length: agentCount }, () => [[0]]),
      agent_targets: Array.from({ length: agentCount }, () => [1, 1]),
      agent_speeds: Array.from({ length: agentCount }, () => 1),
    },
    flatlandTimetable: {
      earliest_departures: Array.from({ length: agentCount }, () => [0, 0]),
      latest_arrivals: Array.from({ length: agentCount }, () => [0, 20]),
      max_episode_steps: 40,
    },
  };
}

describe('FlatlandScenarioStorageService', () => {
  let svc: FlatlandScenarioStorageService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    svc = TestBed.inject(FlatlandScenarioStorageService);
    // localStorage-backed, so it survives between specs; start clean.
    svc.clearAll();
  });

  afterEach(() => {
    svc.clearAll();
  });

  describe('update', () => {
    it('overwrites an existing entry\'s data in place, keeping its id', () => {
      const saved = svc.save(scenarioFixture(1), 'Original');
      const replacement = scenarioFixture(2);

      const updated = svc.update(saved.id, replacement);

      expect(updated?.id).toBe(saved.id);
      expect(updated?.name).toBe('Original');
      expect(svc.get(saved.id)).toEqual(replacement);
      expect(svc.list().length).toBe(1);
    });

    it('renames the entry when a name is given', () => {
      const saved = svc.save(scenarioFixture(), 'Original');

      const updated = svc.update(saved.id, scenarioFixture(), 'Renamed');

      expect(updated?.name).toBe('Renamed');
    });

    it('returns undefined and does not create an entry for an unknown id', () => {
      const updated = svc.update('does-not-exist', scenarioFixture());

      expect(updated).toBeUndefined();
      expect(svc.list().length).toBe(0);
    });
  });

  describe('importMany', () => {
    it('imports every valid scene with a fresh id', () => {
      const payload = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        scenes: [
          { id: 'old-1', name: 'A', updatedAt: new Date().toISOString(), data: scenarioFixture(1) },
          { id: 'old-2', name: 'B', updatedAt: new Date().toISOString(), data: scenarioFixture(2) },
        ],
      };

      const imported = svc.importMany(payload);

      expect(imported.length).toBe(2);
      expect(imported.every((entry) => entry.id !== 'old-1' && entry.id !== 'old-2')).toBe(true);
      expect(svc.list().length).toBe(2);
    });

    it('drops individual entries with an unusable data shape but keeps the valid ones', () => {
      const payload = {
        version: 1 as const,
        exportedAt: new Date().toISOString(),
        scenes: [
          { id: 'old-1', name: 'Valid', updatedAt: new Date().toISOString(), data: scenarioFixture() },
          { id: 'old-2', name: 'Foreign', updatedAt: new Date().toISOString(), data: { notAScenario: true } },
        ],
      };

      const imported = svc.importMany(payload as never);

      expect(imported.length).toBe(1);
      expect(imported[0].name).toBe('Valid');
    });

    it('throws on a payload with no scenes array', () => {
      expect(() => svc.importMany({ version: 1 })).toThrowError(/scenes/i);
    });

    it('throws when every entry in the file is unusable', () => {
      const payload = { version: 1, exportedAt: '', scenes: [{ data: { notAScenario: true } }] };

      expect(() => svc.importMany(payload)).toThrowError(/no valid scenes/i);
    });
  });

  describe('exportAll', () => {
    it('exports every locally-saved scene as version 1', () => {
      svc.save(scenarioFixture(), 'One');
      svc.save(scenarioFixture(), 'Two');

      const exported = svc.exportAll();

      expect(exported.version).toBe(1);
      expect(exported.scenes.length).toBe(2);
      expect(exported.scenes.map((s) => s.name).sort()).toEqual(['One', 'Two']);
    });

    it('exports an empty list when nothing is saved', () => {
      expect(svc.exportAll().scenes).toEqual([]);
    });
  });

  describe('clearAll', () => {
    it('removes every locally-saved scene', () => {
      svc.save(scenarioFixture(), 'One');
      svc.save(scenarioFixture(), 'Two');

      svc.clearAll();

      expect(svc.list()).toEqual([]);
      expect(svc.listSummaries()).toEqual([]);
    });
  });
});
