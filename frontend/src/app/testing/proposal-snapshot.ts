import { ProposalsResult, ProposalVariant } from '../core/events/event-types';
import { ProposalSnapshot } from '../core/session.store';

/** A course as the backend returns it, with the numbers the panel shows. */
function variant(id: string, arrival: number): ProposalVariant {
  return {
    id,
    source: id,
    train: { handle: 0, arrival_step: arrival, delay_vs_plan: 0 } as ProposalVariant['train'],
    system: { done: 3, total: 3 } as ProposalVariant['system'],
    metrics: { lateness: 0, time_in_network: 10, not_arrived: 0 },
    trajectories: {} as ProposalVariant['trajectories'],
  };
}

/** What «Handlungsoptionen» showed for train 0, with the plan taken. */
export function proposalSnapshot(applied: ProposalSnapshot['applied'] = 'plan'): ProposalSnapshot {
  const result: ProposalsResult = {
    session_id: 'sess-1',
    handle: 0,
    step: 7,
    horizon: 60,
    ai_available: true,
    ai_matches_plan: true,
    variants: [variant('plan', 57), variant('ai', 57)],
    ai_alternatives: [variant('ai-2', 59)],
  };
  return { handle: 0, result, applied, option: null };
}
