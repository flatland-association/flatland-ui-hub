// Coverage guard (plan §2.2): the generated matrix covers every id the app
// offers. Fails when a tour, study condition, mode, layout preset or backend
// scenario preset exists in the app but has no test.
import {
  LAYOUT_PRESETS,
  MODES,
  STUDY_CONDITIONS,
  TOURS,
  interactionModeUnion,
  scenarioPresets,
} from './support/app-data';
import { expect, test } from './support/fixtures';
import {
  BUILD_CASES,
  BUILD_NETWORKS,
  CONDITION_CASES,
  EXPERIMENT_TOUR_CASES,
  INTRO_TOUR_CASES,
  LAYOUT_CASES,
} from './support/matrix';

const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();

test.describe('Coverage guard', () => {
  test('every InteractionMode is a mode tab and has Build-door cases', () => {
    expect(sorted(MODES), 'INTERACTION_MODES vs the InteractionMode union').toEqual(sorted(interactionModeUnion()));
    expect(sorted(BUILD_CASES.map((c) => c.mode)), 'modes in the Build-door matrix').toEqual(sorted(MODES));
  });

  test('every tour has a test', () => {
    const tested = [...INTRO_TOUR_CASES, ...EXPERIMENT_TOUR_CASES].map((c) => c.tour.id);
    expect(sorted(tested), 'tour ids in the matrix vs TOURS').toEqual(sorted(TOURS.map((t) => t.id)));
  });

  test('every study condition has a test', () => {
    expect(
      sorted(CONDITION_CASES.map((c) => c.condition.layoutId)),
      'condition ids in the matrix vs STUDY_CONDITIONS',
    ).toEqual(sorted(STUDY_CONDITIONS.map((c) => c.layoutId)));
  });

  test('every layout preset has a test', () => {
    expect(sorted(LAYOUT_CASES.map((c) => c.layout)), 'layout ids in the matrix vs LAYOUT_PRESETS').toEqual(
      sorted(LAYOUT_PRESETS.map((p) => p.id)),
    );
  });

  test('every backend scenario preset has a Build-door test in every mode', () => {
    const presets = scenarioPresets().map((p) => p.id);
    expect(presets.length, 'backend scenario presets found').toBeGreaterThan(0);
    for (const mode of MODES) {
      const networks = BUILD_CASES.filter((c) => c.mode === mode).map((c) => c.network);
      expect(sorted(networks), `networks tested in ${mode}`).toEqual(sorted(BUILD_NETWORKS));
    }
    expect(BUILD_NETWORKS, 'backend presets in the Build-door networks').toEqual(expect.arrayContaining(presets));
  });
});
