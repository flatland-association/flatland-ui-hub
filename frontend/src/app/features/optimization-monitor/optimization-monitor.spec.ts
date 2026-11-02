import { DirectorActivity, DirectorProgress } from '../../core/api.service';
import { planStatus } from './optimization-monitor.component';

function activity(source: string | null): DirectorActivity {
  return {
    session_id: 's',
    step: 10,
    source,
    totalDecisions: 0,
    totalReplans: 0,
    replans: [],
    recent: [],
    upcoming: [],
  };
}

const idle: DirectorProgress = { phase: 'idle' };

describe('planStatus', () => {
  it('reports planning while the planner is busy, whatever the source', () => {
    expect(planStatus(activity('search'), { phase: 'first-plan' })).toBe('planning');
  });

  it('separates a searched plan from the baselines', () => {
    expect(planStatus(activity('search'), idle)).toBe('searched');
    expect(planStatus(activity('lines'), idle)).toBe('fallback');
    expect(planStatus(activity('avoidance'), idle)).toBe('fallback');
    expect(planStatus(activity('avoidance (no models)'), idle)).toBe('fallback');
  });

  it('reports no route and no plan honestly', () => {
    expect(planStatus(activity('unroutable'), idle)).toBe('unroutable');
    expect(planStatus(activity(null), idle)).toBe('none');
    expect(planStatus(null, null)).toBe('none');
  });
});
