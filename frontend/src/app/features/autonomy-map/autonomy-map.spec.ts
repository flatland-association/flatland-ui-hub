import { allocationRows } from './autonomy-map.component';

const level = (rows: ReturnType<typeof allocationRows>, type: string) =>
  rows.find((r) => r.type === type)?.level;

describe('allocationRows', () => {
  it('Recommendation with auto-pause: AI decides after a warning', () => {
    expect(level(allocationRows('recommendation', true), 'conflict')).toBe('prewarn');
  });

  it('Co-Learning with auto-pause: the human decides (trains held)', () => {
    expect(level(allocationRows('co-learning', true), 'conflict')).toBe('human');
  });

  it('without auto-pause the AI decides conflicts in every advisory mode', () => {
    expect(level(allocationRows('recommendation', false), 'conflict')).toBe('ai');
    expect(level(allocationRows('co-learning', false), 'conflict')).toBe('ai');
  });

  it('Director: AI decides conflicts, the human owns the objective', () => {
    const rows = allocationRows('director', true);
    expect(level(rows, 'conflict')).toBe('ai');
    expect(level(rows, 'strategy')).toBe('human');
  });

  it('the objective is not set outside Director; fixed trains are always human', () => {
    expect(level(allocationRows('recommendation', true), 'strategy')).toBe('na');
    for (const m of ['recommendation', 'co-learning', 'director'] as const) {
      expect(level(allocationRows(m, true), 'fixed')).toBe('human');
    }
  });
});
