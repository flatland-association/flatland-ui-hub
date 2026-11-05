import { UI_CONFIG_ITEMS } from './config/ui-config-items';
import type { ActionOrigin } from './dispatch/train-action.service';
import { LAYOUT_PRESETS } from './layout/layout-presets';
import { WIDGET_CATALOG } from './widgets/widget-catalog';
import { CENTER_VIEWS } from '../features/view-tabs/center-views';

/**
 * IDs that leave the source code — saved Layout Designer designs, deployment
 * `ui-config.json` files, deep links and the study data — keep their value even
 * when their wording is outdated (AGENTS.md, Guardrails; #173). A rename of one
 * of these fails here instead of silently breaking what was saved or logged.
 * The tour ids are pinned in `demo/tours.spec.ts`.
 */
describe('stored and logged ids', () => {
  it('keeps the ZWL widget type', () => {
    expect(WIDGET_CATALOG.map((w) => w.type)).toContain('zug-weg-diagramm');
    expect(CENTER_VIEWS.map((v) => v.type)).toContain('zug-weg-diagramm');
  });

  it('keeps the ZWL UI-config id', () => {
    expect(UI_CONFIG_ITEMS.map((i) => i.id)).toContain('widget.zug-weg-diagramm');
  });

  it('keeps the ZWL preset and panel ids', () => {
    expect(LAYOUT_PRESETS.map((p) => p.id)).toEqual(
      jasmine.arrayContaining(['preset-olten-zug-weg', 'preset-zug-weg-corridor']),
    );
    const panelIds = LAYOUT_PRESETS.flatMap((p) => p.layout.columns.flatMap((c) => c.panels.map((panel) => panel.id)));
    expect(panelIds).toEqual(
      jasmine.arrayContaining(['preset-oz-zugweg', 'preset-zc-zugweg', 'preset-rt-zugweg', 'preset-d3-zugweg']),
    );
  });

  it('keeps the ZWL action origin', () => {
    // Compile-time pin: renaming the union member fails the build.
    const origin: ActionOrigin = 'zug-weg';
    expect(origin).toBe('zug-weg');
  });
});
