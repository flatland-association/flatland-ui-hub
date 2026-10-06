// The app's own sources of truth, read directly (plan §2.2).
//
// These modules hold plain data and import only *types* from Angular-side
// files, which the TypeScript transform drops, so Playwright can load them
// without pulling in Angular. A new tour, study condition, layout preset or
// mode therefore lands in the matrix without touching the tests.
//
// Backend scenario presets are not frontend data: they come from the same
// Python function `GET /session/scenario-presets` serves (`list_presets`),
// called once per run (see `scenarioPresets()`).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { TOURS, type Tour } from '../../src/app/core/demo/tours';
import { STUDY_CONDITIONS, type StudyCondition } from '../../src/app/core/demo/study-conditions';
import { LAYOUT_PRESETS, type LayoutPreset } from '../../src/app/core/layout/layout-presets';
import { PANEL_MODE_AVAILABILITY, isPanelAvailableInMode } from '../../src/app/core/layout/panel-mode-availability';
import { INTERACTION_MODES } from '../../src/app/core/interaction-modes';
import type { InteractionMode } from '../../src/app/core/events/event-types';

export { TOURS, STUDY_CONDITIONS, LAYOUT_PRESETS, PANEL_MODE_AVAILABILITY, isPanelAvailableInMode };
export type { Tour, StudyCondition, LayoutPreset, InteractionMode };

/** The modes as the mode tabs list them (`core/interaction-modes.ts`). */
export const MODES: InteractionMode[] = INTERACTION_MODES.map((m) => m.id);

/**
 * The members of the `InteractionMode` union, read from its declaration. A type
 * has no runtime value, so the coverage guard parses the source: a mode added to
 * the union but not to `INTERACTION_MODES` must fail a test, not vanish.
 */
export function interactionModeUnion(): string[] {
  const src = readFileSync(resolve(__dirname, '../../src/app/core/events/event-types.ts'), 'utf8');
  const decl = /export type InteractionMode\s*=\s*([^;]+);/.exec(src);
  if (!decl) throw new Error('InteractionMode declaration not found in event-types.ts');
  return [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Tours of the Introduction door (`door` unset or 'tour'), as `AppComponent.tours`. */
export const INTRO_TOURS = TOURS.filter((t) => (t.door ?? 'tour') === 'tour');
/** Tours of the Experiments door, as `AppComponent.experimentTours`. */
export const EXPERIMENT_TOURS = TOURS.filter((t) => t.door === 'experiments');

/** Mode-restricted panel types: the only ones whose presence depends on the mode. */
export const MODE_RESTRICTED_PANELS = Object.keys(PANEL_MODE_AVAILABILITY);

export interface ScenarioPresetInfo {
  id: string;
  has_plan: boolean;
  disturbanceIds: string[];
}

const PRESETS_ENV = 'E2E_SCENARIO_PRESETS';

/**
 * Backend scenario presets, from `app.core.scenario_presets.list_presets()` —
 * the function behind `GET /session/scenario-presets`. Test files are loaded
 * before Playwright starts the servers, so the list cannot come over HTTP at
 * that point. The first load stores it in the environment, which the worker
 * processes inherit, so Python runs once per run.
 */
export function scenarioPresets(): ScenarioPresetInfo[] {
  const cached = process.env[PRESETS_ENV];
  if (cached) return JSON.parse(cached) as ScenarioPresetInfo[];

  const backendDir = resolve(__dirname, '../../../backend');
  const python =
    [join(backendDir, '.venv', 'bin', 'python'), join(backendDir, '.venv', 'Scripts', 'python.exe')].find((p) =>
      existsSync(p),
    ) ?? 'python3';
  const script = [
    'import json',
    'from app.core.scenario_presets import list_presets',
    'print(json.dumps([{"id": p["id"], "has_plan": bool(p.get("has_plan")),',
    '  "disturbanceIds": [d["id"] for d in (p.get("disturbances") or [])]} for p in list_presets()]))',
  ].join('\n');
  const out = execFileSync(python, ['-c', script], { cwd: backendDir, encoding: 'utf8' });
  process.env[PRESETS_ENV] = out.trim();
  return JSON.parse(out) as ScenarioPresetInfo[];
}
