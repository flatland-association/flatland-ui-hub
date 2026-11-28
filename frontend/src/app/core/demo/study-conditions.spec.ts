import en from '../../../../public/i18n/en.json';
import { PLAN_B_ORDERS, PLAN_B_R2_ORDERS, PLAN_B_TUTORIAL, STUDY_CONDITIONS, UC2_LEGS, conditionId, conditionScenarioId, hasFinalSurvey, hasFinishConfirm, hasShiftSummary, isGuidedCondition } from './study-conditions';
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

  // The guide strip carries «Schicht beenden» and «Reflexion öffnen»; without
  // it, the run must need neither (docs/plans/hide-scenario-bar.md §4.5). The
  // toolbar's finish button leads to the Schichtbilanz where a run has one
  // (the Plan B experiments of round 2, docs/plans/plan-b-control-group.md §4.2), and
  // the decision log offers the reflections.
  it('hides the guide strip only where the decision log stays', () => {
    const hidesGuide = STUDY_CONDITIONS.filter((c) =>
      LAYOUT_PRESETS.find((p) => p.id === c.layoutId)?.ui?.hidden?.includes('control.guide'),
    );
    expect(hidesGuide.length).toBeGreaterThan(0);
    for (const c of hidesGuide) {
      const hidden = LAYOUT_PRESETS.find((p) => p.id === c.layoutId)!.ui!.hidden!;
      expect(hidden).withContext(conditionId(c)).not.toContain('widget.decision-log');
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

  it('the formative Plan B runs go without the Schichtbilanz, the other guided conditions keep it (#174)', () => {
    const without = (id: string) => /^plan-b-(p\d\d|uc2)$/.test(id);
    for (const c of guided) {
      expect(c.shiftSummary).withContext(conditionId(c)).toBe(without(conditionId(c)) ? false : undefined);
    }
  });

  it('asks before a hand-made finish unless the condition or tour turns it off (#180)', () => {
    expect(hasFinishConfirm(null)).toBeTrue();
    expect(hasFinishConfirm({})).toBeTrue();
    expect(hasFinishConfirm({ finishConfirm: true })).toBeTrue();
    expect(hasFinishConfirm({ finishConfirm: false })).toBeFalse();
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
    const WORDS: Record<number, RegExp> = { 5: /fünf Schritte|five steps/, 6: /sechs Schritte|six steps/, 7: /sieben Schritte|seven steps/, 9: /neun Schritte|nine steps/ };
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
    // By id: the list puts p01 last (round 2 first, round 1's example last).
    const planB = STUDY_CONDITIONS.filter((c) => /^plan-b-p\d\d$/.test(conditionId(c))).sort((a, b) =>
      conditionId(a).localeCompare(conditionId(b)),
    );
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

  describe('Plan B round 2 (docs/plans/plan-b-round2-experiments.md)', () => {
    const ids = STUDY_CONDITIONS.map(conditionId);
    const group = (key: string) => STUDY_CONDITIONS.filter((c) => new RegExp(`^plan-b-r2-${key}-p\\d\\d$`).test(conditionId(c)));
    const groups = { colearning: group('colearning'), recommendation: group('recommendation') };
    const pairs = [['colearning', 'co-learning'], ['recommendation', 'recommendation']] as const;

    it('has 8 experiments per group, p01 … p08, the same order per participant in both', () => {
      for (const [key] of pairs) {
        expect(groups[key].map(conditionId)).toEqual(Array.from({ length: 8 }, (_, i) => `plan-b-r2-${key}-p${String(i + 1).padStart(2, '0')}`));
        groups[key].forEach((c, i) => expect(c.legs!.map((l) => l.scenarioId)).withContext(conditionId(c)).toEqual([...PLAN_B_R2_ORDERS[i]]));
      }
    });

    it('runs uc2-1, uc2-2 and uc2-4 once each, the same leg objects as round 1, no tutorial', () => {
      for (const c of [...groups.colearning, ...groups.recommendation]) {
        expect(c.legs!.map((l) => l.scenarioId).sort()).withContext(conditionId(c)).toEqual(['uc2-1', 'uc2-2', 'uc2-4']);
        for (const leg of c.legs!) expect(leg).withContext(conditionId(c)).toBe(UC2_LEGS[leg.scenarioId]);
      }
    });

    it('takes the six orders once and repeats 06 and 01 as 07 and 08', () => {
      const keys = PLAN_B_R2_ORDERS.map((o) => o.join());
      expect(new Set(keys.slice(0, 6)).size).toBe(6);
      expect(keys[6]).toBe(keys[5]);
      expect(keys[7]).toBe(keys[0]);
    });

    it('runs each group on its own layout, mode and briefing, then the Schichtbilanz and the questionnaire', () => {
      for (const [key, mode] of pairs) {
        for (const c of groups[key]) {
          const at = conditionId(c);
          expect(c.layoutId).withContext(at).toBe(`preset-plan-b-${key}`);
          expect(c.mode).withContext(at).toBe(mode);
          expect(c.briefingIds).withContext(at).toEqual({ de: `plan-b-r2-${key}`, en: `plan-b-r2-${key}` });
          expect(c.policy).withContext(at).toBe('deadlock_avoidance');
          expect(c.proposalAgent).withContext(at).toBe('uc2_rl');
          expect(c.studyLogging).withContext(at).toBeTrue();
          expect(hasShiftSummary(c)).withContext(at).toBeTrue();
          expect(c.surveyParts).withContext(at).toEqual(['plan-b-final']);
        }
      }
    });

    it('has a tutorial per group: the tutorial scenario, the Schichtbilanz, no questionnaire', () => {
      for (const [key, mode] of pairs) {
        const t = STUDY_CONDITIONS.find((c) => conditionId(c) === `plan-b-r2-tutorial-${key}`)!;
        expect(t.legs).toEqual([PLAN_B_TUTORIAL]);
        expect(t.mode).toBe(mode);
        expect(t.layoutId).toBe(`preset-plan-b-${key}`);
        expect(hasShiftSummary(t)).toBeTrue();
        expect(hasFinalSurvey(t)).toBeFalse();
      }
    });

    it('opens no briefing page: the first scenario\'s card comes first', () => {
      for (const key of ['colearning', 'recommendation']) {
        const b = briefingById(`plan-b-r2-${key}`)!;
        expect(b.opening).withContext(key).toBeUndefined();
        expect(b.debrief).withContext(key).toBeTrue();
        expect(b.debriefSections).withContext(key).toEqual(['shift-summary']);
      }
    });

    it('asks for reflections in Co-Learning only; Recommendation holds the trains and shows Plan B\'s card', () => {
      const co = briefingById('plan-b-r2-colearning')!;
      const rec = briefingById('plan-b-r2-recommendation')!;
      expect(co.reasonDialog).toBeTrue();
      expect(rec.reasonDialog).toBeFalse();
      expect(rec.decisionMoment).toBe('hold');
      expect(co.decisionMoment).toBeUndefined();
      expect(rec.guide!.map((s) => s.id)).not.toContain('reflect');
      expect(rec.moduleBadges).toBeUndefined();
      const { watchFor: recSteps, ...recCard } = rec.modeIntros!.recommendation!;
      const { watchFor: _planBSteps, ...planBCard } = briefingById('plan-b')!.modeIntros!['co-learning']!;
      expect(recCard).toEqual(planBCard);
      expect(recSteps!.join(' ')).toContain('fünf Schritte');
    });

    it('lists round 2 first and round 1\'s example last; hides round 1\'s other participants', () => {
      expect(ids.slice(0, 18)).toEqual([
        'plan-b-r2-tutorial-colearning', 'plan-b-r2-tutorial-recommendation',
        ...groups.colearning.map(conditionId), ...groups.recommendation.map(conditionId),
      ]);
      expect(ids[ids.length - 1]).toBe('plan-b-p01');
      for (const c of STUDY_CONDITIONS) {
        expect(!!c.unlisted).withContext(conditionId(c)).toBe(/^plan-b-p(0[2-9]|10)$/.test(conditionId(c)));
      }
    });
  });
});
