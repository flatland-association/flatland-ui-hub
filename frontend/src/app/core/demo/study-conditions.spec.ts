import en from '../../../../public/i18n/en.json';
import { PLAN_B_ORDERS, PLAN_B_TUTORIAL, STUDY_CONDITIONS, conditionId, conditionScenarioId, hasShiftSummary, isGuidedCondition } from './study-conditions';
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
      expect(c.shiftSummary).withContext(conditionId(c)).toBe(conditionId(c).startsWith('plan-b-') ? false : undefined);
    }
  });

  it('a briefing has no Schichtbilanz step where its condition has no Schichtbilanz (#174)', () => {
    for (const c of guided.filter((c) => !hasShiftSummary(c))) {
      for (const id of new Set(Object.values(c.briefingIds!))) {
        const b = briefingById(id)!;
        expect(b.guide?.some((s) => s.id === 'shift-summary')).withContext(id).toBeFalse();
      }
    }
  });

  it('every intro card counts the steps its guide strip shows', () => {
    const WORDS: Record<number, RegExp> = { 6: /sechs Schritte|six steps/, 7: /sieben Schritte|seven steps/, 9: /neun Schritte|nine steps/ };
    for (const c of guided) {
      for (const id of new Set(Object.values(c.briefingIds!))) {
        const b = briefingById(id)!;
        // With several legs the strip is one leg's and hides the steps after the
        // episode (TourGuideComponent.groups), with or without the Schichtbilanz.
        const steps = c.legs!.length > 1 ? b.guide!.filter((s) => !s.afterEpisode) : b.guide!;
        const cards = [b.modeIntros?.[c.mode], ...c.legs!.flatMap((l) => Object.values(l.intro ?? {}))];
        for (const card of cards) {
          const count = (card?.watchFor ?? []).find((l) => / Schritte| steps/.test(l));
          if (count) expect(count).withContext(`${conditionId(c)} ${card?.title}`).toMatch(WORDS[steps.length]);
        }
      }
    }
  });

  it('Plan B guides through six steps with hints that fit every scenario', () => {
    const guide = briefingById('plan-b')!.guide!;
    expect(guide.map((s) => s.id)).toEqual(['detect', 'assess', 'alternatives', 'decide', 'execute', 'reflect']);
    for (const s of guide) expect(s.hint).withContext(s.id).not.toMatch(/Einspur|Neu:|stehen/);
  });

  it('Plan B asks only the final questionnaire, none after each scenario', () => {
    const planB = guided.find((c) => conditionId(c) === 'plan-b-p01')!;
    expect(planB.legSurveyParts).toBeUndefined();
    expect(planB.surveyParts.length).toBeGreaterThan(0);
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

  it('every leg has a pinned seed; a named leg a name in en.json and one disturbance', () => {
    for (const c of guided) {
      for (const leg of c.legs!) {
        const at = `${conditionId(c)}/${leg.id}`;
        expect(Number.isInteger(leg.seed)).withContext(at).toBeTrue();
        if (leg.nameKey) {
          expect(hasKey(leg.nameKey)).withContext(`${at} ${leg.nameKey}`).toBeTrue();
          expect(leg.disturbanceIds.length).withContext(at).toBe(1);
        } else {
          // Named by its experiment scenario's title, and run as its .pkl is:
          // the backend refuses disturbances on top (experiment-scenario-import.md §3.2).
          expect(leg.disturbanceIds.length).withContext(at).toBe(0);
        }
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

  describe('Plan B (experiment-scenario-import.md §4)', () => {
    const planB = STUDY_CONDITIONS.filter((c) => /^plan-b-p\d\d$/.test(conditionId(c)));
    const UC2 = ['uc2-1', 'uc2-2', 'uc2-3', 'uc2-4'];

    it('has ten conditions, plan-b-p01 … plan-b-p10, one per order', () => {
      expect(planB.map(conditionId)).toEqual(Array.from({ length: 10 }, (_, i) => `plan-b-p${String(i + 1).padStart(2, '0')}`));
      expect(PLAN_B_ORDERS.length).toBe(10);
    });

    it('starts each with the tutorial, then runs every UC2 scenario exactly once, in its order', () => {
      planB.forEach((c, i) => {
        const at = conditionId(c);
        expect(c.legs![0]).withContext(at).toBe(PLAN_B_TUTORIAL);
        const rest = c.legs!.slice(1).map((l) => l.scenarioId);
        expect(rest).withContext(at).toEqual([...PLAN_B_ORDERS[i]]);
        expect([...rest].sort()).withContext(at).toEqual(UC2);
      });
    });

    it('runs the study setup: reduced layout, Co-Learning, pinned policy, no Schichtbilanz, one final questionnaire', () => {
      for (const c of planB) {
        const at = conditionId(c);
        expect(c.layoutId).withContext(at).toBe('preset-plan-b');
        expect(c.mode).withContext(at).toBe('co-learning');
        expect(c.policy).withContext(at).toBe('deadlock_avoidance');
        expect(c.shiftSummary).withContext(at).toBeFalse();
        expect(c.studyLogging).withContext(at).toBeTrue();
        expect(c.legSurveyParts).withContext(at).toBeUndefined();
        expect(c.surveyParts).withContext(at).toEqual(['plan-b-final']);
        expect(c.briefingIds).withContext(at).toEqual({ de: 'plan-b', en: 'plan-b' });
      }
    });
  });
});
