import { NewSessionOpts, restartSessionOpts } from './restart-session-opts';

describe('restartSessionOpts', () => {
  const fromSettings: NewSessionOpts = {
    width: 36, height: 24, agents: 8, seed: 7,
    scenarioPolicyIds: ['shortest_path'], policyControlIds: ['goal_directed'],
  };

  it('restarts a tour scenario with its scene, disturbance, open step and live seed', () => {
    const tourStart: NewSessionOpts = {
      scenarioPresetId: 'pf-ch-wn-wal-long-approach',
      disturbanceIds: ['wal-signal-fault'],
      openAtStep: 12,
      seed: 4242, malfunctionRate: 0.01, malfunctionMinDuration: 5, malfunctionMaxDuration: 15,
      scenarioPolicyIds: ['old'], policyControlIds: ['old'],
      playSpeedLevel: 3,
    };
    const opts = restartSessionOpts({ opts: tourStart, randomEnv: false }, fromSettings);
    expect(opts.scenarioPresetId).toBe('pf-ch-wn-wal-long-approach');
    expect(opts.disturbanceIds).toEqual(['wal-signal-fault']);
    expect(opts.openAtStep).toBe(12);
    expect(opts.seed).toBe(4242);
    expect(opts.malfunctionRate).toBe(0.01);
    expect(opts.width).toBeUndefined();
    expect(opts.agents).toBeUndefined();
  });

  it('keeps a saved scene', () => {
    const scene = { id: 'my-scene', cells: [], agents: [] };
    const opts = restartSessionOpts({ opts: { infrastructureScene: scene, seed: 1 }, randomEnv: false }, fromSettings);
    expect(opts.infrastructureScene).toBe(scene);
  });

  it('takes the current AI policies and leaves the play speed alone', () => {
    const opts = restartSessionOpts(
      { opts: { scenarioPresetId: 'olten-dense', scenarioPolicyIds: ['old'], policyControlIds: ['old'], playSpeedLevel: 3 }, randomEnv: false },
      fromSettings,
    );
    expect(opts.scenarioPolicyIds).toEqual(['shortest_path']);
    expect(opts.policyControlIds).toEqual(['goal_directed']);
    expect('playSpeedLevel' in opts).toBeFalse();
  });

  it('rebuilds a random env from the Settings fields', () => {
    const opts = restartSessionOpts({ opts: { width: 20, height: 20, agents: 2 }, randomEnv: true }, fromSettings);
    expect(opts).toBe(fromSettings);
  });

  it('falls back to the Settings fields when nothing has been started', () => {
    expect(restartSessionOpts(null, fromSettings)).toBe(fromSettings);
  });
});
