/**
 * The preference matcher of the advanced Co-Learning tour (WP4,
 * docs/plans/colearning-advanced-tour.md): does a rule the person confirmed
 * earlier in this tour fit the situation the impact analysis reports now?
 *
 * A rule is a confirmed learning record with impact context
 * (`TourBriefing.learningContext: 'impact'`). It fits when the condition it was
 * learned under holds again: the block is long (or short) as it was then, and a
 * reroute is (or is not) available as it was then. Learn the condition, not the
 * option — so the trains and the step may differ.
 *
 * Co-Learning keeps its options neutral: a fitting rule is shown next to the
 * assessment and marks the measure it names, it does not reorder anything.
 */

import { ImpactItem } from '../events/event-types';
import { LONG_BLOCK_STEPS, LearningRecord } from '../learning-store.service';

/** What a rule stands for, in the impact panel's terms. */
export type RuleMeasure = 'hold' | 'reroute' | 'proceed' | 'ai';

export function measureOf(record: LearningRecord): RuleMeasure {
  if (record.decision === 'accept') return 'ai';
  if (record.decision === 'proceed') return 'proceed';
  if (record.action === 4) return 'hold';
  if (record.action === 5) return 'reroute';
  return 'proceed';
}

/**
 * The most recent confirmed rule from an earlier shift of this tour run
 * (created at or after `since`, before `until`) whose condition holds for
 * `item`, or null. `until` is the start of the current shift, so a rule just
 * confirmed does not come back as one "from before".
 */
export function matchingRule(
  records: readonly LearningRecord[],
  item: Pick<ImpactItem, 'clears_in_steps' | 'can_reroute'>,
  since: number,
  until = Number.POSITIVE_INFINITY,
): LearningRecord | null {
  const longNow = item.clears_in_steps >= LONG_BLOCK_STEPS;
  const fits = records
    .filter((r) => r.response === 'yes' && !r.once && r.createdAt >= since && r.createdAt < until)
    .filter((r) => {
      const c = r.context.impact;
      if (!c) return false;
      return c.canReroute === item.can_reroute && c.clearsInSteps >= LONG_BLOCK_STEPS === longNow;
    })
    // A rule for a reroute cannot apply where no reroute exists.
    .filter((r) => measureOf(r) !== 'reroute' || item.can_reroute);
  return fits.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}
