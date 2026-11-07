import { LAYOUT_PRESETS } from '../layout/layout-presets';
import { briefingById } from './tour-briefings';
import { STUDY_CONDITIONS } from './study-conditions';
import { TOURS } from './tours';

/**
 * A tour that asks for reasons shows its reflections, and reopens them from
 * the log, in the decision panel only, and not in Director
 * (docs/plans/reflection-inline.md §1.2, §4.2). So every such tour and study
 * condition has to run a layout that places that panel.
 */
describe('tours that ask for reasons', () => {
  const runs = [
    ...TOURS.map((t) => ({ id: t.id, layout: t.layout, modes: t.modes, briefings: Object.values(t.briefingIds ?? {}).concat(t.briefingId ?? []) })),
    ...STUDY_CONDITIONS.map((c) => ({ id: c.id ?? c.layoutId, layout: c.layoutId, modes: [c.mode], briefings: Object.values(c.briefingIds ?? {}) })),
  ].filter((r) => r.briefings.some((id) => briefingById(id)?.reasonDialog));

  it('exist', () => {
    expect(runs.length).toBeGreaterThan(0);
  });

  it('each run a layout with the decision panel, and not in Director', () => {
    for (const run of runs) {
      const preset = LAYOUT_PRESETS.find((p) => p.id === run.layout);
      expect(preset).withContext(`${run.id}: layout ${run.layout}`).toBeDefined();
      const types = preset?.layout.columns.flatMap((c) => c.panels.map((p) => p.type)) ?? [];
      expect(types).withContext(run.id).toContain('proposal-compare');
      expect(run.modes).withContext(run.id).not.toContain('director');
    }
  });
});
