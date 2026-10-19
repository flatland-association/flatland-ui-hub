import {
  LAYER_BASE_DEFAULTS,
  layerDefaultsFor,
  overriddenLayers,
  resolveLayerVisibility,
} from './layer-mode-defaults';

describe('layerDefaultsFor', () => {
  it('leaves Recommendation and Co-Learning on the base set', () => {
    expect(layerDefaultsFor('recommendation')).toEqual(LAYER_BASE_DEFAULTS);
    expect(layerDefaultsFor('co-learning')).toEqual(LAYER_BASE_DEFAULTS);
  });

  it('turns the per-train dispatch layers off in Director', () => {
    const director = layerDefaultsFor('director');
    expect(director.nextDecisions).toBeFalse();
    expect(director.agentTrajectory).toBeFalse();
  });

  it('keeps the layers the Marey reads, and the stations Director names places by', () => {
    // grid and trajectoryCellInfo are shared with the graphic timetable
    // (showGrid, its tooltip gate); stations carry the conflict anchor's label.
    const director = layerDefaultsFor('director');
    expect(director.grid).toBeTrue();
    expect(director.trajectoryCellInfo).toBeTrue();
    expect(director.stations).toBeTrue();
    expect(director.contentions).toBeTrue();
  });

  it('changes nothing else against the base set', () => {
    const director = layerDefaultsFor('director');
    const changed = (Object.keys(LAYER_BASE_DEFAULTS) as Array<keyof typeof LAYER_BASE_DEFAULTS>)
      .filter((key) => director[key] !== LAYER_BASE_DEFAULTS[key]);
    expect(changed.sort()).toEqual(['agentTrajectory', 'nextDecisions']);
  });

  it('does not hand out the shared object, so a caller cannot mutate the defaults', () => {
    const a = layerDefaultsFor('director');
    a.grid = false;
    expect(layerDefaultsFor('director').grid).toBeTrue();
    expect(LAYER_BASE_DEFAULTS.grid).toBeTrue();
  });
});

describe('resolveLayerVisibility', () => {
  it('lets an explicit choice win over the mode default', () => {
    const resolved = resolveLayerVisibility('director', { nextDecisions: true });
    expect(resolved.nextDecisions).toBeTrue();
    expect(resolved.agentTrajectory).toBeFalse();
  });

  it('carries a choice across a mode switch instead of dropping it', () => {
    const chosen = { switches: true };
    expect(resolveLayerVisibility('recommendation', chosen).switches).toBeTrue();
    expect(resolveLayerVisibility('director', chosen).switches).toBeTrue();
  });

  it('falls back to the mode default for everything untouched', () => {
    expect(resolveLayerVisibility('director', {})).toEqual(layerDefaultsFor('director'));
  });
});

describe('overriddenLayers', () => {
  it('names only the layers that differ from the mode default', () => {
    expect(overriddenLayers('director', { nextDecisions: true, stations: true })).toEqual([
      'nextDecisions',
    ]);
  });

  it('reports nothing when a layer was toggled back to its default', () => {
    // Off and on again records a choice that equals the default; calling that an
    // override would light up a reset with nothing to reset.
    expect(overriddenLayers('director', { agentTrajectory: false })).toEqual([]);
    expect(overriddenLayers('recommendation', {})).toEqual([]);
  });

  it('counts the same choice as an override in one mode and not in another', () => {
    expect(overriddenLayers('recommendation', { nextDecisions: false })).toEqual(['nextDecisions']);
    expect(overriddenLayers('director', { nextDecisions: false })).toEqual([]);
  });
});
