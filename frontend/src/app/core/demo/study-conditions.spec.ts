import en from '../../../../public/i18n/en.json';
import { STUDY_CONDITIONS, conditionId, conditionScenarioId, isGuidedCondition } from './study-conditions';
import { tourBriefingId } from './tours';
import { briefingById } from './tour-briefings';
import { LAYOUT_PRESETS } from '../layout/layout-presets';

/** Resolve a dotted i18n key in en.json. */
function hasKey(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
}

/**
 * The guard of docs/plans/experiment-workflow.md §3: what the type does not
 * check about a condition, before a participant meets it.
 */
describe('study conditions', () => {
  // Without Play, only the intro's «Szenario starten» starts the run, and it
  // does so only with `autoStart` (docs/plans/toolbar-under-guide.md §1.1).
  it('hides playback only where every briefing starts the run itself', () => {
    const hidesPlayback = STUDY_CONDITIONS.filter((c) =>
      LAYOUT_PRESETS.find((p) => p.id === c.layoutId)?.ui?.hidden?.includes('control.playback'),
    );
    expect(hidesPlayback.length).toBeGreaterThan(0);
    for (const c of hidesPlayback) {
      const ids = Object.values(c.briefingIds ?? {});
      expect(ids.length).withContext(conditionId(c)).toBeGreaterThan(0);
      for (const id of ids) expect(briefingById(id)?.autoStart).withContext(`${conditionId(c)} ${id}`).toBeTrue();
    }
  });

  const guided = STUDY_CONDITIONS.filter(isGuidedCondition);

  it('has one id per condition, and the four study conditions keep their layout id', () => {
    const ids = STUDY_CONDITIONS.map(conditionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of STUDY_CONDITIONS.filter((c) => !isGuidedCondition(c))) {
      expect(conditionId(c)).toBe(c.layoutId);
    }
  });

  it('Plan B goes without the Schichtbilanz, the other guided conditions keep it (#174)', () => {
    for (const c of guided) {
      expect(c.shiftSummary).withContext(conditionId(c)).toBe(conditionId(c) === 'plan-b-p01' ? false : undefined);
    }
  });

  it('ships at least one guided condition', () => {
    expect(guided.length).toBeGreaterThan(0);
  });

  it('a guided condition has a briefing in every language, and only then', () => {
    for (const c of STUDY_CONDITIONS) {
      expect(!!c.briefingIds).withContext(conditionId(c)).toBe(isGuidedCondition(c));
      if (!c.briefingIds) continue;
      for (const lang of ['en', 'de', 'fr'] as const) {
        expect(briefingById(tourBriefingId(c, lang))).withContext(`${conditionId(c)}/${lang}`).toBeDefined();
      }
    }
  });

  it('a guided condition keeps the one-run fields unset: its legs say it', () => {
    for (const c of guided) {
      expect(c.scenarioId).withContext(conditionId(c)).toBeUndefined();
      expect(c.disturbanceIds).withContext(conditionId(c)).toBeUndefined();
      expect(c.mapFocusCols).withContext(conditionId(c)).toBeUndefined();
      expect(conditionScenarioId(c)).toBe(c.legs![0].scenarioId);
    }
  });

  it('every leg has a name in en.json, one disturbance and a pinned seed', () => {
    for (const c of guided) {
      for (const leg of c.legs!) {
        const at = `${conditionId(c)}/${leg.id}`;
        expect(hasKey(leg.nameKey)).withContext(`${at} ${leg.nameKey}`).toBeTrue();
        expect(leg.disturbanceIds.length).withContext(at).toBe(1);
        expect(Number.isInteger(leg.seed)).withContext(at).toBeTrue();
      }
    }
  });

  it('a translated condition name exists in en.json', () => {
    for (const c of STUDY_CONDITIONS.filter((c) => c.labelKey)) {
      expect(hasKey(c.labelKey!)).withContext(conditionId(c)).toBeTrue();
    }
  });

  it('a leg shared by several conditions is the same leg everywhere', () => {
    const byId = new Map<string, unknown>();
    for (const c of guided) {
      for (const leg of c.legs!) {
        const seen = byId.get(leg.id);
        if (seen) expect(leg).withContext(leg.id).toBe(seen as typeof leg);
        else byId.set(leg.id, leg);
      }
    }
  });
});
